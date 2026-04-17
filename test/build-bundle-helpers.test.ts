import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Import helpers that will be extracted into scripts/lib/bundle-helpers.mjs
import {
  normalizeRelativePath,
  looksWindowsAbsolute,
  assertNoReservedPathSegments,
  assertSafeOutputPath,
  assertPathWithinCategoryRoot,
  assertTopLevelMarkdownFile,
  listDeclaredFiles,
  listSourceSkillNames,
  listSourceAgentPaths,
  assertSourceParity,
} from "../scripts/lib/bundle-helpers.mjs";

const root = resolve(import.meta.dirname, "..");

function writeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

function runBundleBuild(env: NodeJS.ProcessEnv) {
  return spawnSync("node", [resolve(root, "scripts/build-opencode-superpowers-bundle.mjs")], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

describe("path validation helpers", () => {
  it("rejects directory traversal with .. segments", () => {
    expect(() => assertNoReservedPathSegments("../escape")).toThrow("Invalid declared runtime path");
    expect(() => assertNoReservedPathSegments("foo/../bar")).toThrow(
      "Invalid declared runtime path",
    );
    expect(() => assertNoReservedPathSegments("..")).toThrow("Invalid declared runtime path");
  });

  it("rejects backslash-based directory traversal", () => {
    // normalizeRelativePath converts \\ to /, so ..\\foo becomes ../foo
    expect(() => assertNoReservedPathSegments("..\\escape")).toThrow(
      "Invalid declared runtime path",
    );
  });

  it("rejects absolute paths", () => {
    expect(() => assertNoReservedPathSegments("/etc/passwd")).toThrow(
      "Invalid declared runtime path",
    );
  });

  it("rejects Windows absolute paths", () => {
    expect(looksWindowsAbsolute("C:\\Windows")).toBe(true);
    expect(looksWindowsAbsolute("\\\\server\\share")).toBe(true);
    expect(looksWindowsAbsolute("relative/path")).toBe(false);
    expect(() => assertSafeOutputPath("C:\\Windows\\foo")).toThrow("Invalid declared runtime path");
  });

  it("accepts valid relative paths", () => {
    expect(assertNoReservedPathSegments("foo/bar.md")).toBe("foo/bar.md");
    expect(assertNoReservedPathSegments("SKILL.md")).toBe("SKILL.md");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeRelativePath("foo\\bar\\baz.md")).toBe("foo/bar/baz.md");
  });
});

describe("skill discovery", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-skill-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("returns skill IDs for directories containing SKILL.md", () => {
    writeFile(tempRoot, "alpha/SKILL.md", "skill alpha");
    writeFile(tempRoot, "beta/SKILL.md", "skill beta");
    // directory without SKILL.md should be ignored
    mkdirSync(resolve(tempRoot, "gamma"));
    // file (not directory) should be ignored
    writeFileSync(resolve(tempRoot, "not-a-dir.md"), "nope");

    const skills = listSourceSkillNames(tempRoot);
    expect(skills.sort()).toEqual(["alpha", "beta"]);
  });

  it("returns empty array for non-existent directory", () => {
    expect(listSourceSkillNames(resolve(tempRoot, "nonexistent"))).toEqual([]);
  });
});

describe("agent discovery", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-agent-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("finds top-level .md files in agents/ directory", () => {
    writeFile(tempRoot, "agents/helper.md", "agent");
    writeFile(tempRoot, "agents/reviewer.md", "agent");
    // nested .md should be ignored
    writeFile(tempRoot, "agents/sub/nested.md", "nested");
    // non-.md should be ignored
    writeFile(tempRoot, "agents/readme.txt", "text");

    const agents = listSourceAgentPaths(tempRoot);
    expect(agents.sort()).toEqual(["agents/helper.md", "agents/reviewer.md"]);
  });

  it("returns empty array when agents/ directory does not exist", () => {
    expect(listSourceAgentPaths(tempRoot)).toEqual([]);
  });
});

