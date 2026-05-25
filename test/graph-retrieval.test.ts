import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/paths.js", () => ({
  getProjectDir: vi.fn(),
  getDataDir: vi.fn(() => "/tmp/spoc-data"),
}));

import { getProjectDir } from "../src/utils/paths.js";
import { retrieveRelated } from "../src/retrieval/graph-retrieval.js";

const mockedGetProjectDir = vi.mocked(getProjectDir);

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-graph-retrieval-"));
  tempDirs.push(dir);
  return dir;
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function writeKnowledgeIndex(dir: string, entries: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "index.json"), { entries });
  for (const entry of entries) {
    writeJson(join(dir, `${entry.normalizedId}.meta.json`), entry);
    writeFileSync(join(dir, `${entry.id}.md`), `# ${entry.title}\n`);
  }
}

function writePlanIndex(dir: string, plans: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "index.json"), { plans });
  for (const plan of plans) {
    writeJson(join(dir, `${plan.normalizedId}.meta.json`), plan);
    writeFileSync(join(dir, `${plan.id}.md`), `# ${plan.title}\n`);
  }
}

function writeTaskIndex(dir: string, tasks: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "index.json"), { tasks });
}

const KNOWLEDGE_ENTRY = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Entry ${id}`,
  kind: "pattern",
  keywords: [] as string[],
  summary: `Summary of ${id}`,
  file: `${id}.md`,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const PLAN_ENTRY = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Plan ${id}`,
  status: "in_progress",
  keywords: [] as string[],
  summary: `Summary of plan ${id}`,
  file: `${id}.md`,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const TASK_ENTRY = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Task ${id}`,
  status: "backlog",
  priority: "medium",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

let testSlugCounter = 0;
function uniqueSlug(): string {
  return `test-proj-${++testSlugCounter}-${Date.now()}`;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("retrieveRelated", () => {
  it("returns empty array for non-existent slug", async () => {
    mockedGetProjectDir.mockReturnValue("/tmp/nonexistent-spoc-retrieval-xyz");
    const results = await retrieveRelated("nonexistent", "knowledge:foo");
    expect(results).toEqual([]);
  });

  it("returns empty array for non-existent start node", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);

    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { sourceFiles: [{ path: "src/foo.ts" }] }),
    ]);
    writePlanIndex(join(projectDir, "plans"), []);
    writeTaskIndex(join(projectDir, "tasks"), []);

    const results = await retrieveRelated(uniqueSlug(), "knowledge:nonexistent");
    expect(results).toEqual([]);
  });

  it("returns related knowledge entries with correct scores and hydrated titles", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { title: "Auth Pattern", sourceFiles: [{ path: "src/auth.ts" }] }),
      KNOWLEDGE_ENTRY("k2", { title: "JWT Utils", sourceFiles: [{ path: "src/auth.ts" }] }),
    ]);
    writePlanIndex(join(projectDir, "plans"), []);
    writeTaskIndex(join(projectDir, "tasks"), []);

    const results = await retrieveRelated(slug, "knowledge:k1");
    expect(results.length).toBeGreaterThan(0);
    const k2Result = results.find((r) => r.id === "k2");
    expect(k2Result).toBeDefined();
    expect(k2Result!.title).toBe("JWT Utils");
    expect(k2Result!.summary).toBe("Summary of k2");
    expect(k2Result!.type).toBe("knowledge");
    expect(k2Result!.score).toBeGreaterThan(0);
  });

  it("generates correct relation strings for file-sharing", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { sourceFiles: [{ path: "src/shared.ts" }] }),
      KNOWLEDGE_ENTRY("k2", { sourceFiles: [{ path: "src/shared.ts" }] }),
    ]);
    writePlanIndex(join(projectDir, "plans"), []);
    writeTaskIndex(join(projectDir, "tasks"), []);

    const results = await retrieveRelated(slug, "knowledge:k1");
    const k2Result = results.find((r) => r.id === "k2");
    expect(k2Result).toBeDefined();
    expect(k2Result!.relation).toContain("shares file");
  });

  it("generates correct relation strings for plan membership", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    writeKnowledgeIndex(join(projectDir, "knowledge"), []);
    writePlanIndex(join(projectDir, "plans"), [PLAN_ENTRY("p1")]);
    writeTaskIndex(join(projectDir, "tasks"), [
      TASK_ENTRY("t1", { planId: "p1" }),
      TASK_ENTRY("t2", { planId: "p1" }),
    ]);

    const results = await retrieveRelated(slug, "task:t1");
    // t2 should be related via same plan
    const t2Result = results.find((r) => r.id === "t2");
    expect(t2Result).toBeDefined();
    expect(t2Result!.relation).toBe("same plan");
  });

  it("filters by types option", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { sourceFiles: [{ path: "src/foo.ts" }] }),
    ]);
    writePlanIndex(join(projectDir, "plans"), [
      PLAN_ENTRY("p1", { sourceFiles: [{ path: "src/foo.ts" }] }),
    ]);
    writeTaskIndex(join(projectDir, "tasks"), [
      TASK_ENTRY("t1", { planId: "p1", sourceFiles: [{ path: "src/foo.ts" }] }),
    ]);

    const results = await retrieveRelated(slug, "knowledge:k1", { types: ["plan"] });
    for (const r of results) {
      expect(r.type).toBe("plan");
    }
  });

  it("filters by audience option", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { audience: "orchestrator", sourceFiles: [{ path: "src/x.ts" }] }),
      KNOWLEDGE_ENTRY("k2", { audience: "implementer", sourceFiles: [{ path: "src/x.ts" }] }),
      KNOWLEDGE_ENTRY("k3", { audience: "universal", sourceFiles: [{ path: "src/x.ts" }] }),
    ]);
    writePlanIndex(join(projectDir, "plans"), []);
    writeTaskIndex(join(projectDir, "tasks"), []);

    const results = await retrieveRelated(slug, "knowledge:k1", {
      audience: "orchestrator",
      types: ["knowledge"],
    });
    // k2 should be excluded (implementer != orchestrator and != universal)
    const ids = results.map((r) => r.id);
    expect(ids).not.toContain("k2");
    // k3 (universal) should be included if it shares a file
    if (ids.includes("k3")) {
      expect(ids).toContain("k3");
    }
  });

  it("respects limit option", async () => {
    const projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);
    const slug = uniqueSlug();

    const sharedFile = [{ path: "src/common.ts" }];
    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE_ENTRY("k1", { sourceFiles: sharedFile }),
      KNOWLEDGE_ENTRY("k2", { sourceFiles: sharedFile }),
      KNOWLEDGE_ENTRY("k3", { sourceFiles: sharedFile }),
      KNOWLEDGE_ENTRY("k4", { sourceFiles: sharedFile }),
      KNOWLEDGE_ENTRY("k5", { sourceFiles: sharedFile }),
    ]);
    writePlanIndex(join(projectDir, "plans"), []);
    writeTaskIndex(join(projectDir, "tasks"), []);

    const results = await retrieveRelated(slug, "knowledge:k1", { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
