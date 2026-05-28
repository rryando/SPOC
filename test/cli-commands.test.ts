import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We test handleDagCommand directly
import { handleDagCommand } from "../src/cli/dag-commands.js";

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "arcs-cli-test-"));
  // Seed root meta
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      version: "1.0",
      projects: [{ id: "test-proj", name: "Test Project", status: "active", dependsOn: [] }],
    }),
  );
  // Create project dir with meta
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
  // overview
  writeFileSync(
    join(projDir, "overview.md"),
    "# Test Project\n\n> A test project\n\n## Goals\n\nBuild things.\n",
  );
  // tasks
  const tasksDir = join(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, "index.json"),
    JSON.stringify({
      tasks: [
        {
          id: "fix-bug",
          normalizedId: "fix-bug",
          title: "Fix the bug",
          status: "backlog",
          priority: "high",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
        {
          id: "add-feature",
          normalizedId: "add-feature",
          title: "Add feature",
          status: "in_progress",
          priority: "medium",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  // tasks.md
  writeFileSync(
    join(projDir, "tasks.md"),
    "# Tasks — Test Project\n\n## In Progress\n\n- [/] **[medium]** Add feature\n\n## Backlog\n\n- [ ] **[high]** Fix the bug\n",
  );
  // knowledge
  const knowledgeDir = join(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(
    join(knowledgeDir, "index.json"),
    JSON.stringify({
      entries: [
        {
          id: "api-pattern",
          normalizedId: "api-pattern",
          title: "API Pattern",
          kind: "pattern",
          keywords: ["api", "rest"],
          summary: "REST API patterns used in the project",
          file: "knowledge/api-pattern.md",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(join(knowledgeDir, "api-pattern.md"), "# API Pattern\n\nUse REST.\n");
  writeFileSync(
    join(knowledgeDir, "api-pattern.meta.json"),
    JSON.stringify({
      id: "api-pattern",
      normalizedId: "api-pattern",
      title: "API Pattern",
      kind: "pattern",
      keywords: ["api", "rest"],
      summary: "REST API patterns used in the project",
      file: "knowledge/api-pattern.md",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  );
  // plans
  const plansDir = join(projDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, "index.json"), JSON.stringify({ plans: [] }));

  return dir;
}

let dataDir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dataDir = createTempDataDir();
  process.env.ARCS_DATA_DIR = dataDir;
  stdout = [];
  stderr = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    stdout.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    stderr.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  delete process.env.ARCS_DATA_DIR;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// context command
// ---------------------------------------------------------------------------

describe("arcs context", () => {
  it("resolves project context from workspace path", async () => {
    const result = await handleDagCommand("context", ["/tmp/test-workspace"]);
    expect(result).toBe(true);
    expect(stdout.join("\n")).toContain("Test Project");
  });

  it("uses cwd when no path given", async () => {
    // cwd won't match any project
    const result = await handleDagCommand("context", []);
    expect(result).toBe(true);
    // Should error since cwd doesn't match
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("outputs JSON with --json flag", async () => {
    const result = await handleDagCommand("context", ["--json", "/tmp/test-workspace"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    // JSON mode outputs the context as a JSON object
    const parsed = JSON.parse(output);
    expect(parsed.slug).toBe("test-proj");
  });

  it("prints error for non-matching path", async () => {
    const result = await handleDagCommand("context", ["/nonexistent/path"]);
    expect(result).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// task list
// ---------------------------------------------------------------------------

describe("arcs task list", () => {
  it("lists all tasks for a project", async () => {
    const result = await handleDagCommand("task", ["list", "--slug=test-proj"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("fix-bug");
    expect(output).toContain("add-feature");
  });

  it("filters by status", async () => {
    const result = await handleDagCommand("task", ["list", "--slug=test-proj", "--status=backlog"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("fix-bug");
    expect(output).not.toContain("add-feature");
  });

  it("filters by priority", async () => {
    const result = await handleDagCommand("task", ["list", "--slug=test-proj", "--priority=high"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("fix-bug");
    expect(output).not.toContain("add-feature");
  });

  it("errors without --slug", async () => {
    const result = await handleDagCommand("task", ["list"]);
    expect(result).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);
  });

  it("outputs JSON with --json", async () => {
    const result = await handleDagCommand("task", ["--json", "list", "--slug=test-proj"]);
    expect(result).toBe(true);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// task get
// ---------------------------------------------------------------------------

describe("arcs task get", () => {
  it("gets a single task", async () => {
    const result = await handleDagCommand("task", ["get", "test-proj", "fix-bug"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("fix-bug");
    expect(output).toContain("high");
  });

  it("outputs JSON with --json", async () => {
    const result = await handleDagCommand("task", ["--json", "get", "test-proj", "fix-bug"]);
    expect(result).toBe(true);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.id).toBe("fix-bug");
    expect(parsed.priority).toBe("high");
  });

  it("errors for non-existent task", async () => {
    const result = await handleDagCommand("task", ["get", "test-proj", "nonexistent"]);
    expect(result).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// task transition
// ---------------------------------------------------------------------------

describe("arcs task transition", () => {
  it("transitions a task status", async () => {
    const result = await handleDagCommand("task", [
      "transition",
      "test-proj",
      "fix-bug",
      "in_progress",
    ]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("in_progress");
  });

  it("outputs JSON with --json", async () => {
    const result = await handleDagCommand("task", [
      "--json",
      "transition",
      "test-proj",
      "fix-bug",
      "done",
    ]);
    expect(result).toBe(true);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.previousStatus).toBe("backlog");
    expect(parsed.newStatus).toBe("done");
  });

  it("errors for invalid status", async () => {
    const result = await handleDagCommand("task", [
      "transition",
      "test-proj",
      "fix-bug",
      "invalid",
    ]);
    expect(result).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("arcs search", () => {
  it("searches knowledge by query", async () => {
    const result = await handleDagCommand("search", ["test-proj", "api"]);
    expect(result).toBe(true);
    const output = stdout.join("\n");
    expect(output).toContain("api-pattern");
  });

  it("outputs JSON with --json", async () => {
    const result = await handleDagCommand("search", ["--json", "test-proj", "api"]);
    expect(result).toBe(true);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("api-pattern");
  });

  it("respects --limit", async () => {
    const result = await handleDagCommand("search", ["--json", "test-proj", "api", "--limit=1"]);
    expect(result).toBe(true);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.length).toBeLessThanOrEqual(1);
  });

  it("errors without slug", async () => {
    const result = await handleDagCommand("search", []);
    expect(result).toBe(true);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
