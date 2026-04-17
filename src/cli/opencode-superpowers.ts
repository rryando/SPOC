import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { PACKAGE_ROOT } from "../utils/paths.js";
import { readJsonSafeSync, validateJson } from "../utils/json.js";
import {
  opencodeSourceManifestSchema,
  opencodeInstalledManifestSchema,
  packageJsonSchema,
} from "../utils/json-schemas.js";

export type InstallState = "absent" | "spoc-managed" | "foreign-existing";

export interface ConfigMerge {
  path: string[];
  value: unknown;
}

export interface SourceOpencodeSuperpowersManifest {
  bundleId: string;
  installMode: string;
  bundleVersionSource: string;
  sourceRoot: string;
  skills: {
    source: string;
    destination: string;
  };
  agents: Array<{
    source: string;
    destination: string;
  }>;
  ownedPaths: string[];
  plugin: {
    required: boolean;
    source: string;
    destination: string;
  };
  config: {
    requiredMerges: ConfigMerge[];
  };
}

export interface InstalledOpencodeSuperpowersManifest {
  bundleId: string;
  installMode: string;
  sourceBundleVersion: string;
  sourceBundleHash: string;
  installedAt: string;
  ownedPaths: string[];
}

export interface InstallDetectionResult {
  state: InstallState;
  installedManifest: InstalledOpencodeSuperpowersManifest | null;
}

export interface SourceBundleInfo {
  bundleId: string;
  sourceBundleVersion: string;
  sourceBundleHash: string;
}

export interface InstallPlan {
  pathsToWrite: string[];
  pathsToRemove: string[];
  sourceBundleVersion: string;
  sourceBundleHash: string;
  requiredConfigMerges: ConfigMerge[];
}

export interface InstallOptions {
  autoConfirmReplacement?: boolean;
}

interface InstallHooks {
  afterConfigPreparedBeforeManifestWrite?: () => void;
}

export interface InstallResult {
  status: "installed";
  summary: string;
}

function readJsonFile(path: string): Record<string, unknown> {
  return readJsonSafeSync<Record<string, unknown>>(path) ?? {};
}

function writeJsonFile(path: string, data: object): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function deepSet(obj: Record<string, unknown>, pathParts: string[], value: unknown): void {
  let current = obj;

  for (let i = 0; i < pathParts.length - 1; i++) {
    const part = pathParts[i];
    const next = current[part];

    if (typeof next !== "object" || next === null || Array.isArray(next)) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }

  current[pathParts[pathParts.length - 1]] = value;
}

export function opencodeRootDir(): string {
  const envConfigDir = process.env.OPENCODE_CONFIG_DIR;
  if (envConfigDir) {
    return resolve(envConfigDir);
  }

  return resolve(process.env.HOME ?? homedir(), ".config", "opencode");
}

function sourceBundleRootDir(): string {
  return resolve(PACKAGE_ROOT, "opencode", "superpowers");
}

function sourceBundlePath(relativePath: string): string {
  return resolve(sourceBundleRootDir(), relativePath);
}

function opencodePath(relativePath: string): string {
  return resolve(opencodeRootDir(), relativePath);
}

export function opencodeInstalledManifestPath(): string {
  return opencodePath(".spoc-superpowers.json");
}

export function opencodeConfigPath(): string {
  return opencodePath("opencode.json");
}

export function readSourceOpencodeSuperpowersManifest(): SourceOpencodeSuperpowersManifest {
  const manifestPath = sourceBundlePath("manifest.json");
  const raw = readJsonSafeSync<unknown>(manifestPath);
  if (raw === undefined) {
    throw new Error(`Failed to read source manifest at ${manifestPath}`);
  }
  return validateJson(raw, opencodeSourceManifestSchema, manifestPath) as SourceOpencodeSuperpowersManifest;
}

export function readInstalledOpencodeSuperpowersManifest(): InstalledOpencodeSuperpowersManifest | null {
  const manifestPath = opencodeInstalledManifestPath();
  if (!existsSync(manifestPath)) {
    return null;
  }

  const raw = readJsonSafeSync<unknown>(manifestPath);
  if (raw === undefined) return null;
  return validateJson(raw, opencodeInstalledManifestSchema, manifestPath);
}

export function writeInstalledOpencodeSuperpowersManifest(
  manifest: InstalledOpencodeSuperpowersManifest,
): void {
  writeJsonFile(opencodeInstalledManifestPath(), manifest);
}

function configMergeExists(config: Record<string, unknown>, merge: ConfigMerge): boolean {
  let current: unknown = config;

  for (const part of merge.path) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return false;
    }

    current = (current as Record<string, unknown>)[part];
  }

  return JSON.stringify(current) === JSON.stringify(merge.value);
}

function hasAnyExistingInstallEvidence(sourceManifest: SourceOpencodeSuperpowersManifest): boolean {
  if (sourceManifest.ownedPaths.some((ownedPath) => existsSync(opencodePath(ownedPath)))) {
    return true;
  }

  if (sourceManifest.agents.some((agent) => existsSync(opencodePath(agent.destination)))) {
    return true;
  }

  if (
    sourceManifest.plugin.required &&
    existsSync(opencodePath(sourceManifest.plugin.destination))
  ) {
    return true;
  }

  const configPath = opencodeConfigPath();
  if (existsSync(configPath)) {
    const config = readJsonFile(configPath);
    return sourceManifest.config.requiredMerges.some((merge) => configMergeExists(config, merge));
  }

  return false;
}

