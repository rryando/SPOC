import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";
import {
  buildOpencodeSuperpowersInstallPlan,
  detectOpencodeSuperpowersInstall,
  getSourceOpencodeSuperpowersBundleInfo,
  installBundledOpencodeSuperpowers,
  installBundledOpencodeSuperpowersWithHooks,
  readInstalledOpencodeSuperpowersManifest,
  writeInstalledOpencodeSuperpowersManifest,
  type SourceOpencodeSuperpowersManifest,
} from "../src/cli/opencode-superpowers.js";

const bundleRoot = resolve(import.meta.dirname, "..", "opencode", "superpowers");
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

function readSourceManifest(): SourceOpencodeSuperpowersManifest {
  return JSON.parse(readFileSync(sourceManifestPath, "utf-8")) as SourceOpencodeSuperpowersManifest;
}

function readExpectedSourceBundleVersion(): string {
  const sourceManifest = readSourceManifest();

  if (sourceManifest.bundleVersionSource !== "package.json") {
    throw new Error(`Unsupported bundleVersionSource in test: ${sourceManifest.bundleVersionSource}`);
  }

  return (JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageJson).version;
}

function curatedBundlePayloadFiles(): string[] {
  const runtimeManifest = readRuntimeManifest();

  return [
    "bundle-runtime.json",
    "manifest.json",
    ...Object.entries(runtimeManifest.skills).flatMap(([skillName, files]) =>
      files.map((relativePath) => `skills/${skillName}/${relativePath}`),
    ),
    ...runtimeManifest.agents,
    ...runtimeManifest.plugin,
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
          resolve(
            homeDir,
            ".config",
            "opencode",
            "skills",
            "superpowers",
            skillName,
            relativePath,
          ),
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

const sourceManifestWithConfigOnly: SourceOpencodeSuperpowersManifest = {
  bundleId: "spoc-opencode-superpowers",
  installMode: "opencode-superpowers",
  bundleVersionSource: "package.json",
  sourceRoot: "opencode/superpowers",
  skills: { source: "skills", destination: "skills/superpowers" },
  agents: [],
  ownedPaths: ["skills/superpowers", "plugins/superpowers.js"],
  plugin: {
    required: true,
    source: ".opencode/plugins/superpowers.js",
    destination: "plugins/superpowers.js",
  },
  config: {
    requiredMerges: [{ path: ["plugin", "superpowers"], value: { type: "local" } }],
  },
};

const sourceManifestWithoutConfigRequirement: SourceOpencodeSuperpowersManifest = {
  ...sourceManifestWithConfigOnly,
  config: { requiredMerges: [] },
};

const ownedManifest = {
  bundleId: "spoc-opencode-superpowers",
  installMode: "opencode-superpowers",
  sourceBundleVersion: expectedSourceBundleVersion,
  sourceBundleHash: "abc",
  installedAt: "2026-03-18T00:00:00.000Z",
  ownedPaths: ["skills/superpowers", "plugins/superpowers.js"],
};

describe("opencode superpowers install detection", () => {
  it("returns absent when nothing is installed", async () => {
    await withTempHomeDir(async () => {
      expect(detectOpencodeSuperpowersInstall().state).toBe("absent");
    });
  });

  it("returns foreign-existing when destination paths exist without SPOC manifest", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "skills", "superpowers"), {
        recursive: true,
      });

      expect(detectOpencodeSuperpowersInstall().state).toBe("foreign-existing");
    });
  });

  it("returns foreign-existing when only required config merge keys exist", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "opencode.json"),
        JSON.stringify({ plugin: { superpowers: { type: "local" } } }, null, 2),
        "utf-8",
      );

      expect(
        detectOpencodeSuperpowersInstall(sourceManifestWithConfigOnly).state,
      ).toBe("foreign-existing");
    });
  });

  it("returns foreign-existing when a SPOC manifest exists but owned paths are missing", async () => {
    await withTempHomeDir(async () => {
      writeInstalledOpencodeSuperpowersManifest(ownedManifest);
      expect(detectOpencodeSuperpowersInstall().state).toBe("foreign-existing");
    });
  });

  it("reports spoc-managed when the installed manifest exists and all declared owned paths exist", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "skills", "superpowers"), {
        recursive: true,
      });
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js"),
        "plugin",
        "utf-8",
      );
      writeInstalledOpencodeSuperpowersManifest(ownedManifest);

      expect(readInstalledOpencodeSuperpowersManifest()).toMatchObject(ownedManifest);
      expect(detectOpencodeSuperpowersInstall(sourceManifestWithoutConfigRequirement).state).toBe(
        "spoc-managed",
      );
    });
  });
});

