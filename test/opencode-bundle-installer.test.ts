import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSpocBundleInstallPlan,
  detectSpocBundleInstall,
  getSourceSpocBundleInfo,
  installSpocBundle,
  installSpocBundleWithHooks,
  readInstalledSpocBundleManifest,
  type SourceSpocBundleManifest,
  writeInstalledSpocBundleManifest,
} from "../src/cli/bundle-installer.js";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

const bundleRoot = resolve(import.meta.dirname, "..", "opencode", "spoc");
const sourceManifestPath = resolve(bundleRoot, "manifest.json");
const runtimeManifestPath = resolve(bundleRoot, "bundle-runtime.json");
const packageJsonPath = resolve(import.meta.dirname, "..", "package.json");

type RuntimeManifest = {
  skills: Record<string, string[]>;
  agents: string[];
  plugin: string[];
};

type PackageJson = {
  version: string;
};

function readRuntimeManifest(): RuntimeManifest {
  return JSON.parse(readFileSync(runtimeManifestPath, "utf-8")) as RuntimeManifest;
}

function readSourceManifest(): SourceSpocBundleManifest {
  return JSON.parse(readFileSync(sourceManifestPath, "utf-8")) as SourceSpocBundleManifest;
}

function readExpectedSourceBundleVersion(): string {
  const sourceManifest = readSourceManifest();

  if (sourceManifest.bundleVersionSource !== "package.json") {
    throw new Error(
      `Unsupported bundleVersionSource in test: ${sourceManifest.bundleVersionSource}`,
    );
  }

  return (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson).version;
}

// SPOC-native skill files: authored in this repo, not sourced from upstream.
// Must match the skill entries in scripts/build-opencode-bundle.mjs preservedOutputFiles.
const spocNativeSkillFiles = [
  "skills/loop/SKILL.md",
  "skills/caveman-commit/SKILL.md",
  "skills/caveman-review/SKILL.md",
  "skills/init-project/SKILL.md",
];

function curatedBundlePayloadFiles(): string[] {
  const runtimeManifest = readRuntimeManifest();

  return [
    // Repo-authored preserved files included in bundle identity
    "bundle-runtime.json",
    "manifest.json",
    ".opencode/plugins/spoc.js",
    ...Object.entries(runtimeManifest.skills).flatMap(([skillName, files]) =>
      files.map((relativePath) => `skills/${skillName}/${relativePath}`),
    ),
    ...runtimeManifest.agents,
    ...runtimeManifest.plugin,
    // SPOC-native skills live in the bundle but aren't declared in bundle-runtime.json
    ...spocNativeSkillFiles,
    // Agent prompt files (repo-authored, referenced via {file:} in manifest.json)
    "prompts/code-reviewer.txt",
    "prompts/docs-researcher.txt",
    "prompts/oncall-ops.txt",
    "prompts/qa-analyst.txt",
    "prompts/software-engineer.txt",
    "prompts/spoc-docs.txt",
    "prompts/system-architect.txt",
    "prompts/tech-architect.txt",
    // Orchestrator prompt files generated from src/cli/spoc-orchestrate*.ts by
    // build-opencode-bundle.mjs and committed to the repo bundle.
    "prompts/spoc-orchestrate.txt",
    "prompts/spoc-orchestrate-caveman.txt",
  ].sort((a, b) => a.localeCompare(b));
}

