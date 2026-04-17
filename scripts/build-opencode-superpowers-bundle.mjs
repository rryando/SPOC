import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  normalizeRelativePath,
  assertSourceParity,
  listDeclaredFiles,
  validateDeclaredPath,
  assertSafeOutputPath,
} from "./lib/bundle-helpers.mjs";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultManifestPath = resolve(repoRoot, "opencode/superpowers/bundle-runtime.json");
const defaultOutputRoot = resolve(repoRoot, "opencode/superpowers");
// Files that are repo-authored and must not be pruned, but are NOT sourced
// from the user's installed location — they live in the repo bundle itself.
const preservedOutputFiles = new Set([
  "manifest.json",
  "bundle-runtime.json",
  ".opencode/plugins/superpowers.js",
  // SPOC-native skills (not sourced from upstream, authored in this repo)
  "skills/loop/SKILL.md",
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

function main() {
  const manifestPath = process.env.SPOC_SUPERPOWERS_RUNTIME_MANIFEST
    ? resolve(repoRoot, process.env.SPOC_SUPERPOWERS_RUNTIME_MANIFEST)
    : defaultManifestPath;
  const manifestDirectory = dirname(manifestPath);
  const runtimeManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const sourceRoot = process.env.SPOC_SUPERPOWERS_SOURCE_ROOT
    ? resolve(repoRoot, process.env.SPOC_SUPERPOWERS_SOURCE_ROOT)
    : resolvePath(runtimeManifest.sourceRoot, manifestDirectory);
  const outputRoot = process.env.SPOC_SUPERPOWERS_OUTPUT_ROOT
    ? resolve(repoRoot, process.env.SPOC_SUPERPOWERS_OUTPUT_ROOT)
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
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