describe("opencode superpowers bundle identity", () => {
  it("ships bundle-runtime.json alongside the installer manifest", () => {
    expect(existsSync(sourceManifestPath)).toBe(true);
    expect(existsSync(runtimeManifestPath)).toBe(true);
  });

  it("computes deterministic source bundle metadata", () => {
    const info = getSourceOpencodeSuperpowersBundleInfo();
    const curatedPayloadFiles = curatedBundlePayloadFiles();

    expect(info.bundleId).toBe("spoc-opencode-superpowers");
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
      writeInstalledOpencodeSuperpowersManifest({
        ...ownedManifest,
        sourceBundleHash: "old-hash",
        ownedPaths: ["skills/superpowers", "plugins/old-superpowers.js"],
      });

      const plan = buildOpencodeSuperpowersInstallPlan();

      expect(plan.pathsToRemove).toContain("plugins/old-superpowers.js");
      expect(plan.pathsToWrite).toContain("skills/superpowers");
      expect(plan.pathsToWrite).toContain("plugins/superpowers.js");
      expect(plan.pathsToWrite).not.toContain("agent/code-reviewer.md");
    });
  });
});

describe("opencode superpowers installer", () => {
  it("refuses to replace a foreign install without auto-confirm", async () => {
    await withTempHomeDir(async (homeDir) => {
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js"),
        "foreign plugin",
        "utf-8",
      );

      expect(() => installBundledOpencodeSuperpowers()).toThrow(/manual confirmation is required/i);
    });
  });

  it("replaces a foreign install when auto-confirmed and installs the curated runtime payload", async () => {
    await withTempHomeDir(async (homeDir) => {
      const foreignPluginPath = resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js");
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(foreignPluginPath, "foreign plugin", "utf-8");

      const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: true });

      expect(result.status).toBe("installed");
      expectRuntimePayloadInstalled(homeDir);
      expect(readFileSync(foreignPluginPath, "utf-8")).not.toBe("foreign plugin");
      expect(readInstalledOpencodeSuperpowersManifest()?.sourceBundleVersion).toBe(
        expectedSourceBundleVersion,
      );
    });
  });

  it("installs bundled runtime payload and writes the installed manifest without plugin config merges", async () => {
    await withTempHomeDir(async (homeDir) => {
      const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: true });

      expect(result.status).toBe("installed");
      expectRuntimePayloadInstalled(homeDir);

      expect(
        JSON.parse(readFileSync(resolve(homeDir, ".config", "opencode", "opencode.json"), "utf-8")),
      ).not.toHaveProperty("plugin");
      expect(readInstalledOpencodeSuperpowersManifest()?.ownedPaths).toContain("skills/superpowers");
    });
  });

  it("removes previously owned paths that are no longer in the source manifest", async () => {
    await withTempHomeDir(async (homeDir) => {
      const stalePath = resolve(homeDir, ".config", "opencode", "plugins", "old-superpowers.js");
      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(stalePath, "stale", "utf-8");
      writeInstalledOpencodeSuperpowersManifest({
        ...ownedManifest,
        ownedPaths: ["skills/superpowers", "plugins/old-superpowers.js"],
      });

      installBundledOpencodeSuperpowers({ autoConfirmReplacement: true });
      expect(existsSync(stalePath)).toBe(false);
    });
  });

  it("restores the prior installed manifest and opencode state when a mid-install failure occurs", async () => {
    await withTempHomeDir(async (homeDir) => {
      const foreignPlugin = resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js");
      const configPath = resolve(homeDir, ".config", "opencode", "opencode.json");
      const priorManifest = {
        ...ownedManifest,
        sourceBundleHash: "previous-hash",
      };

      mkdirSync(resolve(homeDir, ".config", "opencode", "plugins"), { recursive: true });
      writeFileSync(foreignPlugin, "foreign plugin", "utf-8");
      writeFileSync(configPath, JSON.stringify({ existing: true }, null, 2), "utf-8");
      writeInstalledOpencodeSuperpowersManifest(priorManifest);

      expect(() =>
        installBundledOpencodeSuperpowersWithHooks({
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
      expect(readInstalledOpencodeSuperpowersManifest()).toMatchObject(priorManifest);
    });
  });
});
