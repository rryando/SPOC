#!/usr/bin/env node
// Deploy opencode SPOC bundle bundle from repo to user config.
//
// Direction: repo → config ONLY. Never writes config → repo.
//
// Env vars:
//   DEPLOY_BUNDLE_ROOT  — override bundle root (default: opencode/spoc)
//   DEPLOY_CONFIG_ROOT  — override config root (default: ~/.config/opencode)
//   DEPLOY_DRY_RUN      — "false" to actually copy; anything else = dry-run (default: dry-run)
//
// Outputs JSON to stdout: DeployResult
// Exit code: 0 on success, 1 on error.

import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultBundleRoot = resolve(repoRoot, "opencode/spoc");
const defaultConfigRoot = resolve(homedir(), ".config/opencode");

const bundleRoot = process.env.DEPLOY_BUNDLE_ROOT
  ? resolve(repoRoot, process.env.DEPLOY_BUNDLE_ROOT)
  : defaultBundleRoot;
const configRoot = process.env.DEPLOY_CONFIG_ROOT
  ? resolve(repoRoot, process.env.DEPLOY_CONFIG_ROOT)
  : defaultConfigRoot;
// Dry-run by default. Only DEPLOY_DRY_RUN=false (exact string) triggers real writes.
const dryRun = process.env.DEPLOY_DRY_RUN !== "false";

function listAllFiles(rootPath, currentPath = rootPath) {
  if (!existsSync(currentPath)) return [];
  const entries = readdirSync(currentPath, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const entryPath = resolve(currentPath, entry.name);
    if (entry.isDirectory()) return listAllFiles(rootPath, entryPath);
    return [relative(rootPath, entryPath).replace(/\\/g, "/")];
  });
}

function ensureParentDir(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

async function main() {
  const manifestPath = resolve(bundleRoot, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json not found at ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  // Build mapping: config-relative path → bundle-absolute path
  const deployMap = new Map();

  // Skills: bundle skills/<name>/<file> → config skills/spoc/<name>/<file>
  const skillsSourceDir = resolve(bundleRoot, manifest.skills.source);
  if (existsSync(skillsSourceDir)) {
    const skillFiles = listAllFiles(skillsSourceDir);
    for (const file of skillFiles) {
      const configRelative = `${manifest.skills.destination}/${file}`;
      const bundleAbsolute = resolve(skillsSourceDir, file);
      deployMap.set(configRelative, bundleAbsolute);
    }
  }

  // Plugin
  if (manifest.plugin && manifest.plugin.source) {
    const pluginSource = resolve(bundleRoot, manifest.plugin.source);
    if (existsSync(pluginSource)) {
      deployMap.set(manifest.plugin.destination, pluginSource);
    }
  }

  // Agents (sub-agent prompts) — bundle prompts/<file> → config prompts/<file>
  for (const agent of manifest.agents ?? []) {
    const agentSource = resolve(bundleRoot, agent.source);
    if (existsSync(agentSource)) {
      deployMap.set(agent.destination, agentSource);
    }
  }

  // Determine file states
  const filesAdded = [];
  const filesChanged = [];
  const filesUnchanged = [];
  let restartRequired = false;

  for (const [configRelative, bundleAbsolute] of deployMap) {
    const configAbsolute = resolve(configRoot, configRelative);
    const sourceContent = readFileSync(bundleAbsolute, "utf-8");

    const isNew = !existsSync(configAbsolute);
    const isChanged =
      !isNew && readFileSync(configAbsolute, "utf-8") !== sourceContent;

    if (isNew) {
      filesAdded.push(configRelative);
    } else if (isChanged) {
      filesChanged.push(configRelative);
    } else {
      filesUnchanged.push(configRelative);
    }

    // Plugin change/add → restart required (reuses isNew/isChanged, no duplicate read)
    if (configRelative === manifest.plugin?.destination && (isNew || isChanged)) {
      restartRequired = true;
    }

    // Actually copy if not dry-run
    if (!dryRun) {
      ensureParentDir(configAbsolute);
      copyFileSync(bundleAbsolute, configAbsolute);
    }
  }

  // Detect files to remove: files in owned paths in config that are NOT in deployMap
  const filesRemoved = [];
  for (const ownedPath of manifest.ownedPaths ?? []) {
    const ownedAbsolute = resolve(configRoot, ownedPath);
    if (!existsSync(ownedAbsolute)) continue;

    // Owned path may be a file or directory
    if (!lstatSync(ownedAbsolute).isDirectory()) {
      if (!deployMap.has(ownedPath)) {
        filesRemoved.push(ownedPath);
        if (!dryRun) {
          rmSync(ownedAbsolute, { force: true });
        }
      }
      continue;
    }

    const existingFiles = listAllFiles(ownedAbsolute);
    for (const file of existingFiles) {
      const configRelative = `${ownedPath}/${file}`;
      if (!deployMap.has(configRelative)) {
        filesRemoved.push(configRelative);
        if (!dryRun) {
          rmSync(resolve(configRoot, configRelative), { force: true });
        }
      }
    }
  }

  // After successful deploy, ensure spoc CLI is globally registered
  if (!dryRun) {
    try {
      const { execFileSync } = await import("node:child_process");
      const initScript = resolve(repoRoot, "scripts/spoc-init.mjs");
      if (existsSync(initScript)) {
        execFileSync(process.execPath, [initScript], { stdio: "pipe" });
      }
    } catch {
      // Non-fatal: CLI registration is a convenience, not a requirement
    }
  }

  const result = {
    dryRun,
    source: bundleRoot,
    destination: configRoot,
    filesAdded,
    filesChanged,
    filesRemoved,
    filesUnchanged,
    restartRequired,
    cliRegistered: !dryRun,
    ...(restartRequired && {
      restartGuidance: "Plugin file changed. Restart opencode for changes to take effect.",
    }),
  };

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
