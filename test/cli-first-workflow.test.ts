import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

import { handleDagCommand } from "../src/cli/dag-commands.js";
import {
  clearWriteProposals,
  createWriteProposal,
  disableWriteGateBypass,
  enableWriteGateBypass,
} from "../src/utils/write-gate.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-cli-workflow-"));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      version: "1.0",
      projects: [{ id: "workflow-proj", name: "Workflow Project", status: "active", dependsOn: [] }],
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
  writeFileSync(join(projDir, "overview.md"), "# Workflow Project\n\n> Integration test\n\n## Goals\n\nTest CLI workflow.\n");
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
  writeFileSync(join(projDir, "tasks.md"), "# Tasks — Workflow Project\n\n## Backlog\n\n- [ ] **[high]** Alpha task\n");
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
  writeFileSync(join(knowledgeDir, "deploy-pattern.md"), "# Deploy Pattern\n\nUse blue-green deployments.\n");
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
  writeFileSync(join(plansDir, "migration-plan.md"), "# Migration Plan\n\nMigrate to PostgreSQL.\n");

  return dir;
}

function getToken(slug: string, operation: string): string {
  const proposal = createWriteProposal({
    slug,
    summary: "test write",
    operations: [operation],
    ttlMs: 60_000,
  });
  return proposal.token;
}

function getBatchToken(slug: string): string {
  const proposal = createWriteProposal({
    slug,
    summary: "batch write",
    operations: ["batch"],
    ttlMs: 60_000,
  });
  return proposal.token;
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
  clearWriteProposals();
  enableWriteGateBypass();
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. CLI Reads — structured JSON output
// ===========================================================================

describe("CLI reads return structured JSON", () => {
  beforeEach(() => {
    enableWriteGateBypass();
  });

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
// 2. Cross-process write-gate flow: propose → apply → write succeeds
// ===========================================================================

describe("cross-process write-gate flow", () => {
  beforeEach(() => {
    disableWriteGateBypass();
  });

  it("propose in one context, use token for CLI write in another", async () => {
    // Simulate: Agent A proposes a write
    const token = getToken("workflow-proj", "tool:transition_project_task");

    // Simulate: Agent B (CLI) consumes the token to perform the write
    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress", `--token=${token}`]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.previousStatus).toBe("backlog");
    expect(parsed.newStatus).toBe("in_progress");
  });

  it("token is single-use — second use fails", async () => {
    const token = getToken("workflow-proj", "tool:transition_project_task");

    // First use succeeds
    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress", `--token=${token}`]);
    expect(stdout.length).toBeGreaterThan(0);

    // Reset output
    stdout = [];
    stderr = [];

    // Second use fails
    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "done", `--token=${token}`]);
    expect(stderr.join("\n")).toMatch(/consumed/i);
  });

  it("expired token fails", async () => {
    const proposal = createWriteProposal({
      slug: "workflow-proj",
      summary: "test",
      operations: ["tool:transition_project_task"],
      ttlMs: 1, // 1ms TTL
    });

    // Wait for expiry
    await new Promise((r) => setTimeout(r, 10));

    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress", `--token=${proposal.token}`]);
    expect(stderr.join("\n")).toMatch(/expired/i);
  });

  it("wrong-scope token fails", async () => {
    const token = getToken("other-project", "tool:transition_project_task");

    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress", `--token=${token}`]);
    expect(stderr.join("\n")).toMatch(/scope mismatch/i);
  });
});

// ===========================================================================
// 3. CLI writes WITH token succeed
// ===========================================================================

describe("CLI writes with valid token", () => {
  beforeEach(() => {
    disableWriteGateBypass();
  });

  it("task transition succeeds with token", async () => {
    const token = getToken("workflow-proj", "tool:transition_project_task");
    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress", `--token=${token}`]);
    const parsed = JSON.parse(stdout.join("\n"));
    expect(parsed.newStatus).toBe("in_progress");
  });

  it("knowledge create succeeds with token", async () => {
    const token = getToken("workflow-proj", "tool:create_project_knowledge_entry");
    await handleDagCommand("knowledge", [
      "create",
      "--slug=workflow-proj",
      "--title=New Insight",
      "--kind=lesson",
      "--keywords=testing",
      `--token=${token}`,
      "--json",
    ]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed.id).toBe("new-insight");
    expect(parsed.kind).toBe("lesson");
  });
});

// ===========================================================================
// 4. CLI writes WITHOUT token fail with clear error
// ===========================================================================

describe("CLI writes without token fail", () => {
  beforeEach(() => {
    disableWriteGateBypass();
  });

  it("task transition fails without token", async () => {
    await handleDagCommand("task", ["--json", "transition", "workflow-proj", "task-alpha", "in_progress"]);
    expect(stderr.join("\n")).toMatch(/write gate required/i);
  });

  it("knowledge create fails without token", async () => {
    await handleDagCommand("knowledge", [
      "create",
      "--slug=workflow-proj",
      "--title=No Token",
      "--kind=lesson",
      "--json",
    ]);
    expect(stderr.join("\n")).toMatch(/write gate required/i);
  });
});

// ===========================================================================
// 5. Batch operations with single token
// ===========================================================================

describe("batch operations with token", () => {
  beforeEach(() => {
    disableWriteGateBypass();
  });

  it("batch succeeds with valid token", async () => {
    const token = getBatchToken("workflow-proj");
    const batchFile = join(dataDir, "batch-workflow.json");
    writeFileSync(
      batchFile,
      JSON.stringify([
        { op: "task-transition", slug: "workflow-proj", taskId: "task-alpha", status: "in_progress" },
        { op: "knowledge-create", slug: "workflow-proj", title: "Batch Lesson", kind: "gotcha", body: "Be careful!" },
      ]),
    );

    await handleDagCommand("batch", [`--file=${batchFile}`, `--token=${token}`, "--json"]);
    const parsed = JSON.parse(stdout[0]);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].success).toBe(true);
    expect(parsed[1].success).toBe(true);
  });

  it("batch fails without token", async () => {
    const batchFile = join(dataDir, "batch-no-token.json");
    writeFileSync(
      batchFile,
      JSON.stringify([
        { op: "task-transition", slug: "workflow-proj", taskId: "task-alpha", status: "in_progress" },
      ]),
    );

    await handleDagCommand("batch", [`--file=${batchFile}`, "--json"]);
    const output = stdout[0];
    const parsed = JSON.parse(output);
    expect(parsed[0].success).toBe(false);
    expect(parsed[0].error).toMatch(/write gate required/i);
  });
});
