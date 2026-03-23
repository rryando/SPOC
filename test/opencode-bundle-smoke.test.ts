import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

const root = resolve(import.meta.dirname, "..");
const bundleRoot = resolve(root, "opencode/superpowers");
const manifestPath = resolve(bundleRoot, "manifest.json");
const runtimeManifestPath = resolve(bundleRoot, "bundle-runtime.json");
const skillsDir = resolve(bundleRoot, "skills");
// sourceRoot IS the skills directory — point at the skills/ subdir within the bundle
const repoLocalSourceRoot = resolve(bundleRoot, "skills");

type InstallerManifest = {
  bundleId: string;
  installMode: string;
  sourceRoot: string;
  skills: {
    source: string;
    destination: string;
  };
  plugin: {
    required: boolean;
    source: string;
  };
  agents: Array<{
    source: string;
    destination: string;
  }>;
};

type RuntimeManifest = {
  sourceRoot: string;
  skills: Record<string, string[]>;
  agents: string[];
  plugin: string[];
  excludePatterns: string[];
};

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function listRelativeFiles(rootPath: string, currentPath = rootPath): string[] {
  const entries = readdirSync(currentPath, { withFileTypes: true });

  return entries.flatMap((entry) => {
    const entryPath = resolve(currentPath, entry.name);

    if (entry.isDirectory()) {
      return listRelativeFiles(rootPath, entryPath);
    }

    return [dirname(entryPath) === rootPath
      ? entry.name
      : `${entryPath.slice(rootPath.length + 1).replace(/\\/g, "/")}`];
  });
}

function runBundleBuild(outputRoot: string, sourceRoot: string) {
  return spawnSync("node", [resolve(root, "scripts/build-opencode-superpowers-bundle.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      SPOC_SUPERPOWERS_OUTPUT_ROOT: outputRoot,
      SPOC_SUPERPOWERS_SOURCE_ROOT: sourceRoot,
    },
    encoding: "utf-8",
  });
}

describe("opencode superpowers bundle", () => {
  it("ships a manifest with required install metadata", () => {
    const manifest = readJsonFile<InstallerManifest>(manifestPath);

    expect(manifest.bundleId).toBe("spoc-opencode-superpowers");
    expect(manifest.installMode).toBe("opencode-superpowers");
    expect(manifest.sourceRoot).toBe("opencode/superpowers");
    expect(manifest.skills.source).toBe("skills");
    expect(manifest.skills.destination).toBe("skills/superpowers");
    expect(manifest.plugin.required).toBe(true);
    expect(manifest.plugin.source).toBe(".opencode/plugins/superpowers.js");
    expect(manifest.agents).toEqual([]);
  });

  it("ships bundle-runtime.json alongside manifest.json", () => {
    const runtimeManifest = readJsonFile<RuntimeManifest>(runtimeManifestPath);

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(runtimeManifestPath)).toBe(true);
    expect(dirname(runtimeManifestPath)).toBe(dirname(manifestPath));
    expect(Object.keys(runtimeManifest).sort()).toEqual([
      "agents",
      "excludePatterns",
      "plugin",
      "skills",
      "sourceRoot",
    ]);
    expect(runtimeManifest.sourceRoot).toBe("~/.config/opencode/skills/superpowers");
    expect(runtimeManifest.excludePatterns).toEqual([
      "**/references/**",
      "**/examples/**",
      "**/CREATION-LOG.md",
      "**/test-pressure-*.md",
    ]);
  });

  it("includes the exact runtime-manifest bundle payload", () => {
    const runtimeManifest = readJsonFile<RuntimeManifest>(runtimeManifestPath);
    const outputRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-smoke-"));

    expect(readdirSync(skillsDir).sort()).toEqual(
      Object.keys(runtimeManifest.skills).sort(),
    );

    try {
      const result = runBundleBuild(outputRoot, repoLocalSourceRoot);

      expect(result.status).toBe(0);
      expect(
        readdirSync(resolve(outputRoot, "skills"), { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
      ).toEqual(
        Object.keys(runtimeManifest.skills)
          .sort()
          .map((skillName) => ({ name: skillName, isDirectory: true })),
      );

      for (const [skillName, files] of Object.entries(runtimeManifest.skills)) {
        const bundledSkillDir = resolve(outputRoot, "skills", skillName);

        expect(listRelativeFiles(bundledSkillDir).sort()).toEqual([...files].sort());

        for (const relativeFilePath of files) {
          expect(existsSync(resolve(bundledSkillDir, relativeFilePath))).toBe(true);
        }
      }

      if (runtimeManifest.agents.length > 0) {
        expect(listRelativeFiles(resolve(outputRoot, "agents")).sort()).toEqual(
          runtimeManifest.agents
            .map((agentPath) => agentPath.replace(/^agents\//, ""))
            .sort(),
        );
      }

      for (const agentPath of runtimeManifest.agents) {
        expect(existsSync(resolve(outputRoot, agentPath))).toBe(true);
      }

      const pluginsDir = resolve(outputRoot, ".opencode", "plugins");
      const actualPluginFiles = existsSync(pluginsDir)
        ? listRelativeFiles(pluginsDir).sort()
        : [];
      expect(actualPluginFiles).toEqual(
        runtimeManifest.plugin
          .map((pluginPath) => pluginPath.replace(/^\.opencode\/plugins\//, ""))
          .sort(),
      );

      for (const pluginPath of runtimeManifest.plugin) {
        expect(existsSync(resolve(outputRoot, pluginPath))).toBe(true);
      }
    } finally {
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });

  it("keeps the opencode bundle in package publish files", () => {
    const pkg = readJsonFile<{ files: string[] }>(resolve(root, "package.json"));

    expect(pkg.files).toContain("opencode/");
    expect(pkg.files).toContain("skills/");
  });

  it("creates an isolated OpenCode config home for installer tests", async () => {
    await withTempHomeDir(async (homeDir) => {
      expect(existsSync(resolve(homeDir, ".config", "opencode"))).toBe(true);
    });
  });
});
