/**
 * Write-gate token model for SPOC DAG write enforcement.
 *
 * Proposals are single-use, time-bounded, project-scoped tokens
 * that must be presented before any DAG write operation proceeds.
 */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOpName } from "./op-names.js";
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
  /**
   * Timestamp of the first consumption against this proposal, or null if
   * untouched. For multi-op proposals, this is set when the first op-slot
   * is consumed and remains set as further slots are drained.
   */
  consumedAt: string | null;
  /**
   * Per-op consumption ledger. Each entry corresponds to one slot in
   * `operations[]` that has been spent. The proposal is exhausted when
   * `consumedOps.length === operations.length`. Stored as canonical op names.
   */
  consumedOps: string[];
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
  code: string;
  hint?: string;

  constructor(message: string, code?: string, hint?: string) {
    super(message);
    this.name = "WriteGateError";
    this.code = code ?? "write_gate_error";
    this.hint = hint;
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
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${hours}h${rem}m` : `${hours}h`;
}

function formatExpiryMessage(proposal: WriteProposal, nowMs: number, expiresAtMs: number): string {
  const createdAtMs = new Date(proposal.createdAt).getTime();
  const ttlMs = expiresAtMs - createdAtMs;
  const createdAgo = formatDuration(nowMs - createdAtMs);
  const ttl = formatDuration(ttlMs);
  const expiredAgo = formatDuration(nowMs - expiresAtMs);
  return `Proposal expired (created ${createdAgo} ago, TTL was ${ttl}, expired ${expiredAgo} ago). Re-propose to get a fresh token.`;
}

// ---------------------------------------------------------------------------
// Operation name normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an operation name for write-gate comparison.
 *
 * Resolves canonical names, legacy `tool:` / `cli:` prefixed names, and
 * snake_case aliases all to a single canonical kebab-case form (e.g.
 * `tool:create_project_plan` → `plan-create`). This lets handlers pass legacy
 * gate strings while users propose canonical op names (and vice versa).
 *
 * For unknown ops, falls back to a generic strip+kebab transform so behaviour
 * remains backward-compatible for ops not yet listed in OP_REGISTRY.
 */
export function normalizeOpName(op: string): string {
  const resolved = resolveOpName(op);
  if (resolved !== op) return resolved;
  // Generic fallback for ops not in the registry
  return op.toLowerCase().replace(/^(tool|cli):/, "").replace(/_/g, "-");
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
  // Idempotent: return existing active proposal with same slug+operations+summary
  const sortedOps = [...input.operations].sort();
  for (const existing of store.values()) {
    if (
      existing.slug === input.slug &&
      existing.summary === input.summary &&
      existing.consumedAt === null &&
      new Date(existing.expiresAt).getTime() > nowMs &&
      JSON.stringify([...existing.operations].sort()) === JSON.stringify(sortedOps)
    ) {
      return existing;
    }
  }

  const token = `wp_${randomBytes(16).toString("hex")}`;
  const proposal: WriteProposal = {
    token,
    slug: input.slug,
    summary: input.summary,
    operations: input.operations,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + input.ttlMs).toISOString(),
    consumedAt: null,
    consumedOps: [],
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
    throw new WriteGateError(
      "Proposal already consumed",
      "token_consumed",
      "Each token is single-use. Propose a new token for this operation.",
    );
  }

  const expiresAtMs = new Date(proposal.expiresAt).getTime();
  if (nowMs > expiresAtMs) {
    throw new WriteGateError(
      formatExpiryMessage(proposal, nowMs, expiresAtMs),
      "token_expired",
      `Run: spoc write propose --summary="..." --ops="..." --slug=${proposal.slug}`,
    );
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
        `Run: spoc write propose "<summary>" --ops=<op> --slug=<slug> --json`,
    );
  }

  const proposal = store.get(token) ?? loadProposalFromDisk(token);
  if (!proposal) {
    throw new WriteGateError("Proposal not found");
  }

  // Backfill consumedOps for proposals that predate the multi-op budget feature.
  if (!Array.isArray(proposal.consumedOps)) {
    proposal.consumedOps = proposal.consumedAt === null ? [] : ["__legacy__"];
  }

  const expiresAtMs = new Date(proposal.expiresAt).getTime();
  if (nowMs > expiresAtMs) {
    throw new WriteGateError(
      formatExpiryMessage(proposal, nowMs, expiresAtMs),
      "token_expired",
      `Run: spoc write propose --summary="..." --ops="..." --slug=${proposal.slug}`,
    );
  }

  if (proposal.slug !== slug) {
    throw new WriteGateError(`Project scope mismatch: proposal for "${proposal.slug}", target "${slug}"`);
  }

  // Per-op budget: every entry in operations[] is one consumable slot.
  // Match the requested op (canonical-normalized) against unconsumed slots.
  if (proposal.consumedOps.length >= proposal.operations.length) {
    throw new WriteGateError(
      "Proposal budget exhausted (all op-slots already consumed)",
      "token_consumed",
      `Each op-slot in the proposal is single-use. The proposal authorized ${proposal.operations.length} mutation(s); all have been spent. Re-propose for additional writes.`,
    );
  }

  const normalizedRequest = normalizeOpName(operation);
  const normalizedSlots = proposal.operations.map(normalizeOpName);
  const normalizedConsumed = [...proposal.consumedOps];

  // Find an unconsumed slot matching the request: walk slots, decrement
  // available count by removing one matching entry from a copy of consumed.
  let slotMatched = false;
  for (const slot of normalizedSlots) {
    if (slot !== normalizedRequest) continue;
    const consumedIdx = normalizedConsumed.indexOf(slot);
    if (consumedIdx === -1) {
      // Found an unconsumed slot for this op
      slotMatched = true;
      break;
    }
    // This slot is already consumed; remove from working copy and keep looking
    normalizedConsumed.splice(consumedIdx, 1);
  }

  if (!slotMatched) {
    const remaining = normalizedSlots.filter((s, i) => {
      const tally = normalizedSlots.slice(0, i + 1).filter((x) => x === s).length;
      const consumedTally = proposal.consumedOps.filter((x) => normalizeOpName(x) === s).length;
      return tally > consumedTally;
    });
    const uniqueRemaining = [...new Set(remaining)];
    throw new WriteGateError(
      `Operation mismatch: proposal authorizes [${proposal.operations.join(", ")}], requested "${operation}". Remaining budget: [${uniqueRemaining.join(", ") || "none"}]`,
    );
  }

  // Consume one slot
  proposal.consumedOps.push(normalizedRequest);
  if (proposal.consumedAt === null) {
    proposal.consumedAt = new Date(nowMs).toISOString();
  }
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