function computeBundleHash(relativePaths: string[]): string {
  const hash = createHash("sha256");

  for (const relativePath of relativePaths) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(readFileSync(resolve(bundleRoot, relativePath)));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function expectRuntimePayloadInstalled(homeDir: string): void {
  const runtimeManifest = readRuntimeManifest();

  for (const [skillName, files] of Object.entries(runtimeManifest.skills)) {
    for (const relativePath of files) {
      expect(
        existsSync(
          resolve(homeDir, ".config", "opencode", "skills", "spoc", skillName, relativePath),
        ),
      ).toBe(true);
    }
  }

  for (const pluginPath of runtimeManifest.plugin) {
    expect(
      existsSync(resolve(homeDir, ".config", "opencode", pluginPath.replace(/^\.opencode\//, ""))),
    ).toBe(true);
  }

  for (const agentPath of runtimeManifest.agents) {
    expect(
      existsSync(resolve(homeDir, ".config", "opencode", agentPath.replace(/^agents\//, "agent/"))),
    ).toBe(true);
  }
}

const expectedSourceBundleVersion = readExpectedSourceBundleVersion();

const sourceManifestWithConfigOnly: SourceSpocBundleManifest = {
  bundleId: "spoc-opencode-bundle",
  installMode: "opencode-spoc",
  bundleVersionSource: "package.json",
  sourceRoot: "opencode/spoc",
  skills: { source: "skills", destination: "skills/spoc" },
  agents: [],
  ownedPaths: ["skills/spoc", "plugins/spoc.js"],
  plugin: {
    required: true,
    source: ".opencode/plugins/spoc.js",
    destination: "plugins/spoc.js",
  },
  config: {
    requiredMerges: [{ path: ["plugin", "spoc"], value: { type: "local" } }],
  },
};

const sourceManifestWithoutConfigRequirement: SourceSpocBundleManifest = {
  ...sourceManifestWithConfigOnly,
  config: { requiredMerges: [] },
};

const ownedManifest = {
  bundleId: "spoc-opencode-bundle",
  installMode: "opencode-spoc",
  sourceBundleVersion: expectedSourceBundleVersion,
  sourceBundleHash: "abc",
  installedAt: "2026-03-18T00:00:00.000Z",
  ownedPaths: ["skills/spoc", "plugins/spoc.js"],
};

describe("opencode SPOC bundle install detection", () => {
  it("returns absent when nothing is installed", async () => {
    await withTempHomeDir(async () => {
      expect(detectSpocBundleInstall().state).toBe("absent");
    });
  });

  it("returns foreign-existing when destination paths exist without SPOC manifest", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "skills", "spoc"), {
        recursive: true,
      });

      expect(detectSpocBundleInstall().state).toBe("foreign-existing");
    });
  });

  it("returns foreign-existing when only required config merge keys exist", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "opencode.json"),
        JSON.stringify({ plugin: { spoc: { type: "local" } } }, null, 2),
        "utf-8",
      );

      expect(detectSpocBundleInstall(sourceManifestWithConfigOnly).state).toBe(
        "foreign-existing",
      );
    });
  });

  it("returns foreign-existing when a SPOC manifest exists but owned paths are missing", async () => {
    await withTempHomeDir(async () => {
      writeInstalledSpocBundleManifest(ownedManifest);
      expect(detectSpocBundleInstall().state).toBe("foreign-existing");
    });
  });

  it("reports spoc-managed when the installed manifest exists and all declared owned paths exist", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "skills", "spoc"), {
        recursive: true,
      });
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "plugins", "spoc.js"),
        "plugin",
        "utf-8",
      );
      writeInstalledSpocBundleManifest(ownedManifest);

      expect(readInstalledSpocBundleManifest()).toMatchObject(ownedManifest);
      expect(detectSpocBundleInstall(sourceManifestWithoutConfigRequirement).state).toBe(
        "spoc-managed",
      );
    });
  });
});

describe("opencode SPOC bundle bundle identity", () => {
  it("ships bundle-runtime.json alongside the installer manifest", () => {
    expect(existsSync(sourceManifestPath)).toBe(true);
    expect(existsSync(runtimeManifestPath)).toBe(true);
  });

  it("computes deterministic source bundle metadata", () => {
    const info = getSourceSpocBundleInfo();
    const curatedPayloadFiles = curatedBundlePayloadFiles();

    expect(info.bundleId).toBe("spoc-opencode-bundle");
    expect(info.sourceBundleVersion).toBe(expectedSourceBundleVersion);
    expect(info.sourceBundleHash).toMatch(/^[a-f0-9]{64}$/);
    expect(curatedPayloadFiles).toContain("bundle-runtime.json");
    expect(curatedPayloadFiles).toContain("manifest.json");
    for (const relativePath of curatedPayloadFiles) {
      expect(existsSync(resolve(bundleRoot, relativePath))).toBe(true);
    }
    expect(info.sourceBundleHash).toBe(computeBundleHash(curatedPayloadFiles));
  });

  it("plans removal for previously owned paths missing from the new source manifest", async () => {
    await withTempHomeDir(async () => {
      writeInstalledSpocBundleManifest({
        ...ownedManifest,
        sourceBundleHash: "old-hash",
        ownedPaths: ["skills/spoc", "plugins/old-superpowers.js"],
      });

      const plan = buildSpocBundleInstallPlan();

      expect(plan.pathsToRemove).toContain("plugins/old-superpowers.js");
      expect(plan.pathsToWrite).toContain("skills/spoc");
      expect(plan.pathsToWrite).toContain("plugins/spoc.js");
      expect(plan.pathsToWrite).not.toContain("agent/code-reviewer.md");
    });
  });
});

