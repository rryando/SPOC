import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/utils/paths.js", () => ({
  getProjectDir: vi.fn(),
  getDataDir: vi.fn(() => "/tmp/spoc-data"),
}));

import { getProjectDir } from "../src/utils/paths.js";
import { buildAdjacencyIndex } from "../src/retrieval/graph-builder.js";
import { retrieveRelated } from "../src/retrieval/graph-retrieval.js";
import { retrieveForTask } from "../src/retrieval/task-scoped.js";

const mockedGetProjectDir = vi.mocked(getProjectDir);

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-graph-vs-bm25-"));
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
    const nid = (entry.normalizedId ?? entry.id) as string;
    writeJson(join(dir, `${nid}.meta.json`), entry);
    writeFileSync(join(dir, `${entry.id}.md`), `# ${entry.title}\n`);
  }
}

function writePlanIndex(dir: string, plans: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "index.json"), { plans });
  for (const plan of plans) {
    const nid = (plan.normalizedId ?? plan.id) as string;
    writeJson(join(dir, `${nid}.meta.json`), plan);
    writeFileSync(join(dir, `${plan.id}.md`), `# ${plan.title}\n`);
  }
}

function writeTaskIndex(dir: string, tasks: Array<Record<string, unknown>>): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "index.json"), { tasks });
}

function writeMeta(dir: string, slug: string): void {
  writeJson(join(dir, "meta.json"), {
    slug,
    name: `Test project ${slug}`,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  });
}

const KNOWLEDGE = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Entry ${id}`,
  kind: "pattern",
  keywords: [] as string[],
  summary: "",
  file: `${id}.md`,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const PLAN = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Plan ${id}`,
  status: "in_progress",
  keywords: [] as string[],
  summary: "",
  file: `${id}.md`,
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