function allOwnedPathsExist(manifest: InstalledOpencodeSuperpowersManifest): boolean {
  return manifest.ownedPaths.every((ownedPath) => existsSync(opencodePath(ownedPath)));
}

export function detectOpencodeSuperpowersInstall(
  sourceManifest: SourceOpencodeSuperpowersManifest = readSourceOpencodeSuperpowersManifest(),
): InstallDetectionResult {
  const installedManifest = readInstalledOpencodeSuperpowersManifest();

  if (installedManifest) {
    const validManagedInstall =
      installedManifest.installMode === sourceManifest.installMode &&
      installedManifest.bundleId === sourceManifest.bundleId &&
      allOwnedPathsExist(installedManifest) &&
      (sourceManifest.config.requiredMerges.length === 0 ||
        hasAnyExistingInstallEvidence(sourceManifest));

    return {
      state: validManagedInstall ? "spoc-managed" : "foreign-existing",
      installedManifest,
    };
  }

  return {
    state: hasAnyExistingInstallEvidence(sourceManifest) ? "foreign-existing" : "absent",
    installedManifest: null,
  };
}

function readPackageVersion(): string {
  const pkgPath = resolve(PACKAGE_ROOT, "package.json");
  const raw = readJsonSafeSync<unknown>(pkgPath);
  if (raw === undefined) {
    throw new Error(`Failed to read ${pkgPath}`);
  }
  return validateJson(raw, packageJsonSchema, pkgPath).version;
}

function listBundleFiles(dir: string = sourceBundleRootDir()): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const absolute = resolve(dir, entry);
    const stat = statSync(absolute);

    if (stat.isDirectory()) {
      files.push(...listBundleFiles(absolute));
    } else {
      files.push(absolute);
    }
  }

  return files.sort((a, b) =>
    relative(sourceBundleRootDir(), a).localeCompare(relative(sourceBundleRootDir(), b)),
  );
}

export function getSourceOpencodeSuperpowersBundleInfo(): SourceBundleInfo {
  const manifest = readSourceOpencodeSuperpowersManifest();
  const hash = createHash("sha256");

  for (const file of listBundleFiles()) {
    hash.update(relative(sourceBundleRootDir(), file));
    hash.update("\0");
    hash.update(readFileSync(file));
    hash.update("\0");
  }

  return {
    bundleId: manifest.bundleId,
    sourceBundleVersion: readPackageVersion(),
    sourceBundleHash: hash.digest("hex"),
  };
}

