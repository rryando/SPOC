import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

const root = resolve(import.meta.dirname, "..");
const manifestPath = resolve(root, "opencode/superpowers/manifest.json");
const pluginPath = resolve(root, "opencode/superpowers/.opencode/plugins/superpowers.js");
const reviewerPath = resolve(root, "opencode/superpowers/agents/code-reviewer.md");
const skillsDir = resolve(root, "opencode/superpowers/skills");

const expectedSkills = [
  "brainstorming",
  "dispatching-parallel-agents",
  "executing-plans",
  "finishing-a-development-branch",
  "receiving-code-review",
  "requesting-code-review",
  "subagent-driven-development",
  "systematic-debugging",
  "test-driven-development",
  "using-git-worktrees",
  "using-superpowers",
  "verification-before-completion",
  "writing-plans",
  "writing-skills",
];

describe("opencode superpowers bundle", () => {
  it("ships a manifest with required install metadata", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

    expect(manifest.bundleId).toBe("spoc-opencode-superpowers");
    expect(manifest.installMode).toBe("opencode-superpowers");
    expect(manifest.sourceRoot).toBe("opencode/superpowers");
    expect(manifest.skills.source).toBe("skills");
    expect(manifest.skills.destination).toBe("skills/superpowers");
    expect(manifest.plugin.required).toBe(true);
    expect(manifest.plugin.source).toBe(".opencode/plugins/superpowers.js");
    expect(manifest.agents).toEqual([
      {
        source: "agents/code-reviewer.md",
        destination: "agent/code-reviewer.md",
      },
    ]);
  });

  it("includes the curated skill tree, plugin, and reviewer payload files", () => {
    expect(existsSync(pluginPath)).toBe(true);
    expect(existsSync(reviewerPath)).toBe(true);
    expect(readdirSync(skillsDir).sort()).toEqual(expectedSkills);

    for (const skillName of expectedSkills) {
      expect(existsSync(resolve(skillsDir, skillName, "SKILL.md"))).toBe(true);
    }
  });

  it("keeps the opencode bundle in package publish files", () => {
    const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));

    expect(pkg.files).toContain("opencode/");
    expect(pkg.files).toContain("skills/");
  });

  it("creates an isolated OpenCode config home for installer tests", async () => {
    await withTempHomeDir(async (homeDir) => {
      expect(existsSync(resolve(homeDir, ".config", "opencode"))).toBe(true);
    });
  });
});
