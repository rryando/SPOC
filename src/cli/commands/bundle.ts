// ---------------------------------------------------------------------------
// Bundle commands — lint-bundle, deploy-superpowers (registry-based)
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { type CLIResult, type CommandFlags, defineCommand } from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

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

async function handleLintBundle(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
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
  mutation: true,
  params: {
    "bundle-root": { type: "string", description: "Override bundle root directory" },
    "config-root": { type: "string", description: "Override config root directory" },
  },
  handler: handleDeploySuperpowers,
});

async function handleDeploySuperpowers(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const bundleRoot = params["bundle-root"] as string | undefined;
  const configRoot = params["config-root"] as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldDeploy: true });
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
