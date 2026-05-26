import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDagCommand } from "../src/cli/dag-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-cli-workflow-"));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      version: "1.0",
      projects: [
        { id: "workflow-proj", name: "Workflow Project", status: "active", dependsOn: [] },
      ],
    }),
  );
  const projDir = join(dir, "projects", "workflow-proj");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, "meta.json"),
    JSON.stringify({
      id: "workflow-proj",
      name: "Workflow Project",
      description: "Integration test project",
      createdAt: "2025-01-01T00:00:00.000Z",
      workspacePaths: ["/tmp/workflow-workspace"],
    }),
  );
  writeFileSync(
    join(projDir, "overview.md"),
    "# Workflow Project\n\n> Integration test\n\n## Goals\n\nTest CLI workflow.\n",
  );
  // tasks
  const tasksDir = join(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, "index.json"),
    JSON.stringify({
      tasks: [
        {
          id: "task-alpha",
          normalizedId: "task-alpha",
          title: "Alpha task",
          status: "backlog",
          priority: "high",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    join(projDir, "tasks.md"),
    "# Tasks — Workflow Project\n\n## Backlog\n\n- [ ] **[high]** Alpha task\n",
  );
  // knowledge
  const knowledgeDir = join(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(
    join(knowledgeDir, "index.json"),
    JSON.stringify({
      entries: [
        {
          id: "deploy-pattern",
          normalizedId: "deploy-pattern",
          title: "Deploy Pattern",
          kind: "pattern",
          keywords: ["deploy", "ci", "pipeline"],
          summary: "CI/CD deployment patterns",
          file: "knowledge/deploy-pattern.md",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    join(knowledgeDir, "deploy-pattern.md"),
    "# Deploy Pattern\n\nUse blue-green deployments.\n",
  );
  writeFileSync(
    join(knowledgeDir, "deploy-pattern.meta.json"),
    JSON.stringify({
      id: "deploy-pattern",
      normalizedId: "deploy-pattern",
      title: "Deploy Pattern",
      kind: "pattern",
      keywords: ["deploy", "ci", "pipeline"],
      summary: "CI/CD deployment patterns",
      file: "knowledge/deploy-pattern.md",
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
          id: "migration-plan",
          normalizedId: "migration-plan",
          title: "Migration Plan",
          status: "planned",
          keywords: ["migration", "database"],
          summary: "Database migration strategy",
          file: "plans/migration-plan.md",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
        },
      ],
    }),
  );
  writeFileSync(
    join(plansDir, "migration-plan.meta.json"),
    JSON.stringify({
      id: "migration-plan",
      normalizedId: "migration-plan",
      title: "Migration Plan",
      status: "planned",
      keywords: ["migration", "database"],
      summary: "Database migration strategy",
      file: "plans/migration-plan.md",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
  );
  writeFileSync(
    join(plansDir, "migration-plan.md"),
    "# Migration Plan\n\nMigrate to PostgreSQL.\n",
  );

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

// ===========================================================================
// 1. CLI Reads — structured JSON output
// ===========================================================================

describe("CLI reads return structured JSON", () => {
  it("knowledge list returns JSON array", async () => {
    await handleDagCommand("knowledge", ["list", "--slug=workflow-proj", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("deploy-pattern");
  });

  it("context resolves project from workspace path", async () => {
    await handleDagCommand("context", ["--json", "/tmp/workflow-workspace"]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.slug).toBe("workflow-proj");
  });

  it("task list returns JSON array", async () => {
    await handleDagCommand("task", ["--json", "list", "--slug=workflow-proj"]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("task-alpha");
    expect(parsed[0].status).toBe("backlog");
  });

  it("plan list returns JSON array", async () => {
    await handleDagCommand("plan", ["list", "--slug=workflow-proj", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe("migration-plan");
  });

  it("knowledge search returns results", async () => {
    await handleDagCommand("search", ["--json", "workflow-proj", "deploy"]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0].id).toBe("deploy-pattern");
  });

  it("task get returns single task", async () => {
    await handleDagCommand("task", ["--json", "get", "workflow-proj", "task-alpha"]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.id).toBe("task-alpha");
    expect(parsed.priority).toBe("high");
  });

  it("plan get returns plan with body", async () => {
    await handleDagCommand("plan", ["get", "workflow-proj", "migration-plan", "--body", "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.title).toBe("Migration Plan");
    expect(parsed.body).toContain("PostgreSQL");
  });
});

// ===========================================================================
// 2. Batch operations
// ===========================================================================

describe("batch operations", () => {
  it("batch succeeds", async () => {
    const batchFile = join(dataDir, "batch-workflow.json");
    writeFileSync(
      batchFile,
      JSON.stringify([
        {
          op: "task-transition",
          slug: "workflow-proj",
          taskId: "task-alpha",
          status: "in_progress",
        },
        {
          op: "knowledge-create",
          slug: "workflow-proj",
          title: "Batch Lesson",
          kind: "gotcha",
          body: "Be careful!",
        },
      ]),
    );

    await handleDagCommand("batch", [`--file=${batchFile}`, "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].success).toBe(true);
    expect(parsed[1].success).toBe(true);
  });
});
