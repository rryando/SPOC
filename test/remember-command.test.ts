import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDagCommand } from "../src/cli/dag-commands.js";

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-remember-test-"));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      version: "1.0",
      projects: [{ id: "test-proj", name: "Test Project", status: "active", dependsOn: [] }],
    }),
  );
  const projDir = join(dir, "projects", "test-proj");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, "meta.json"),
    JSON.stringify({
      id: "test-proj",
      name: "Test Project",
      description: "A test project",
      createdAt: "2025-01-01T00:00:00.000Z",
      workspacePaths: ["/tmp/test-workspace"],
    }),
  );
  const knowledgeDir = join(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, "index.json"), JSON.stringify({ entries: [] }));
  return dir;
}

let dataDir: string;
const stdout: string[] = [];
const stderr: string[] = [];

beforeEach(() => {
  dataDir = createTempDataDir();
  process.env.SPOC_DATA_DIR = dataDir;
  stdout.length = 0;
  stderr.length = 0;
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  delete process.env.SPOC_DATA_DIR;
  vi.restoreAllMocks();
});

describe("spoc remember", () => {
  it("creates a gotcha entry for 'never' keywords", async () => {
    await handleDagCommand("remember", ["test-proj", "Never use MCP again", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.kind).toBe("gotcha");
    expect(parsed.summary).toBe("Never use MCP again");
  });

  it("creates a gotcha for 'don't' keyword", async () => {
    await handleDagCommand("remember", ["test-proj", "don't mutate state directly", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.kind).toBe("gotcha");
  });

  it("creates a decision entry for 'decided' keyword", async () => {
    await handleDagCommand("remember", ["test-proj", "We decided to go CLI-only", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.kind).toBe("decision");
  });

  it("defaults to lesson for unrecognized text", async () => {
    await handleDagCommand("remember", ["test-proj", "Some random insight", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.kind).toBe("lesson");
  });

  it("creates a pattern entry for 'pattern' keyword", async () => {
    await handleDagCommand("remember", ["test-proj", "Use this pattern for all commands", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.kind).toBe("pattern");
  });

  it("auto-generates title from short text", async () => {
    await handleDagCommand("remember", ["test-proj", "Short insight", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.title).toBe("Short insight");
  });

  it("truncates long text to title with ellipsis", async () => {
    const longText = "This is a very long insight that definitely exceeds the fifty character limit for titles";
    await handleDagCommand("remember", ["test-proj", longText, "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.title).toMatch(/\.\.\.$/);
    expect(parsed.title.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(parsed.summary).toBe(longText);
  });

  it("returns id in response", async () => {
    await handleDagCommand("remember", ["test-proj", "A simple lesson", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.id).toBeTruthy();
  });

  it("errors on nonexistent project", async () => {
    await handleDagCommand("remember", ["nonexistent", "some insight", "--json"]);
    const parsed = JSON.parse(stderr[0]);
    expect(parsed.ok).toBe(false);
    expect(parsed.message).toContain("nonexistent");
  });
});
