import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeMeta } from "../src/utils/project-memory.js";

/**
 * Tests for graph-based knowledge selection in context assembly.
 *
 * We test the selectKnowledgeEntries function directly, mocking
 * retrieveRelated and retrieveForTask.
 */

// Mock retrieveRelated and retrieveForTask
vi.mock("../src/retrieval/graph-retrieval.js", () => ({
  retrieveRelated: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/retrieval/task-scoped.js", () => ({
  retrieveForTask: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/utils/paths.js", () => ({
  getProjectDir: (slug: string) => `/tmp/spoc-test-${slug}`,
  getDataDir: () => "/tmp/spoc-data",
}));

vi.mock("../src/utils/project-memory.js", async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    getTask: vi.fn().mockResolvedValue({
      id: "task-1",
      title: "Implement graph retrieval",
      status: "in_progress",
      priority: "high",
      sourceFiles: [{ path: "src/retrieval/graph-retrieval.ts" }],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    }),
  };
});

import { selectKnowledgeEntries } from "../src/cli/dag-commands.js";
import { retrieveRelated } from "../src/retrieval/graph-retrieval.js";
import { retrieveForTask } from "../src/retrieval/task-scoped.js";

const mockedRetrieveRelated = vi.mocked(retrieveRelated);
const mockedRetrieveForTask = vi.mocked(retrieveForTask);

function makeEntry(
  id: string,
  updatedAt: string,
  overrides?: Partial<KnowledgeMeta>,
): KnowledgeMeta {
  return {
    id,
    normalizedId: id,
    title: `Entry ${id}`,
    kind: "pattern",
    keywords: [],
    summary: "",
    file: `knowledge/${id}.md`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt,
    ...overrides,
  };
}

describe("selectKnowledgeEntries", () => {
  let entries: KnowledgeMeta[];

  beforeEach(() => {
    vi.clearAllMocks();
    // 12 entries with descending recency
    entries = Array.from({ length: 12 }, (_, i) =>
      makeEntry(`k${i + 1}`, `2026-01-${String(12 - i).padStart(2, "0")}T00:00:00Z`),
    );
  });

  it("without taskId: returns top 10 by recency", async () => {
    const result = await selectKnowledgeEntries("test-proj", entries, undefined);
    expect(result).toHaveLength(10);
    // k1 has latest updatedAt (Jan 12), k10 has Jan 3
    expect(result[0].id).toBe("k1");
    expect(result[9].id).toBe("k10");
  });

  it("with taskId and graph has ≥3 results: graph entries appear first", async () => {
    mockedRetrieveRelated.mockResolvedValue([
      { id: "k5", type: "knowledge", title: "Entry k5", score: 0.9, relation: "shares file" },
      { id: "k8", type: "knowledge", title: "Entry k8", score: 0.8, relation: "shares file" },
      { id: "k10", type: "knowledge", title: "Entry k10", score: 0.7, relation: "shares keywords" },
    ]);

    const result = await selectKnowledgeEntries("test-proj", entries, "task-1");
    expect(result).toHaveLength(10);
    // First 3 should be from graph
    expect(result[0].id).toBe("k5");
    expect(result[1].id).toBe("k8");
    expect(result[2].id).toBe("k10");
    // Remaining 7 filled by recency, excluding already-selected
    expect(result[3].id).toBe("k1"); // most recent not in graph
  });

  it("with taskId but sparse graph (<3 results): falls back to BM25", async () => {
    mockedRetrieveRelated.mockResolvedValue([
      { id: "k7", type: "knowledge", title: "Entry k7", score: 0.5, relation: "related" },
    ]);
    mockedRetrieveForTask.mockResolvedValue([
      { id: "k3", type: "knowledge", title: "Entry k3", score: 0.8 },
      { id: "k6", type: "knowledge", title: "Entry k6", score: 0.7 },
      { id: "k9", type: "knowledge", title: "Entry k9", score: 0.6 },
    ]);

    const result = await selectKnowledgeEntries("test-proj", entries, "task-1");
    expect(result).toHaveLength(10);
    // BM25 results first (only knowledge type)
    expect(result[0].id).toBe("k3");
    expect(result[1].id).toBe("k6");
    expect(result[2].id).toBe("k9");
    // Then recency fill
    expect(result[3].id).toBe("k1");
  });

  it("deduplication: same entry from graph and recency appears only once", async () => {
    mockedRetrieveRelated.mockResolvedValue([
      { id: "k1", type: "knowledge", title: "Entry k1", score: 0.9, relation: "shares file" },
      { id: "k2", type: "knowledge", title: "Entry k2", score: 0.8, relation: "shares file" },
      { id: "k3", type: "knowledge", title: "Entry k3", score: 0.7, relation: "shares file" },
    ]);

    const result = await selectKnowledgeEntries("test-proj", entries, "task-1");
    expect(result).toHaveLength(10);
    // k1, k2, k3 from graph — they would also be high in recency, but no duplicates
    const ids = result.map((e) => e.id);
    const uniqueIds = [...new Set(ids)];
    expect(ids).toEqual(uniqueIds);
  });

  it("total entries capped at 10 even with many graph results", async () => {
    mockedRetrieveRelated.mockResolvedValue([
      { id: "k1", type: "knowledge", title: "Entry k1", score: 0.9, relation: "shares file" },
      { id: "k2", type: "knowledge", title: "Entry k2", score: 0.8, relation: "shares file" },
      { id: "k3", type: "knowledge", title: "Entry k3", score: 0.7, relation: "shares file" },
      { id: "k4", type: "knowledge", title: "Entry k4", score: 0.6, relation: "shares file" },
      { id: "k5", type: "knowledge", title: "Entry k5", score: 0.5, relation: "shares file" },
    ]);

    const result = await selectKnowledgeEntries("test-proj", entries, "task-1");
    expect(result).toHaveLength(10);
  });
});