describe("opencode SPOC bundle installer", () => {
  it("refuses to replace a foreign install without auto-confirm", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "plugins", "spoc.js"),
        "foreign plugin",
        "utf-8",
      );

      expect(() => installSpocBundle()).toThrow(/manual confirmation is required/i);
    });
  });

  it("replaces a foreign install when auto-confirmed and installs the curated runtime payload", async () => {
    await withTempHomeDir(async (homeDir) => {
      const foreignPluginPath = resolve(
        homeDir,
        ".config",
        "opencode",
        "plugins",
        "spoc.js",
      );
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(foreignPluginPath, "foreign plugin", "utf-8");

      const result = installSpocBundle({ autoConfirmReplacement: true });

      expect(result.status).toBe("installed");
      expectRuntimePayloadInstalled(homeDir);
      expect(readFileSync(foreignPluginPath, "utf-8")).not.toBe("foreign plugin");
      expect(readInstalledSpocBundleManifest()?.sourceBundleVersion).toBe(
        expectedSourceBundleVersion,
      );
    });
  });

  it("installs bundled runtime payload and writes the bundled model presets into opencode.json", async () => {
    await withTempHomeDir(async (homeDir) => {
      const result = installSpocBundle({ autoConfirmReplacement: true });
      const opencodeConfig = JSON.parse(
        readFileSync(resolve(homeDir, ".config", "opencode", "opencode.json"), "utf-8"),
      );

      expect(result.status).toBe("installed");
      expectRuntimePayloadInstalled(homeDir);

      expect(opencodeConfig).toMatchObject({
        model: "github-copilot/claude-sonnet-4.6",
        agent: {
          build: {
            model: "github-copilot/claude-sonnet-4.6",
          },
          plan: {
            model: "github-copilot/claude-opus-4.6",
          },
          general: {
            model: "github-copilot/claude-opus-4.6",
          },
          explore: {
            model: "github-copilot/claude-haiku-4.5",
          },
          "code-reviewer": {
            mode: "subagent",
            model: "github-copilot/claude-haiku-4.5",
          },
          "docs-researcher": {
            mode: "subagent",
            model: "github-copilot/claude-opus-4.6",
          },
          "tech-architect": {
            mode: "subagent",
            model: "github-copilot/claude-haiku-4.5",
          },
        },
      });
      expect(opencodeConfig).not.toHaveProperty("plugin");
      expect(readInstalledSpocBundleManifest()?.ownedPaths).toContain(
        "skills/spoc",
      );
    });
  });

  it("removes previously owned paths that are no longer in the source manifest", async () => {
    await withTempHomeDir(async (homeDir) => {
      const stalePath = resolve(homeDir, ".config", "opencode", "plugins", "old-superpowers.js");
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(stalePath, "stale", "utf-8");
      writeInstalledSpocBundleManifest({
        ...ownedManifest,
        ownedPaths: ["skills/spoc", "plugins/old-superpowers.js"],
      });

      installSpocBundle({ autoConfirmReplacement: true });
      expect(existsSync(stalePath)).toBe(false);
    });
  });

  it("restores the prior installed manifest and opencode state when a mid-install failure occurs", async () => {
    await withTempHomeDir(async (homeDir) => {
      const foreignPlugin = resolve(homeDir, ".config", "opencode", "plugins", "spoc.js");
      const configPath = resolve(homeDir, ".config", "opencode", "opencode.json");
      const priorManifest = {
        ...ownedManifest,
        sourceBundleHash: "previous-hash",
      };

      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(foreignPlugin, "foreign plugin", "utf-8");
      writeFileSync(configPath, JSON.stringify({ existing: true }, null, 2), "utf-8");
      writeInstalledSpocBundleManifest(priorManifest);

      expect(() =>
        installSpocBundleWithHooks({
          autoConfirmReplacement: true,
          hooks: {
            afterConfigPreparedBeforeManifestWrite: () => {
              throw new Error("boom");
            },
          },
        }),
      ).toThrow("boom");

      expect(readFileSync(foreignPlugin, "utf-8")).toBe("foreign plugin");
      expect(JSON.parse(readFileSync(configPath, "utf-8"))).toEqual({ existing: true });
      expect(readInstalledSpocBundleManifest()).toMatchObject(priorManifest);
    });
  });
});
