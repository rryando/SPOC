import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const deployScript = resolve(root, "scripts/deploy-opencode-superpowers.mjs");

type DeployResult = {
  dryRun: boolean;
  source: string;
  destination: string;
  filesAdded: string[];
  filesChanged: string[];
  filesRemoved: string[];
  filesUnchanged: string[];
  restartRequired: boolean;
  restartGuidance?: string;
};

function writeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

function runDeploy(env: Record<string, string>) {
  return spawnSync("node", [deployScript], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

function setupBundleRoot(tempRoot: string) {
  const bundleRoot = resolve(tempRoot, "bundle");
  // Minimal manifest.json
  const manifest = {
    bundleId: "spoc-opencode-superpowers",
    installMode: "opencode-superpowers",
    sourceRoot: "opencode/superpowers",
    skills: { source: "skills", destination: "skills/superpowers" },
    agents: [],
    // ownedPaths matches manifest schema: directories/files the deployer owns for removal tests
    ownedPaths: ["skills/superpowers", "plugins/superpowers.js"],
    plugin: {
      required: true,
      source: ".opencode/plugins/superpowers.js",
      destination: "plugins/superpowers.js",
    },
    config: { requiredMerges: [] },
  };
  writeFile(bundleRoot, "manifest.json", JSON.stringify(manifest, null, 2));
  writeFile(bundleRoot, "skills/planner/SKILL.md", "# Planner skill");
  writeFile(bundleRoot, "skills/planner/notes.md", "notes content");
  writeFile(bundleRoot, ".opencode/plugins/superpowers.js", "// plugin code");
  return bundleRoot;
}

describe("deploy-opencode-superpowers", () => {
  it("defaults to dry-run and reports files to add", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-dry-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.dryRun).toBe(true);
      expect(result.filesAdded).toContain("skills/superpowers/planner/SKILL.md");
      expect(result.filesAdded).toContain("skills/superpowers/planner/notes.md");
      expect(result.filesAdded).toContain("plugins/superpowers.js");
      // Dry-run: files should NOT actually be written
      expect(existsSync(resolve(configRoot, "skills/superpowers/planner/SKILL.md"))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("copies files when dryRun=false", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-write-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
        DEPLOY_DRY_RUN: "false",
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.dryRun).toBe(false);
      expect(result.filesAdded.length).toBeGreaterThan(0);
      // Files actually written
      expect(
        readFileSync(resolve(configRoot, "skills/superpowers/planner/SKILL.md"), "utf-8"),
      ).toBe("# Planner skill");
      expect(readFileSync(resolve(configRoot, "plugins/superpowers.js"), "utf-8")).toBe(
        "// plugin code",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("detects changed files when config already exists", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-change-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      // Pre-populate config with old content
      writeFile(configRoot, "skills/superpowers/planner/SKILL.md", "old content");
      writeFile(configRoot, "skills/superpowers/planner/notes.md", "notes content"); // same

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.filesChanged).toContain("skills/superpowers/planner/SKILL.md");
      expect(result.filesUnchanged).toContain("skills/superpowers/planner/notes.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("detects files to remove from owned paths", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-remove-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      // Config has a file no longer in bundle
      writeFile(configRoot, "skills/superpowers/obsolete/SKILL.md", "old skill");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.filesRemoved).toContain("skills/superpowers/obsolete/SKILL.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("removes files when dryRun=false", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-rm-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      writeFile(configRoot, "skills/superpowers/obsolete/SKILL.md", "old skill");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
        DEPLOY_DRY_RUN: "false",
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.filesRemoved).toContain("skills/superpowers/obsolete/SKILL.md");
      expect(existsSync(resolve(configRoot, "skills/superpowers/obsolete/SKILL.md"))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports restartRequired when plugin absent (first-time deploy)", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-restart-new-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      // No plugin in config — first-time deploy

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.restartRequired).toBe(true);
      expect(result.filesAdded).toContain("plugins/superpowers.js");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports restartRequired when plugin changed", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-restart-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      writeFile(configRoot, "plugins/superpowers.js", "// old plugin");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.restartRequired).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("includes restartGuidance in script output when restartRequired", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-guidance-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      writeFile(configRoot, "plugins/superpowers.js", "// old plugin");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.restartRequired).toBe(true);
      expect(result.restartGuidance).toBe(
        "Plugin file changed. Restart opencode for changes to take effect.",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("omits restartGuidance when restartRequired is false", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-no-guidance-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      // Pre-populate with identical content so no change
      writeFile(configRoot, "skills/superpowers/planner/SKILL.md", "# Planner skill");
      writeFile(configRoot, "skills/superpowers/planner/notes.md", "notes content");
      writeFile(configRoot, "plugins/superpowers.js", "// plugin code");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
      });

      expect(proc.status).toBe(0);
      const result = JSON.parse(proc.stdout) as DeployResult;
      expect(result.restartRequired).toBe(false);
      expect(result.restartGuidance).toBeUndefined();
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("never copies from config to repo (no reverse sync)", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "deploy-noreverse-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundleRoot(tempRoot);
      // Config has extra file that doesn't exist in bundle
      writeFile(configRoot, "skills/superpowers/planner/custom.md", "user custom");

      const proc = runDeploy({
        DEPLOY_BUNDLE_ROOT: bundleRoot,
        DEPLOY_CONFIG_ROOT: configRoot,
        DEPLOY_DRY_RUN: "false",
      });

      expect(proc.status).toBe(0);
      // The bundle should not have the custom file
      expect(existsSync(resolve(bundleRoot, "skills/planner/custom.md"))).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