export function buildOpencodeSuperpowersInstallPlan(): InstallPlan {
  const sourceManifest = readSourceOpencodeSuperpowersManifest();
  const installedManifest = readInstalledOpencodeSuperpowersManifest();
  const bundleInfo = getSourceOpencodeSuperpowersBundleInfo();

  return {
    pathsToWrite: sourceManifest.ownedPaths,
    pathsToRemove:
      installedManifest == null
        ? []
        : installedManifest.ownedPaths.filter(
            (ownedPath) => !sourceManifest.ownedPaths.includes(ownedPath),
          ),
    sourceBundleVersion: bundleInfo.sourceBundleVersion,
    sourceBundleHash: bundleInfo.sourceBundleHash,
    requiredConfigMerges: sourceManifest.config.requiredMerges,
  };
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function removePathIfExists(path: string): void {
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
}

function _copySourceToDestination(sourceRelative: string, destinationRelative: string): void {
  const source = sourceBundlePath(sourceRelative);
  const destination = opencodePath(destinationRelative);
  const sourceStat = statSync(source);

  removePathIfExists(destination);
  ensureParent(destination);

  if (sourceStat.isDirectory()) {
    cpSync(source, destination, { recursive: true });
  } else {
    copyFileSync(source, destination);
  }
}

function createTempDir(prefix: string): string {
  const tempDir = opencodePath(`${prefix}-${Date.now().toString(36)}`);
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function stageSourcePath(sourceRelative: string, stagingDir: string): string {
  const source = sourceBundlePath(sourceRelative);
  const stagedPath = resolve(stagingDir, sourceRelative);

  ensureParent(stagedPath);

  if (statSync(source).isDirectory()) {
    cpSync(source, stagedPath, { recursive: true });
  } else {
    copyFileSync(source, stagedPath);
  }

  return stagedPath;
}

function backupExistingPath(pathRelative: string, backupDir: string): string | null {
  const targetPath = opencodePath(pathRelative);
  if (!existsSync(targetPath)) {
    return null;
  }

  const backupPath = resolve(backupDir, pathRelative);
  ensureParent(backupPath);
  cpSync(targetPath, backupPath, { recursive: true });
  removePathIfExists(targetPath);
  return backupPath;
}

function restoreBackup(backupPath: string, destinationRelative: string): void {
  const destination = opencodePath(destinationRelative);
  ensureParent(destination);
  cpSync(backupPath, destination, { recursive: true });
}

function applyConfigMerges(
  baseConfig: Record<string, unknown>,
  merges: ConfigMerge[],
): Record<string, unknown> {
  const nextConfig = JSON.parse(JSON.stringify(baseConfig)) as Record<string, unknown>;

  for (const merge of merges) {
    deepSet(nextConfig, merge.path, merge.value);
  }

  return nextConfig;
}

function manifestFromPlan(
  plan: InstallPlan,
  sourceManifest: SourceOpencodeSuperpowersManifest,
): InstalledOpencodeSuperpowersManifest {
  return {
    bundleId: sourceManifest.bundleId,
    installMode: sourceManifest.installMode,
    sourceBundleVersion: plan.sourceBundleVersion,
    sourceBundleHash: plan.sourceBundleHash,
    installedAt: new Date().toISOString(),
    ownedPaths: sourceManifest.ownedPaths,
  };
}

function installInternal(options: InstallOptions = {}, hooks: InstallHooks = {}): InstallResult {
  const sourceManifest = readSourceOpencodeSuperpowersManifest();
  const detection = detectOpencodeSuperpowersInstall(sourceManifest);

  if (detection.state === "foreign-existing" && !options.autoConfirmReplacement) {
    throw new Error(
      "Manual confirmation is required before replacing an existing OpenCode superpowers install.",
    );
  }

  mkdirSync(opencodeRootDir(), { recursive: true });

  const plan = buildOpencodeSuperpowersInstallPlan();
  const stagedDir = createTempDir(".spoc-superpowers-stage");
  const backupDir = createTempDir(".spoc-superpowers-backup");
  const previousConfigExists = existsSync(opencodeConfigPath());
  const previousConfig = previousConfigExists ? readFileSync(opencodeConfigPath(), "utf-8") : null;
  const previousManifest = detection.installedManifest;
  const backupMap = new Map<string, string>();

  try {
    const stagedSkills = stageSourcePath(sourceManifest.skills.source, stagedDir);
    const stagedPlugin = sourceManifest.plugin.required
      ? stageSourcePath(sourceManifest.plugin.source, stagedDir)
      : null;
    const stagedAgents = sourceManifest.agents.map((agent) => ({
      ...agent,
      stagedPath: stageSourcePath(agent.source, stagedDir),
    }));

    for (const pathToRemove of plan.pathsToRemove) {
      removePathIfExists(opencodePath(pathToRemove));
    }

    for (const ownedPath of sourceManifest.ownedPaths) {
      const backup = backupExistingPath(ownedPath, backupDir);
      if (backup) {
        backupMap.set(ownedPath, backup);
      }
    }

    removePathIfExists(opencodePath(sourceManifest.skills.destination));
    cpSync(stagedSkills, opencodePath(sourceManifest.skills.destination), { recursive: true });

    if (sourceManifest.plugin.required && stagedPlugin !== null) {
      removePathIfExists(opencodePath(sourceManifest.plugin.destination));
      ensureParent(opencodePath(sourceManifest.plugin.destination));
      copyFileSync(stagedPlugin, opencodePath(sourceManifest.plugin.destination));
    }

    for (const agent of stagedAgents) {
      removePathIfExists(opencodePath(agent.destination));
      ensureParent(opencodePath(agent.destination));
      copyFileSync(agent.stagedPath, opencodePath(agent.destination));
    }

    const preparedConfig = applyConfigMerges(
      readJsonFile(opencodeConfigPath()),
      plan.requiredConfigMerges,
    );
    hooks.afterConfigPreparedBeforeManifestWrite?.();
    writeJsonFile(opencodeConfigPath(), preparedConfig);
    writeInstalledOpencodeSuperpowersManifest(manifestFromPlan(plan, sourceManifest));

    return {
      status: "installed",
      summary:
        detection.state === "spoc-managed"
          ? "Re-synced bundled superpowers"
          : "Installed bundled superpowers",
    };
  } catch (error) {
    for (const [destinationRelative, backupPath] of backupMap.entries()) {
      removePathIfExists(opencodePath(destinationRelative));
      restoreBackup(backupPath, destinationRelative);
    }

    if (previousConfig === null) {
      removePathIfExists(opencodeConfigPath());
    } else {
      ensureParent(opencodeConfigPath());
      writeFileSync(opencodeConfigPath(), previousConfig, "utf-8");
    }

    if (previousManifest == null) {
      removePathIfExists(opencodeInstalledManifestPath());
    } else {
      writeInstalledOpencodeSuperpowersManifest(previousManifest);
    }

    throw error;
  } finally {
    removePathIfExists(stagedDir);
    removePathIfExists(backupDir);
  }
}

export function installBundledOpencodeSuperpowers(options: InstallOptions = {}): InstallResult {
  return installInternal(options);
}

export function installBundledOpencodeSuperpowersWithHooks(
  options: InstallOptions & { hooks?: InstallHooks } = {},
): InstallResult {
  return installInternal(options, options.hooks ?? {});
}