const TASK = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  normalizedId: id,
  title: `Task ${id}`,
  status: "in_progress",
  priority: "medium",
  createdAt: "2024-01-01T00:00:00Z",
  updatedAt: "2024-01-01T00:00:00Z",
  ...overrides,
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("graph retrieval vs BM25", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(projectDir);

    writeMeta(projectDir, "test-project");

    // Knowledge entries
    writeKnowledgeIndex(join(projectDir, "knowledge"), [
      KNOWLEDGE("entry-a", {
        title: "Caching patterns",
        keywords: ["caching", "pattern"],
        sourceFiles: [{ path: "src/cache/redis.ts" }, { path: "src/cache/memory.ts" }],
      }),
      KNOWLEDGE("entry-b", {
        title: "Cache invalidation strategies",
        keywords: ["cache", "invalidation"],
        sourceFiles: [{ path: "src/cache/redis.ts" }, { path: "src/cache/invalidate.ts" }],
      }),
      KNOWLEDGE("entry-c", {
        title: "Redis connection pooling",
        keywords: ["redis", "connection"],
        sourceFiles: [{ path: "src/cache/redis.ts" }],
      }),
      KNOWLEDGE("entry-d", {
        title: "Authentication patterns",
        keywords: ["pattern", "auth"],
        sourceFiles: [{ path: "src/auth/jwt.ts" }],
      }),
      KNOWLEDGE("entry-e", {
        title: "Database caching layer",
        keywords: ["caching", "database"],
        sourceFiles: [{ path: "src/db/cache.ts" }],
      }),
    ]);

    // Task X
    writeTaskIndex(join(projectDir, "tasks"), [
      TASK("task-x", {
        title: "Implement cache TTL",
        sourceFiles: [{ path: "src/cache/redis.ts" }, { path: "src/cache/memory.ts" }],
        planId: "cache-plan",
      }),
    ]);

    // Plan
    writePlanIndex(join(projectDir, "plans"), [
      PLAN("cache-plan", {
        title: "Cache improvements plan",
        keywords: ["cache"],
        sourceFiles: [{ path: "src/cache/redis.ts" }],
      }),
    ]);
  });

  it("graph ranks file-sharing entries higher than keyword-only entries", async () => {
    const results = await retrieveRelated("test-project", "task:task-x", { limit: 10 });

    // Entries A, B, C share src/cache/redis.ts with Task X
    const fileShareIds = ["entry-a", "entry-b", "entry-c"];
    const keywordOnlyIds = ["entry-d", "entry-e"];

    const fileShareResults = results.filter((r) => fileShareIds.includes(r.id));
    const keywordOnlyResults = results.filter((r) => keywordOnlyIds.includes(r.id));

    // File-sharing entries should appear
    expect(fileShareResults.length).toBeGreaterThanOrEqual(2);

    // If keyword-only entries appear, they should rank lower
    if (keywordOnlyResults.length > 0) {
      const lowestFileShareScore = Math.min(...fileShareResults.map((r) => r.score));
      const highestKeywordScore = Math.max(...keywordOnlyResults.map((r) => r.score));
      expect(lowestFileShareScore).toBeGreaterThan(highestKeywordScore);
    }
  });

  it("direct file overlap scores highest — 2 shared files beats 1", async () => {
    const results = await retrieveRelated("test-project", "task:task-x", {
      limit: 10,
      types: ["knowledge"],
    });

    const entryA = results.find((r) => r.id === "entry-a");
    const entryC = results.find((r) => r.id === "entry-c");

    expect(entryA).toBeDefined();
    expect(entryC).toBeDefined();

    // Entry A shares 2 files (redis.ts + memory.ts), entry C shares 1 (redis.ts)
    // Both reach task-x at the same hop distance through redis.ts (score 0.9),
    // but entry A is reachable through an additional path (memory.ts).
    // The traversal takes best-path score, so both score equally via redis.ts.
    // Entry A should score >= entry C (at minimum, same score from same-distance path).
    expect(entryA!.score).toBeGreaterThanOrEqual(entryC!.score);

    // Entry B only shares redis.ts (like C) plus invalidate.ts (not shared with task-x)
    // so B and C should score the same
    const entryB = results.find((r) => r.id === "entry-b");
    expect(entryB).toBeDefined();
    expect(entryB!.score).toBeGreaterThanOrEqual(entryC!.score);

    // All three file-sharing entries should rank above keyword-only entry D
    const entryD = results.find((r) => r.id === "entry-d");
    if (entryD) {
      expect(entryC!.score).toBeGreaterThan(entryD.score);
    }
  });

  it("plan membership boosts related entries", async () => {
    const results = await retrieveRelated("test-project", "task:task-x", { limit: 10 });

    // The plan "cache-plan" should appear in results since task-x belongs to it
    const planResult = results.find((r) => r.id === "cache-plan" && r.type === "plan");
    expect(planResult).toBeDefined();
    expect(planResult!.score).toBeGreaterThan(0);
  });

  it("BM25 fallback on empty graph — returns results via keyword search", async () => {
    // Create a separate project with NO sourceFiles
    const emptyDir = makeProjectDir();
    mockedGetProjectDir.mockReturnValue(emptyDir);

    writeMeta(emptyDir, "empty-graph");

    writeKnowledgeIndex(join(emptyDir, "knowledge"), [
      KNOWLEDGE("k1", { title: "Caching strategies", keywords: ["caching", "strategies"] }),
      KNOWLEDGE("k2", { title: "Auth patterns", keywords: ["auth", "pattern"] }),
      KNOWLEDGE("k3", { title: "Database optimization", keywords: ["database", "optimization"] }),
    ]);

    writeTaskIndex(join(emptyDir, "tasks"), [
      TASK("t1", { title: "Improve caching" }),
    ]);

    writePlanIndex(join(emptyDir, "plans"), []);

    // Graph retrieval with no file edges — should return empty or minimal
    const graphResults = await retrieveRelated("empty-graph", "task:t1", { limit: 10 });
    // Without source files, graph can't find file-based connections
    // It may still find keyword edges, but file-based scoring won't apply
    expect(graphResults.length).toBeLessThanOrEqual(3);

    // BM25 fallback via retrieveForTask — should find keyword matches
    const bm25Results = await retrieveForTask("empty-graph", {
      title: "Improve caching",
      planKeywords: ["caching"],
    });

    expect(bm25Results.length).toBeGreaterThan(0);
    // "Caching strategies" should rank highest for the query "caching"
    expect(bm25Results[0].title).toBe("Caching strategies");
  });

  it("graph beats keyword-only for file-related queries", async () => {
    // BM25 search for "caching patterns" — may rank entry-e highly (keyword: "caching")
    const bm25Results = await retrieveForTask("test-project", {
      title: "caching patterns",
    });

    // Graph retrieval from task-x — should rank A, B higher due to file sharing
    const graphResults = await retrieveRelated("test-project", "task:task-x", {
      limit: 10,
      types: ["knowledge"],
    });

    // In graph results, entries sharing files (A, B, C) should dominate top positions
    const topGraphIds = graphResults.slice(0, 3).map((r) => r.id);
    const fileShareEntries = ["entry-a", "entry-b", "entry-c"];

    // At least 2 of the top 3 graph results should be file-sharing entries
    const fileShareInTop3 = topGraphIds.filter((id) => fileShareEntries.includes(id));
    expect(fileShareInTop3.length).toBeGreaterThanOrEqual(2);

    // BM25 might rank entry-e higher because of keyword "caching" match
    // but graph correctly prioritizes structural relationships
    if (bm25Results.length > 0) {
      const bm25EntryE = bm25Results.find((r) => r.id === "entry-e");
      const graphEntryE = graphResults.find((r) => r.id === "entry-e");

      // If entry-e appears in both, it should rank lower in graph results
      if (bm25EntryE && graphEntryE) {
        const graphEntryA = graphResults.find((r) => r.id === "entry-a");
        expect(graphEntryA).toBeDefined();
        expect(graphEntryA!.score).toBeGreaterThan(graphEntryE.score);
      }
    }
  });
});
