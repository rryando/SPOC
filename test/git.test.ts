import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFilesChanged, getGitLog, getHeadCommit, isGitRepo } from "../src/utils/git.js";

const REPO_ROOT = join(import.meta.dirname, "..");
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "spoc-git-test-"));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("isGitRepo", () => {
  it("returns true for the SPOC repo", () => {
    expect(isGitRepo(REPO_ROOT)).toBe(true);
  });

  it("returns false for a non-git directory", () => {
    expect(isGitRepo(tempDir)).toBe(false);
  });
});

describe("getHeadCommit", () => {
  it("returns a short SHA for the SPOC repo", () => {
    const sha = getHeadCommit(REPO_ROOT);
    expect(sha).toMatch(/^[a-f0-9]{7,}$/);
  });

  it("returns null for a non-git directory", () => {
    expect(getHeadCommit(tempDir)).toBeNull();
  });
});

describe("getGitLog", () => {
  it("returns non-empty array for the SPOC repo", () => {
    const entries = getGitLog(REPO_ROOT);
    expect(entries.length).toBeGreaterThan(0);
    const entry = entries[0];
    expect(entry).toHaveProperty("sha");
    expect(entry).toHaveProperty("message");
    expect(entry).toHaveProperty("date");
    expect(entry).toHaveProperty("filesChanged");
    expect(entry.sha).toMatch(/^[a-f0-9]{7,}$/);
    expect(typeof entry.message).toBe("string");
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(entry.filesChanged)).toBe(true);
  });

  it("respects limit option", () => {
    const entries = getGitLog(REPO_ROOT, { limit: 3 });
    expect(entries.length).toBeLessThanOrEqual(3);
  });

  it("filters by since date", () => {
    const all = getGitLog(REPO_ROOT, { limit: 50 });
    // Use a date that should exclude some commits
    const recentDate = all.length > 5 ? all[4].date : all[0].date;
    const filtered = getGitLog(REPO_ROOT, { since: recentDate });
    expect(filtered.length).toBeLessThanOrEqual(all.length);
  });

  it("returns empty array for a non-git directory", () => {
    expect(getGitLog(tempDir)).toEqual([]);
  });
});

describe("getFilesChanged", () => {
  it("returns array of file paths for HEAD~1", () => {
    const files = getFilesChanged(REPO_ROOT, "HEAD~1");
    expect(Array.isArray(files)).toBe(true);
    // Should have at least one file changed in the last commit
    expect(files.length).toBeGreaterThan(0);
    // Paths should be relative (no leading /)
    for (const f of files) {
      expect(f).not.toMatch(/^\//);
    }
  });

  it("returns empty array for a non-git directory", () => {
    expect(getFilesChanged(tempDir, "HEAD~1")).toEqual([]);
  });
});
