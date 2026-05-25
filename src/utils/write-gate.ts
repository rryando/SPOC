/**
 * Write-gate token model for SPOC DAG write enforcement.
 *
 * Proposals are single-use, time-bounded, project-scoped tokens
 * that must be presented before any DAG write operation proceeds.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "./paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WriteProposal {
  token: string;
  slug: string;
  summary: string;
  operations: string[];
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
}

export interface WriteProposalInput {
  slug: string;
  summary: string;
  operations: string[];
  /** Time-to-live in milliseconds. */
  ttlMs: number;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class WriteGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteGateError";
  }
}

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const store = new Map<string, WriteProposal>();

// ---------------------------------------------------------------------------
// File-backed persistence (cross-process token sharing)
// ---------------------------------------------------------------------------

function getTokensDir(): string {
  return join(getDataDir(), "tokens");
}

function persistProposal(proposal: WriteProposal): void {
  try {
    const dir = getTokensDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${proposal.token}.json`), JSON.stringify(proposal), "utf-8");
  } catch (err) {
    process.stderr.write(`[spoc] warn: failed to persist token to disk: ${(err as Error).message}\n`);
  }
}

function loadProposalFromDisk(token: string): WriteProposal | undefined {
  try {
    const filePath = join(getTokensDir(), `${token}.json`);
    if (!existsSync(filePath)) return undefined;
    const data = JSON.parse(readFileSync(filePath, "utf-8")) as WriteProposal;
    store.set(token, data);
    return data;
  } catch (err) {
    process.stderr.write(`[spoc] warn: failed to read token from disk: ${(err as Error).message}\n`);
    return undefined;
  }
}

function storeSet(token: string, proposal: WriteProposal): void {
  store.set(token, proposal);
  persistProposal(proposal);
}

/**
 * When true, requireWriteGate() becomes a no-op.
 * Only used in tests to avoid updating every existing test caller.
 */
let _bypassEnabled = false;

export function enableWriteGateBypass(): void {
  _bypassEnabled = true;
}

export function disableWriteGateBypass(): void {
  _bypassEnabled = false;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/**
 * Create a write proposal token. Stores it in memory for later retrieval.
 * @param input Proposal parameters.
 * @param nowMs Current time in epoch ms (injectable for tests).
 */
export function createWriteProposal(input: WriteProposalInput, nowMs: number = Date.now()): WriteProposal {
  const token = `wp_${randomBytes(16).toString("hex")}`;
  const proposal: WriteProposal = {
    token,
    slug: input.slug,
    summary: input.summary,
    operations: input.operations,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + input.ttlMs).toISOString(),
    consumedAt: null,
  };
  storeSet(token, proposal);
  return proposal;
}

/**
 * Retrieve a proposal by token. Returns undefined if not found.
 */
export function getWriteProposal(token: string): WriteProposal | undefined {
  return store.get(token) ?? loadProposalFromDisk(token);
}

/**
 * Consume a proposal (single-use). Validates expiry and project scope.
 * Returns the updated proposal with consumedAt set.
 * @param proposal The proposal to consume.
 * @param targetSlug The project slug the caller intends to write to.
 * @param nowMs Current time in epoch ms (injectable for tests).
 */
export function consumeWriteProposal(
  proposal: WriteProposal,
  targetSlug: string,
  nowMs: number = Date.now(),
): WriteProposal {
  if (proposal.consumedAt !== null) {
    throw new WriteGateError("Proposal already consumed");
  }

  const expiresAtMs = new Date(proposal.expiresAt).getTime();
  if (nowMs > expiresAtMs) {
    throw new WriteGateError("Proposal expired");
  }

  if (proposal.slug !== targetSlug) {
    throw new WriteGateError(`Project scope mismatch: proposal for "${proposal.slug}", target "${targetSlug}"`);
  }

  proposal.consumedAt = new Date(nowMs).toISOString();
  // Update store
  storeSet(proposal.token, proposal);
  return proposal;
}

/**
 * Atomic get-and-consume: retrieves a proposal by token and consumes it in one step.
 * Eliminates race risk from separate get + consume calls.
 * @param token The proposal token.
 * @param targetSlug The project slug the caller intends to write to.
 * @param nowMs Current time in epoch ms (injectable for tests).
 */
export function consumeWriteProposalToken(
  token: string,
  targetSlug: string,
  nowMs: number = Date.now(),
): WriteProposal {
  const proposal = store.get(token) ?? loadProposalFromDisk(token);
  if (!proposal) {
    throw new WriteGateError("Proposal not found");
  }
  return consumeWriteProposal(proposal, targetSlug, nowMs);
}

/**
 * Validate and consume a confirmation token for a gated write operation.
 *
 * Checks:
 * 1. Token exists and is valid (not expired, not consumed).
 * 2. Token is scoped to the target slug.
 * 3. Token's operations list includes the requested operation.
 *
 * @param token The confirmation token string.
 * @param slug The target project slug.
 * @param operation The canonical operation string (e.g. "tool:update_project_doc").
 * @param nowMs Current time in epoch ms (injectable for tests).
 * @returns The consumed proposal.
 * @throws WriteGateError if validation fails.
 */
export function requireWriteGate(
  token: string | undefined,
  slug: string,
  operation: string,
  nowMs: number = Date.now(),
): WriteProposal | null {
  if (_bypassEnabled) return null;

  if (!token) {
    throw new WriteGateError(
      `Write gate required: provide a confirmationToken for operation "${operation}" on project "${slug}". ` +
        `Use propose_dag_write to obtain one.`,
    );
  }

  const proposal = store.get(token) ?? loadProposalFromDisk(token);
  if (!proposal) {
    throw new WriteGateError("Proposal not found");
  }

  if (proposal.consumedAt !== null) {
    throw new WriteGateError("Proposal already consumed");
  }

  const expiresAtMs = new Date(proposal.expiresAt).getTime();
  if (nowMs > expiresAtMs) {
    throw new WriteGateError("Proposal expired");
  }

  if (proposal.slug !== slug) {
    throw new WriteGateError(`Project scope mismatch: proposal for "${proposal.slug}", target "${slug}"`);
  }

  if (!proposal.operations.includes(operation)) {
    throw new WriteGateError(
      `Operation mismatch: proposal authorizes [${proposal.operations.join(", ")}], requested "${operation}"`,
    );
  }

  proposal.consumedAt = new Date(nowMs).toISOString();
  storeSet(token, proposal);
  return proposal;
}

/**
 * Clear all proposals from memory. Useful for testing.
 */
export function clearWriteProposals(): void {
  store.clear();
  try {
    const dir = getTokensDir();
    if (existsSync(dir)) {
      for (const file of readdirSync(dir)) {
        if (file.endsWith(".json")) {
          unlinkSync(join(dir, file));
        }
      }
    }
  } catch (err) {
    process.stderr.write(`[spoc] warn: failed to clear tokens from disk: ${(err as Error).message}\n`);
  }
}
