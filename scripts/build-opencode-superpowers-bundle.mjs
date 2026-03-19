import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const defaultManifestPath = resolve(repoRoot, "opencode/superpowers/bundle-runtime.json");
const defaultOutputRoot = resolve(repoRoot, "opencode/superpowers");
// Files that are repo-authored and must not be pruned, but are NOT sourced
// from the user's installed location — they live in the repo bundle itself.
const preservedOutputFiles = new Set([
  "manifest.json",
  "bundle-runtime.json",
  ".opencode/plugins/superpowers.js",
]);

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function looksWindowsAbsolute(filePath) {
  return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

function assertNoReservedPathSegments(candidatePath, reportedPath = candidatePath) {
  const normalizedPath = normalizeRelativePath(candidatePath);

  if (!normalizedPath || normalizedPath === ".") {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  if (isAbsolute(normalizedPath) || looksWindowsAbsolute(normalizedPath)) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  for (const segment of normalizedPath.split("/")) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`Invalid declared runtime path: ${reportedPath}`);
    }
  }

  return normalizedPath;
}

function assertSafeOutputPath(candidatePath, reportedPath = candidatePath) {
  const normalizedPath = normalizeRelativePath(candidatePath);

  if (!normalizedPath || normalizedPath === ".") {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  if (isAbsolute(normalizedPath) || looksWindowsAbsolute(normalizedPath)) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

function assertPathWithinCategoryRoot(candidatePath, categoryRoot, reportedPath = candidatePath) {
  const normalizedPath = assertSafeOutputPath(candidatePath, reportedPath);
  const normalizedCategoryRoot = assertNoReservedPathSegments(categoryRoot, reportedPath);
  const categoryRelativePath = normalizeRelativePath(relative(normalizedCategoryRoot, normalizedPath));

  if (
    normalizedPath !== normalizedCategoryRoot
    && (categoryRelativePath.startsWith("../") || categoryRelativePath === "..")
  ) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

function assertTopLevelMarkdownFile(candidatePath, categoryRoot, reportedPath = candidatePath) {
  const normalizedPath = assertPathWithinCategoryRoot(candidatePath, categoryRoot, reportedPath);
  const normalizedCategoryRoot = assertNoReservedPathSegments(categoryRoot, reportedPath);
  const categoryRelativePath = normalizeRelativePath(relative(normalizedCategoryRoot, normalizedPath));

  if (!categoryRelativePath || categoryRelativePath.includes("/") || !categoryRelativePath.endsWith(".md")) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

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

function listDeclaredFiles(runtimeManifest) {
  const declaredFiles = [];

  for (const [skillName, skillFiles] of Object.entries(runtimeManifest.skills ?? {})) {
    for (const skillFile of skillFiles) {
      const normalizedSkillName = normalizeRelativePath(skillName);
      const normalizedSkillFile = normalizeRelativePath(skillFile);
      const declaredPath = `skills/${normalizedSkillName}/${normalizedSkillFile}`;

      assertNoReservedPathSegments(normalizedSkillName, declaredPath);
      assertNoReservedPathSegments(normalizedSkillFile, declaredPath);
      assertSafeOutputPath(declaredPath);

      declaredFiles.push({
        declaredPath,
        validationRoot: `skills/${normalizedSkillName}`,
      });
    }
  }

  for (const agentFile of runtimeManifest.agents ?? []) {
    const declaredPath = assertTopLevelMarkdownFile(
      assertNoReservedPathSegments(normalizeRelativePath(agentFile)),
      "agents",
      agentFile,
    );

    declaredFiles.push({
      declaredPath,
      validationRoot: "agents",
    });
  }

  for (const pluginFile of runtimeManifest.plugin ?? []) {
    const declaredPath = assertPathWithinCategoryRoot(
      assertNoReservedPathSegments(normalizeRelativePath(pluginFile)),
      ".opencode/plugins",
      pluginFile,
    );

    declaredFiles.push({
      declaredPath,
      validationRoot: ".opencode/plugins",
    });
  }

  return declaredFiles;
}

function validateDeclaredPath(relativePath, outputRoot, validationRoot) {
  const normalizedPath = assertSafeOutputPath(relativePath);
  const normalizedValidationRoot = assertSafeOutputPath(validationRoot, relativePath);

  const outputPath = resolve(outputRoot, normalizedPath);
  const outputRelativePath = normalizeRelativePath(relative(outputRoot, outputPath));

  if (outputRelativePath.startsWith("../") || outputRelativePath === "..") {
    throw new Error(`Invalid declared runtime path: ${relativePath}`);
  }

  const validationRelativePath = normalizeRelativePath(
    relative(normalizedValidationRoot, outputRelativePath),
  );

  if (validationRelativePath.startsWith("../") || validationRelativePath === "..") {
    throw new Error(`Invalid declared runtime path: ${relativePath}`);
  }

  return normalizedPath;
}

function ensureParentDirectory(filePath) {
  mkdirSync(dirname(filePath), { recursive: true });
}

function listSourceSkillNames(sourceRoot) {
  const skillsDirectory = resolve(sourceRoot, "skills");

  if (!existsSync(skillsDirectory)) {
    return [];
  }

  return readdirSync(skillsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((skillName) => existsSync(resolve(skillsDirectory, skillName, "SKILL.md")));
}

function listSourceAgentPaths(sourceRoot) {
  const agentsDirectory = resolve(sourceRoot, "agents");

  if (!existsSync(agentsDirectory)) {
    return [];
  }

  return readdirSync(agentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `agents/${entry.name}`);
}

function assertSourceParity(runtimeManifest, sourceRoot) {
  const declaredSkillNames = new Set(Object.keys(runtimeManifest.skills ?? {}));
  const declaredAgentPaths = new Set((runtimeManifest.agents ?? []).map((agentPath) => normalizeRelativePath(agentPath)));

  for (const skillName of listSourceSkillNames(sourceRoot)) {
    if (!declaredSkillNames.has(skillName)) {
      throw new Error(`Missing runtime manifest skill entry: ${skillName}`);
    }
  }

  for (const agentPath of listSourceAgentPaths(sourceRoot)) {
    if (!declaredAgentPaths.has(agentPath)) {
      throw new Error(`Missing runtime manifest agent entry: ${agentPath}`);
    }
  }
}

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
  assertSourceParity(runtimeManifest, sourceRoot);
  const declaredFiles = listDeclaredFiles(runtimeManifest);
  const allowedOutputFiles = new Set([
    ...declaredFiles.map((entry) => entry.declaredPath),
    ...preservedOutputFiles,
  ]);

  defaultOutputRootCurrent = outputRoot;

  for (const { declaredPath, validationRoot } of declaredFiles) {
    const relativePath = validateDeclaredPath(declaredPath, outputRoot, validationRoot);
    const sourcePath = resolve(sourceRoot, relativePath);
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
