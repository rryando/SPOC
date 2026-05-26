// ---------------------------------------------------------------------------
// Bundle commands — lint-bundle, deploy-superpowers (registry-based)
// ---------------------------------------------------------------------------

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { requireWriteGate, WriteGateError } from "../../utils/write-gate.js";

// ---------------------------------------------------------------------------
// lint-bundle
// ---------------------------------------------------------------------------

defineCommand({
  path: "lint-bundle",
  description: "Validate opencode-bundle manifest integrity",
  mutation: false,
  params: {
    "bundle-root": { type: "string", description: "Override bundle root directory" },
    "config-root": { type: "string", description: "Override config root directory" },
  },
  handler: handleLintBundle,
});

async function handleLintBundle(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const bundleRoot = params["bundle-root"] as string | undefined;
  const configRoot = params["config-root"] as string | undefined;

  try {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const scriptPath = resolve(repoRoot, "scripts/lint-bundle.mjs");

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    if (bundleRoot) env.BUNDLE_LINT_BUNDLE_ROOT = bundleRoot;
    if (configRoot) env.BUNDLE_LINT_CONFIG_ROOT = configRoot;

    const proc = spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
    });

    if (proc.stdout) {
      const result = JSON.parse(proc.stdout);
      return success(result);
    }

    return failure("internal_error", proc.stderr || "lint-bundle produced no output");
  } catch (err) {
    return failure("internal_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// deploy-superpowers
// ---------------------------------------------------------------------------

defineCommand({
  path: "deploy-superpowers",
  description: "Deploy opencode-bundle to ~/.config/opencode",
  gated: true,
  gateName: "deploy-superpowers",
  mutation: true,
  params: {
    token: { type: "string", description: "Write-gate token" },
    "bundle-root": { type: "string", description: "Override bundle root directory" },
    "config-root": { type: "string", description: "Override config root directory" },
  },
  handler: handleDeploySuperpowers,
});

async function handleDeploySuperpowers(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const token = params.token as string | undefined;
  const bundleRoot = params["bundle-root"] as string | undefined;
  const configRoot = params["config-root"] as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldDeploy: true });
  }

  try {
    requireWriteGate(token, "_global", "tool:deploy_superpowers");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  try {
    const repoRoot = resolve(import.meta.dirname, "../../..");
    const scriptPath = resolve(repoRoot, "scripts/deploy-opencode-bundle.mjs");

    const env: Record<string, string> = { ...process.env } as Record<string, string>;
    env.DEPLOY_DRY_RUN = "false";
    if (bundleRoot) env.DEPLOY_BUNDLE_ROOT = bundleRoot;
    if (configRoot) env.DEPLOY_CONFIG_ROOT = configRoot;

    const proc = spawnSync("node", [scriptPath], {
      cwd: repoRoot,
      env,
      encoding: "utf-8",
    });

    if (proc.stdout) {
      const result = JSON.parse(proc.stdout);
      return success(result);
    }

    return failure("internal_error", proc.stderr || "deploy script produced no output");
  } catch (err) {
    return failure("internal_error", err instanceof Error ? err.message : String(err));
  }
}
