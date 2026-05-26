// ---------------------------------------------------------------------------
// Write commands — propose and apply (registry-based)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import {
  createWriteProposal,
  consumeWriteProposalToken,
  WriteGateError,
} from "../../utils/write-gate.js";
import { getProjectDir } from "../../utils/paths.js";

// ---------------------------------------------------------------------------
// write propose
// ---------------------------------------------------------------------------

defineCommand({
  path: "write propose",
  description: "Create a write-gate proposal token",
  mutation: false,
  params: {
    summary: { type: "string", required: true, positional: 0, description: "Human-readable summary of planned changes" },
    ops: { type: "string", required: true, description: "Comma-separated operation names" },
    slug: { type: "string", required: true, description: "Target project slug" },
    ttl: { type: "number", default: 600_000, description: "Token TTL in milliseconds" },
  },
  handler: handleWritePropose,
});

async function handleWritePropose(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const summary = params.summary as string;
  const opsRaw = params.ops as string;
  const ttlMs = (params.ttl as number) ?? 600_000;

  // Validate project exists
  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const operations = opsRaw.split(",").map((o) => o.trim());

  if (flags.dryRun) {
    return success({ dryRun: true, wouldCreate: { slug, summary, ops: operations, ttl: ttlMs } });
  }

  try {
    const proposal = createWriteProposal({ slug, summary, operations, ttlMs });
    return success({
      token: proposal.token,
      slug: proposal.slug,
      summary: proposal.summary,
      operations: proposal.operations,
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt,
    });
  } catch (err) {
    return failure("write_gate_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// write apply
// ---------------------------------------------------------------------------

defineCommand({
  path: "write apply",
  description: "Consume a write-gate proposal token",
  gated: true,
  gateName: "write-apply",
  mutation: true,
  params: {
    token: { type: "string", required: true, positional: 0, description: "The proposal token to consume" },
    slug: { type: "string", required: true, description: "Target project slug" },
  },
  handler: handleWriteApply,
});

async function handleWriteApply(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const token = params.token as string;
  const slug = params.slug as string;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldConsume: { token, slug } });
  }

  try {
    const proposal = consumeWriteProposalToken(token, slug);
    return success({
      consumed: true,
      token: proposal.token,
      slug: proposal.slug,
      summary: proposal.summary,
      operations: proposal.operations,
      consumedAt: proposal.consumedAt,
    });
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    return failure("write_gate_error", err instanceof Error ? err.message : String(err));
  }
}
