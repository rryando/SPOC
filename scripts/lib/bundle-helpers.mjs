import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, "/");
}

export function looksWindowsAbsolute(filePath) {
  return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath);
}

export function assertNoReservedPathSegments(candidatePath, reportedPath = candidatePath) {
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

export function assertSafeOutputPath(candidatePath, reportedPath = candidatePath) {
  const normalizedPath = normalizeRelativePath(candidatePath);

  if (!normalizedPath || normalizedPath === ".") {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  if (isAbsolute(normalizedPath) || looksWindowsAbsolute(normalizedPath)) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

export function assertPathWithinCategoryRoot(candidatePath, categoryRoot, reportedPath = candidatePath) {
  const normalizedPath = assertSafeOutputPath(candidatePath, reportedPath);
  const normalizedCategoryRoot = assertNoReservedPathSegments(categoryRoot, reportedPath);
  const categoryRelativePath = normalizeRelativePath(
    relative(normalizedCategoryRoot, normalizedPath),
  );

  if (
    normalizedPath !== normalizedCategoryRoot &&
    (categoryRelativePath.startsWith("../") || categoryRelativePath === "..")
  ) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

export function assertTopLevelMarkdownFile(candidatePath, categoryRoot, reportedPath = candidatePath) {
  const normalizedPath = assertPathWithinCategoryRoot(candidatePath, categoryRoot, reportedPath);
  const normalizedCategoryRoot = assertNoReservedPathSegments(categoryRoot, reportedPath);
  const categoryRelativePath = normalizeRelativePath(
    relative(normalizedCategoryRoot, normalizedPath),
  );

  if (
    !categoryRelativePath ||
    categoryRelativePath.includes("/") ||
    !categoryRelativePath.endsWith(".md")
  ) {
    throw new Error(`Invalid declared runtime path: ${reportedPath}`);
  }

  return normalizedPath;
}

export function listDeclaredFiles(runtimeManifest) {
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

export function listSourceSkillNames(sourceRoot) {
  if (!existsSync(sourceRoot)) {
    return [];
  }

  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((skillName) => existsSync(resolve(sourceRoot, skillName, "SKILL.md")));
}

export function listSourceAgentPaths(sourceRoot) {
  const agentsDirectory = resolve(sourceRoot, "agents");

  if (!existsSync(agentsDirectory)) {
    return [];
  }

  return readdirSync(agentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `agents/${entry.name}`);
}

export function assertSourceParity(runtimeManifest, sourceRoot, spocNativeSkillNames) {
  const declaredSkillNames = new Set(Object.keys(runtimeManifest.skills ?? {}));
  const declaredAgentPaths = new Set(
    (runtimeManifest.agents ?? []).map((agentPath) => normalizeRelativePath(agentPath)),
  );

  for (const skillName of listSourceSkillNames(sourceRoot)) {
    if (spocNativeSkillNames.has(skillName)) continue;
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

export function validateDeclaredPath(relativePath, outputRoot, validationRoot) {
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
