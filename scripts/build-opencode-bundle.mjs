import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  normalizeRelativePath,
  assertSourceParity,
  listDeclaredFiles,
  validateDeclaredPath,
  assertSafeOutputPath,
} from "./lib/bundle-helpers.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultManifestPath = resolve(repoRoot, "opencode/spoc/bundle-runtime.json");
const defaultOutputRoot = resolve(repoRoot, "opencode/spoc");
// Files that are repo-authored and must not be pruned, but are NOT sourced
// from the user's installed location — they live in the repo bundle itself.
const preservedOutputFiles = new Set([
  "manifest.json",
  "bundle-runtime.json",
  ".opencode/plugins/spoc.js",
  // SPOC-native skills (not sourced from upstream, authored in this repo)
  "skills/loop/SKILL.md",
  // init-project skill — SPOC-native (not in upstream superpowers).
  // Mirrors the orchestrator's INIT workflow with full operational detail
  // (graphify sub-flow, typed-agent dispatch, knowledge categories).
  "skills/init-project/SKILL.md",
  // Caveman skills — adapted from https://github.com/JuliusBrussee/caveman (MIT).
  // Shipped alongside SPOC Caveman orchestrator so sub-agents can produce
  // terse commits and PR review comments when caveman mode is active.
  "skills/caveman-commit/SKILL.md",
  "skills/caveman-review/SKILL.md",
  // Agent prompt files (repo-authored, referenced via {file:} in manifest.json)
  "prompts/software-engineer.txt",
  "prompts/tech-architect.txt",
  "prompts/qa-analyst.txt",
  "prompts/oncall-ops.txt",
  "prompts/spoc-docs.txt",
  "prompts/system-architect.txt",
  "prompts/code-reviewer.txt",
  "prompts/docs-researcher.txt",
  // Orchestrator prompt files — generated from src/cli/spoc-orchestrate*.ts during
  // bundle build (see generateOrchestratorPrompts() below). TS modules remain the
  // canonical source; these .txt files are committed mirrors so the bundle is
  // self-describing and all prompts live in one directory. writeOpencodeAgent()
  // in src/cli/instructions.ts also writes these files at runtime to
  // ~/.config/opencode/prompts/, but the bundle copy provides install-time parity.
  "prompts/spoc-orchestrate.txt",
  "prompts/spoc-orchestrate-caveman.txt",
]);

function expandHome(filePath) {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }

  return filePath;
}

function resolvePath(inputPath, basePath) {
  const expandedPath = expandHome(inputPath);
  return isAbsolute(expandedPath) ? expandedPath : resolve(basePath, expandedPath);
}

function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

// Skill names that are SPOC-native (repo-authored, not upstream-sourced).
// Derived from preservedOutputFiles skill entries.
const spocNativeSkillNames = new Set(
  [...preservedOutputFiles].filter((p) => p.startsWith("skills/")).map((p) => p.split("/")[1]),
);

function pruneUndeclaredFiles(rootPath, allowedFiles) {
  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    const entryPath = resolve(rootPath, entry.name);

    if (entry.isDirectory()) {
      pruneUndeclaredFiles(entryPath, allowedFiles);

      if (readdirSync(entryPath).length === 0) {
        rmSync(entryPath, { recursive: true, force: true });
      }

      continue;
    }

    const relativePath = normalizeRelativePath(relative(defaultOutputRootCurrent, entryPath));
    if (!allowedFiles.has(relativePath)) {
      rmSync(entryPath, { force: true });
    }
  }
}

let defaultOutputRootCurrent = defaultOutputRoot;

/**
 * Generates the SPOC Orchestrator and SPOC Caveman prompt .txt files into
 * <outputRoot>/prompts/. The TypeScript modules src/cli/spoc-orchestrate.ts
 * and src/cli/spoc-orchestrate-caveman.ts remain the canonical source; these
 * .txt files are committed mirrors so the bundle is self-describing alongside
 * the static sub-agent prompts.
 *
 * Requires `tsc` to have run first (dist/cli/spoc-orchestrate.js must exist).
 * package.json's build:opencode-bundle chains `tsc` before this script.
 */
