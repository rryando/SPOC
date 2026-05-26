import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { handleDagCommand } from "../src/cli/dag-commands.js";

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-cli-ext-test-"));
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
          planId: "my-plan",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(join(projDir, "tasks.md"), "# Tasks — Test Project\n\n## Backlog\n\n- [ ] **[high]** Fix the bug\n");
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
  writeFileSync(
    join(plansDir, "index.json"),
    JSON.stringify({
      plans: [
        {
          id: "my-plan",
          normalizedId: "my-plan",
          title: "My Plan",
          status: "in_progress",
          keywords: ["refactor"],
          summary: "A refactoring plan",
          file: "plans/my-plan.md",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    join(plansDir, "my-plan.meta.json"),
    JSON.stringify({
      id: "my-plan",
      normalizedId: "my-plan",
      title: "My Plan",
      status: "in_progress",
      keywords: ["refactor"],
      summary: "A refactoring plan",
      file: "plans/my-plan.md",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(join(plansDir, "my-plan.md"), "# My Plan\n\nDo the refactor.\n");

  return dir;
}

let dataDir: string;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  dataDir = createTempDataDir();
  process.env.SPOC_DATA_DIR = dataDir;
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
  delete process.env.SPOC_DATA_DIR;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// plan command
// ---------------------------------------------------------------------------

describe("spoc plan list", () => {
  it("lists plans for project", async () => {
    await handleDagCommand("plan", ["list", "--slug=test-proj", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("my-plan");
  });

  it("filters by status", async () => {
    await handleDagCommand("plan", ["list", "--slug=test-proj", "--status=done", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed).toHaveLength(0);
  });

  it("errors on missing slug", async () => {
    await handleDagCommand("plan", ["list", "--json"]);
    expect(stderr[0]).toContain("--slug is required");
  });
});

describe("spoc plan get", () => {
  it("gets plan meta", async () => {
    await handleDagCommand("plan", ["get", "test-proj", "my-plan", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.title).toBe("My Plan");
    expect(parsed.body).toBeUndefined();
  });

  it("gets plan with body", async () => {
    await handleDagCommand("plan", ["get", "test-proj", "my-plan", "--body", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.body).toContain("Do the refactor");
  });

  it("errors on missing plan", async () => {
    await handleDagCommand("plan", ["get", "test-proj", "nope", "--json"]);
    expect(stderr[0]).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// knowledge command
// ---------------------------------------------------------------------------

describe("spoc knowledge search", () => {
  it("searches knowledge entries", async () => {
    await handleDagCommand("knowledge", ["search", "test-proj", "api", "rest", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].id).toBe("api-pattern");
  });

  it("errors on missing query", async () => {
    await handleDagCommand("knowledge", ["search", "test-proj", "--json"]);
    expect(stderr[0]).toContain("query is required");
  });
});

describe("spoc knowledge create", () => {
  it("creates a knowledge entry", async () => {
    await handleDagCommand("knowledge", [
      "create",
      "--slug=test-proj",
      "--title=New Lesson",
      "--kind=lesson",
      "--keywords=testing,ci",
      "--json",
    ]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.id).toBe("new-lesson");
    expect(parsed.kind).toBe("lesson");
    expect(parsed.keywords).toContain("testing");
  });

  it("errors on invalid kind", async () => {
    await handleDagCommand("knowledge", [
      "create",
      "--slug=test-proj",
      "--title=Bad",
      "--kind=invalid",
      "--json",
    ]);
    expect(stderr[0]).toContain("invalid kind");
  });
});

// ---------------------------------------------------------------------------
// batch command
// ---------------------------------------------------------------------------

describe("spoc batch", () => {
  it("executes batch operations", async () => {
    const batchFile = join(dataDir, "batch.json");
    writeFileSync(
      batchFile,
      JSON.stringify([
        { op: "task-transition", slug: "test-proj", taskId: "fix-bug", status: "in_progress" },
        { op: "knowledge-create", slug: "test-proj", title: "Batch Entry", kind: "gotcha", body: "Watch out!" },
      ]),
    );

    await handleDagCommand("batch", ["--file=" + batchFile, "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].success).toBe(true);
    expect(parsed[1].success).toBe(true);
  });

  it("reports errors for invalid ops", async () => {
    const batchFile = join(dataDir, "batch-bad.json");
    writeFileSync(batchFile, JSON.stringify([{ op: "unknown-op", slug: "test-proj" }]));

    await handleDagCommand("batch", ["--file=" + batchFile, "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed[0].success).toBe(false);
    expect(parsed[0].error).toContain("Unknown op");
  });

  it("errors on missing file", async () => {
    await handleDagCommand("batch", ["--file=/nonexistent.json", "--json"]);
    expect(stderr[0]).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// validate command
// ---------------------------------------------------------------------------

describe("spoc validate", () => {
  it("runs validation and returns report", async () => {
    await handleDagCommand("validate", ["--slug=test-proj", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.summary).toBeDefined();
    expect(parsed.summary.totalChecks).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(parsed.issues)).toBe(true);
  });

  it("errors on missing slug", async () => {
    await handleDagCommand("validate", ["--json"]);
    expect(stderr[0]).toContain("--slug is required");
  });

  it("errors on nonexistent project", async () => {
    await handleDagCommand("validate", ["--slug=nope", "--json"]);
    expect(stderr[0]).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// diagram command (unit test — script may not exist)
// ---------------------------------------------------------------------------

describe("spoc diagram", () => {
  it("errors on unknown subcommand", async () => {
    await handleDagCommand("diagram", ["foo", "--json"]);
    expect(stderr[0]).toContain("unknown diagram subcommand");
  });

  it("errors on missing path", async () => {
    await handleDagCommand("diagram", ["inspect", "--json"]);
    expect(stderr[0]).toContain("usage");
  });

  it("errors on nonexistent file", async () => {
    await handleDagCommand("diagram", ["inspect", "/nonexistent.mmd", "--json"]);
    expect(stderr[0]).toContain("not found");
  });
});