describe("file-existence validation", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-exist-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("build fails with clear error when manifest references missing file", () => {
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const manifestPath = resolve(tempRoot, "manifest.json");

    const manifest = {
      sourceRoot,
      skills: { planner: ["SKILL.md", "missing.md"] },
      agents: [],
      plugin: [],
    };

    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFile(sourceRoot, "planner/SKILL.md", "skill");

    const result = runBundleBuild({
      SPOC_SUPERPOWERS_SOURCE_ROOT: sourceRoot,
      SPOC_SUPERPOWERS_OUTPUT_ROOT: outputRoot,
      SPOC_SUPERPOWERS_RUNTIME_MANIFEST: manifestPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing declared runtime file");
    expect(result.stderr).toContain("skills/planner/missing.md");
  });
});

describe("manifest parity (assertSourceParity)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-parity-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("throws when source skill is not declared in manifest", () => {
    writeFile(tempRoot, "alpha/SKILL.md", "alpha");
    writeFile(tempRoot, "beta/SKILL.md", "beta");

    const manifest = { skills: { alpha: ["SKILL.md"] }, agents: [], plugin: [] };

    expect(() => assertSourceParity(manifest, tempRoot, new Set())).toThrow(
      "Missing runtime manifest skill entry: beta",
    );
  });

  it("throws when source agent is not declared in manifest", () => {
    writeFile(tempRoot, "agents/helper.md", "helper");
    writeFile(tempRoot, "agents/reviewer.md", "reviewer");

    const manifest = { skills: {}, agents: ["agents/helper.md"], plugin: [] };

    expect(() => assertSourceParity(manifest, tempRoot, new Set())).toThrow(
      "Missing runtime manifest agent entry: agents/reviewer.md",
    );
  });

  it("passes when all source skills and agents are declared", () => {
    writeFile(tempRoot, "alpha/SKILL.md", "alpha");
    writeFile(tempRoot, "agents/helper.md", "helper");

    const manifest = { skills: { alpha: ["SKILL.md"] }, agents: ["agents/helper.md"], plugin: [] };

    expect(() => assertSourceParity(manifest, tempRoot, new Set())).not.toThrow();
  });

  it("skips SPOC-native skills", () => {
    writeFile(tempRoot, "alpha/SKILL.md", "alpha");
    writeFile(tempRoot, "loop/SKILL.md", "loop");

    const manifest = { skills: { alpha: ["SKILL.md"] }, agents: [], plugin: [] };
    const nativeSkills = new Set(["loop"]);

    expect(() => assertSourceParity(manifest, tempRoot, nativeSkills)).not.toThrow();
  });
});

describe("end-to-end manifest smoke test", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-e2e-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("builds a small fixture and produces expected output", () => {
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const manifestPath = resolve(tempRoot, "bundle-runtime.json");

    const manifest = {
      sourceRoot,
      skills: {
        planner: ["SKILL.md", "notes.md"],
        reviewer: ["SKILL.md"],
      },
      agents: ["agents/helper.md"],
      plugin: [".opencode/plugins/superpowers.js"],
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    writeFile(sourceRoot, "planner/SKILL.md", "planner-skill");
    writeFile(sourceRoot, "planner/notes.md", "planner-notes");
    writeFile(sourceRoot, "reviewer/SKILL.md", "reviewer-skill");
    writeFile(sourceRoot, "agents/helper.md", "agent-helper");
    writeFile(sourceRoot, ".opencode/plugins/superpowers.js", "plugin-code");

    const result = runBundleBuild({
      SPOC_SUPERPOWERS_SOURCE_ROOT: sourceRoot,
      SPOC_SUPERPOWERS_OUTPUT_ROOT: outputRoot,
      SPOC_SUPERPOWERS_RUNTIME_MANIFEST: manifestPath,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    // Verify all expected files exist with correct content
    expect(readFileSync(resolve(outputRoot, "skills/planner/SKILL.md"), "utf-8")).toBe(
      "planner-skill",
    );
    expect(readFileSync(resolve(outputRoot, "skills/planner/notes.md"), "utf-8")).toBe(
      "planner-notes",
    );
    expect(readFileSync(resolve(outputRoot, "skills/reviewer/SKILL.md"), "utf-8")).toBe(
      "reviewer-skill",
    );
    expect(readFileSync(resolve(outputRoot, "agents/helper.md"), "utf-8")).toBe("agent-helper");
    expect(readFileSync(resolve(outputRoot, ".opencode/plugins/superpowers.js"), "utf-8")).toBe(
      "plugin-code",
    );
  });
});