async function generateOrchestratorPrompts(outputRoot) {
  const orchestrateModulePath = resolve(repoRoot, "dist/cli/spoc-orchestrate.js");
  const cavemanModulePath = resolve(repoRoot, "dist/cli/spoc-orchestrate-caveman.js");

  if (!existsSync(orchestrateModulePath) || !existsSync(cavemanModulePath)) {
    throw new Error(
      `Compiled orchestrator modules missing. Run \`npm run build\` before bundle build.\n` +
        `  Expected: ${orchestrateModulePath}\n` +
        `  Expected: ${cavemanModulePath}`,
    );
  }

  const orchestrateModule = await import(pathToFileURL(orchestrateModulePath).href);
  const cavemanModule = await import(pathToFileURL(cavemanModulePath).href);

  const orchestrateText = orchestrateModule.ORCHESTRATE_PROMPT_TEXT;
  const cavemanText = cavemanModule.ORCHESTRATE_CAVEMAN_PROMPT_TEXT;

  if (typeof orchestrateText !== "string" || orchestrateText.length === 0) {
    throw new Error("ORCHESTRATE_PROMPT_TEXT not exported as non-empty string");
  }
  if (typeof cavemanText !== "string" || cavemanText.length === 0) {
    throw new Error("ORCHESTRATE_CAVEMAN_PROMPT_TEXT not exported as non-empty string");
  }

  const promptsDir = resolve(outputRoot, "prompts");
  mkdirSync(promptsDir, { recursive: true });

  const orchestratePath = resolve(promptsDir, "spoc-orchestrate.txt");
  const cavemanPath = resolve(promptsDir, "spoc-orchestrate-caveman.txt");

  // Banner prepended to every generated prompt file. Uses HTML comment syntax
  // so it's invisible when rendered as markdown but obvious to anyone opening
  // the .txt directly. LLMs treat HTML comments as out-of-band metadata, so
  // the banner does not pollute the prompt's actionable instructions.
  const banner = (sourceFile) =>
    `<!--\n` +
    `  AUTO-GENERATED — DO NOT EDIT.\n` +
    `  Source of truth: ${sourceFile}\n` +
    `  Regenerate: npm run build:opencode-bundle\n` +
    `  Edits to this file will be overwritten on the next build.\n` +
    `-->\n\n`;

  writeFileSync(
    orchestratePath,
    `${banner("src/cli/spoc-orchestrate.ts")}${orchestrateText}\n`,
    "utf-8",
  );
  writeFileSync(
    cavemanPath,
    `${banner("src/cli/spoc-orchestrate-caveman.ts")}${cavemanText}\n`,
    "utf-8",
  );
}

async function main() {
  const manifestPath = process.env.SPOC_BUNDLE_RUNTIME_MANIFEST
    ? resolve(repoRoot, process.env.SPOC_BUNDLE_RUNTIME_MANIFEST)
    : defaultManifestPath;
  const manifestDirectory = dirname(manifestPath);
  const runtimeManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const sourceRoot = process.env.SPOC_BUNDLE_SOURCE_ROOT
    ? resolve(repoRoot, process.env.SPOC_BUNDLE_SOURCE_ROOT)
    : resolvePath(runtimeManifest.sourceRoot, manifestDirectory);
  const outputRoot = process.env.SPOC_BUNDLE_OUTPUT_ROOT
    ? resolve(repoRoot, process.env.SPOC_BUNDLE_OUTPUT_ROOT)
    : defaultOutputRoot;
  assertSourceParity(runtimeManifest, sourceRoot, spocNativeSkillNames);
  const declaredFiles = listDeclaredFiles(runtimeManifest);
  const allowedOutputFiles = new Set([
    ...declaredFiles.map((entry) => entry.declaredPath),
    ...preservedOutputFiles,
  ]);

  defaultOutputRootCurrent = outputRoot;

  for (const { declaredPath, validationRoot } of declaredFiles) {
    const relativePath = validateDeclaredPath(declaredPath, outputRoot, validationRoot);
    // Skills are declared as "skills/<skill>/<file>" for output structure, but
    // sourceRoot IS the skills directory — strip the leading "skills/" when reading source.
    const sourceRelativePath = relativePath.startsWith("skills/")
      ? relativePath.slice("skills/".length)
      : relativePath;
    const sourcePath = resolve(sourceRoot, sourceRelativePath);
    if (!existsSync(sourcePath)) {
      throw new Error(`Missing declared runtime file: ${relativePath} (${sourcePath})`);
    }

    const outputPath = resolve(outputRoot, relativePath);
    ensureParentDirectory(outputPath);
    copyFileSync(sourcePath, outputPath);
  }

  mkdirSync(outputRoot, { recursive: true });
  pruneUndeclaredFiles(outputRoot, allowedOutputFiles);

  // Generate orchestrator prompt mirrors after prune so they always end up
  // on disk fresh from the canonical TS sources.
  await generateOrchestratorPrompts(outputRoot);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
