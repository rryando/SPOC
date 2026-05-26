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

import {
  normalizeRelativePath,
  looksWindowsAbsolute,
  assertNoReservedPathSegments,
  assertSafeOutputPath,
} from "../scripts/lib/bundle-helpers.mjs";

const root = resolve(import.meta.dirname, "..");

function writeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

function runBundleBuild(env: NodeJS.ProcessEnv) {
  return spawnSync("node", [resolve(root, "scripts/build-opencode-bundle.mjs")], {
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

describe("file-existence validation (output root is source of truth)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-exist-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("build fails with clear error when manifest references file missing from output root", () => {
    const outputRoot = resolve(tempRoot, "output");
    const manifestPath = resolve(tempRoot, "manifest.json");

    const manifest = {
      skills: { planner: ["SKILL.md", "missing.md"] },
      agents: [],
      plugin: [],
    };

    writeFileSync(manifestPath, JSON.stringify(manifest));
    // Only SKILL.md exists; missing.md is declared but absent.
    writeFile(outputRoot, "skills/planner/SKILL.md", "skill");

    const result = runBundleBuild({
      SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
      SPOC_BUNDLE_RUNTIME_MANIFEST: manifestPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Missing declared bundle file");
    expect(result.stderr).toContain("skills/planner/missing.md");
  });
});

describe("end-to-end smoke test (no source mirroring)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-helpers-e2e-"));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("validates declared files in the output root and prunes undeclared content", () => {
    const outputRoot = resolve(tempRoot, "output");
    const manifestPath = resolve(tempRoot, "bundle-runtime.json");

    const manifest = {
      skills: {
        planner: ["SKILL.md", "notes.md"],
        reviewer: ["SKILL.md"],
      },
      agents: ["agents/helper.md"],
      plugin: [".opencode/plugins/spoc.js"],
    };

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    // Output root IS the source of truth — author files directly here.
    writeFile(outputRoot, "skills/planner/SKILL.md", "planner-skill");
    writeFile(outputRoot, "skills/planner/notes.md", "planner-notes");
    writeFile(outputRoot, "skills/reviewer/SKILL.md", "reviewer-skill");
    writeFile(outputRoot, "agents/helper.md", "agent-helper");
    writeFile(outputRoot, ".opencode/plugins/spoc.js", "plugin-code");
    // Undeclared file that should be pruned by the build.
    writeFile(outputRoot, "skills/planner/stale.md", "stale content");

    const result = runBundleBuild({
      SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
      SPOC_BUNDLE_RUNTIME_MANIFEST: manifestPath,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    // Declared files survive with their original content.
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
    expect(readFileSync(resolve(outputRoot, ".opencode/plugins/spoc.js"), "utf-8")).toBe(
      "plugin-code",
    );

    // Undeclared file pruned.
    expect(existsSync(resolve(outputRoot, "skills/planner/stale.md"))).toBe(false);
  });
});
