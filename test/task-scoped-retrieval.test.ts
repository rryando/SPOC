import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RetrievalIndex, ScoredEntry } from "../src/retrieval/index-builder.js";

vi.mock("../src/retrieval/index-builder.js", () => ({
  buildProjectRetrievalIndex: vi.fn(),
}));

import { buildProjectRetrievalIndex } from "../src/retrieval/index-builder.js";
import { retrieveForTask, buildTaskQuery, type TaskContext } from "../src/retrieval/task-scoped.js";

const mockBuildIndex = vi.mocked(buildProjectRetrievalIndex);

function makeMockIndex(results: ScoredEntry[]): RetrievalIndex {
  return {
    searchKnowledge: vi.fn(() => []),
    searchPlans: vi.fn(() => []),
    searchAll: vi.fn((query: string, limit = 10) => results.slice(0, limit)),
  };
}

describe("buildTaskQuery", () => {
  it("includes title terms", () => {
    const query = buildTaskQuery({ title: "Add validation logic" });
    expect(query).toContain("Add validation logic");
  });

  it("includes plan keywords", () => {
    const query = buildTaskQuery({ title: "task", planKeywords: ["auth", "security"] });
    expect(query).toContain("auth");
    expect(query).toContain("security");
  });

  it("includes path segments from sourceFiles", () => {
    const query = buildTaskQuery({
      title: "task",
      sourceFiles: [{ path: "src/retrieval/index-builder.ts" }],
    });
    expect(query).toContain("src");
    expect(query).toContain("retrieval");
    expect(query).toContain("index-builder");
  });

  it("includes anchors from sourceFiles", () => {
    const query = buildTaskQuery({
      title: "task",
      sourceFiles: [{ path: "src/utils/paths.ts", anchor: "getProjectDir" }],
    });
    expect(query).toContain("getProjectDir");
  });

  it("handles task with no sourceFiles", () => {
    const query = buildTaskQuery({ title: "fix bug", planKeywords: ["perf"] });
    expect(query).toBe("fix bug perf");
  });

  it("handles task with no planKeywords", () => {
    const query = buildTaskQuery({ title: "fix bug", sourceFiles: [{ path: "a/b.ts" }] });
    expect(query).toContain("fix bug");
    expect(query).toContain("a");
    expect(query).toContain("b");
  });
});

describe("retrieveForTask", () => {
  const entries: ScoredEntry[] = [
    { id: "k1", type: "knowledge", title: "Auth pattern", summary: "auth stuff", score: 5.2 },
    { id: "p1", type: "plan", title: "Security plan", summary: "security", score: 3.1 },
    { id: "k2", type: "knowledge", title: "Logging", summary: "log stuff", score: 1.0 },
  ];

  beforeEach(() => {
    mockBuildIndex.mockResolvedValue(makeMockIndex(entries));
  });

  it("returns results sorted by score", async () => {
    const results = await retrieveForTask("my-proj", { title: "Add auth" });
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
  });

  it("respects limit parameter", async () => {
    const results = await retrieveForTask("my-proj", { title: "Add auth" }, 2);
    expect(results).toHaveLength(2);
  });

  it("empty title returns empty", async () => {
    mockBuildIndex.mockClear();
    const results = await retrieveForTask("my-proj", { title: "" });
    expect(results).toEqual([]);
    expect(mockBuildIndex).not.toHaveBeenCalled();
  });

  it("passes expanded query to searchAll", async () => {
    const mockIndex = makeMockIndex(entries);
    mockBuildIndex.mockResolvedValue(mockIndex);

    await retrieveForTask("my-proj", {
      title: "Implement login",
      planKeywords: ["auth"],
      sourceFiles: [{ path: "src/auth/login.ts", anchor: "handleLogin" }],
    });

    expect(mockIndex.searchAll).toHaveBeenCalledWith(
      expect.stringContaining("Implement login"),
      10,
    );
    expect(mockIndex.searchAll).toHaveBeenCalledWith(
      expect.stringContaining("auth"),
      10,
    );
    expect(mockIndex.searchAll).toHaveBeenCalledWith(
      expect.stringContaining("handleLogin"),
      10,
    );
  });
});
