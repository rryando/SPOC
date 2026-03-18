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

const sourceManifestWithConfigOnly: SourceOpencodeSuperpowersManifest = {
  bundleId: "spoc-opencode-superpowers",
  installMode: "opencode-superpowers",
  bundleVersionSource: "package.json",
  sourceRoot: "opencode/superpowers",
  skills: { source: "skills", destination: "skills/superpowers" },
  agents: [
    { source: "agents/code-reviewer.md", destination: "agent/code-reviewer.md" },
  ],
  ownedPaths: ["skills/superpowers", "plugins/superpowers.js", "agent/code-reviewer.md"],
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
  sourceBundleVersion: "1.0.0",
  sourceBundleHash: "abc",
  installedAt: "2026-03-18T00:00:00.000Z",
  ownedPaths: ["skills/superpowers", "plugins/superpowers.js", "agent/code-reviewer.md"],
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
      mkdirSync(resolve(homeDir, ".config", "opencode", "agent"), { recursive: true });
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js"),
        "plugin",
        "utf-8",
      );
      writeFileSync(
        resolve(homeDir, ".config", "opencode", "agent", "code-reviewer.md"),
        "agent",
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
  it("computes deterministic source bundle metadata", () => {
    const info = getSourceOpencodeSuperpowersBundleInfo();

    expect(info.bundleId).toBe("spoc-opencode-superpowers");
    expect(info.sourceBundleVersion).toBe("1.0.0");
    expect(info.sourceBundleHash).toMatch(/^[a-f0-9]{64}$/);
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
      expect(plan.pathsToWrite).toContain("agent/code-reviewer.md");
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

  it("installs bundled files, applies config merges, and writes the installed manifest", async () => {
    await withTempHomeDir(async (homeDir) => {
      const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: true });

      expect(result.status).toBe("installed");
      expect(
        existsSync(
          resolve(
            homeDir,
            ".config",
            "opencode",
            "skills",
            "superpowers",
            "using-superpowers",
            "SKILL.md",
          ),
        ),
      ).toBe(true);
      expect(
        existsSync(resolve(homeDir, ".config", "opencode", "plugins", "superpowers.js")),
      ).toBe(true);
      expect(
        existsSync(resolve(homeDir, ".config", "opencode", "agent", "code-reviewer.md")),
      ).toBe(true);
      expect(
        JSON.parse(readFileSync(resolve(homeDir, ".config", "opencode", "opencode.json"), "utf-8")),
      ).toMatchObject({
        plugin: { superpowers: { type: "local" } },
      });
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
