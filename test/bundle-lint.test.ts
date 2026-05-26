import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const linterScript = resolve(root, "scripts/lint-bundle.mjs");

type LintIssue = {
  severity: "error" | "warning";
  kind: string;
  message: string;
  file?: string;
  repair?: string;
};

type LintResult = {
  issues: LintIssue[];
  summary: { errors: number; warnings: number };
};

function writeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

describe("bundle linter", () => {
  it("reports missing manifest-declared files", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-missing-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { planner: ["SKILL.md", "notes.md"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      // Only write SKILL.md, not notes.md
      writeFile(bundleRoot, "skills/planner/SKILL.md", "skill");

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          kind: "missing-declared-file",
          file: "skills/planner/notes.md",
        }),
      );
      expect(result.summary.errors).toBeGreaterThan(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports extra undeclared files in bundle", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-extra-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { planner: ["SKILL.md"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      writeFile(bundleRoot, "skills/planner/SKILL.md", "skill");
      writeFile(bundleRoot, "skills/planner/stale.md", "stale");

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "warning",
          kind: "undeclared-file",
          file: "skills/planner/stale.md",
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports skills missing SKILL.md in their file list", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-noskill-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { planner: ["notes.md"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      writeFile(bundleRoot, "skills/planner/notes.md", "notes");

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          kind: "skill-missing-entry",
          message: expect.stringContaining("SKILL.md"),
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports missing .mjs bundled scripts", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-mjs-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { "to-diagram": ["SKILL.md", "scripts/manage-diagram.mjs"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      writeFile(bundleRoot, "skills/to-diagram/SKILL.md", "skill");
      // Don't write the .mjs file — should be caught as missing-declared-file

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          kind: "missing-declared-file",
          file: "skills/to-diagram/scripts/manage-diagram.mjs",
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("reports spoc-dashboard missing package.json type field", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-pkg-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { "spoc-dashboard": ["SKILL.md", "package.json"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      writeFile(bundleRoot, "skills/spoc-dashboard/SKILL.md", "skill");
      // package.json without type field
      writeFile(bundleRoot, "skills/spoc-dashboard/package.json", JSON.stringify({}));

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          severity: "error",
          kind: "package-json-invalid",
          message: expect.stringContaining("type"),
        }),
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  // config-drift detection removed: the repo bundle is the source of truth,
  // and there is no "config root" mirror to compare against. Use
  // `spoc deploy-superpowers --dry-run` to preview deployment-target diffs.

  it("exits 0 with no issues on clean bundle", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "bundle-lint-clean-"));
    const bundleRoot = resolve(tempRoot, "bundle");

    try {
      const manifest = {
        sourceRoot: "~/.config/opencode/skills/spoc",
        skills: { planner: ["SKILL.md"] },
        agents: [],
        plugin: [],
      };
      writeFile(bundleRoot, "bundle-runtime.json", JSON.stringify(manifest, null, 2));
      writeFile(bundleRoot, "manifest.json", JSON.stringify({ bundleId: "test" }));
      writeFile(bundleRoot, ".opencode/plugins/spoc.js", "plugin");
      writeFile(bundleRoot, "skills/planner/SKILL.md", "skill");

      const proc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      const result = JSON.parse(proc.stdout) as LintResult;
      expect(result.issues).toEqual([]);
      expect(result.summary.errors).toBe(0);
      expect(proc.status).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("runs against the real repo bundle without errors", () => {
    const proc = spawnSync("node", [linterScript], {
      cwd: root,
      env: { ...process.env },
      encoding: "utf-8",
    });

    const result = JSON.parse(proc.stdout) as LintResult;
    expect(result.summary.errors).toBe(0);
    // Warnings may exist (config drift) depending on env, that's OK
    expect(proc.status).toBe(0);
  });
});
