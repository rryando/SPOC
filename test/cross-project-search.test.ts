import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/dag.js", () => ({
  readRootMeta: vi.fn(),
}));

vi.mock("../src/utils/paths.js", () => ({
  getDataDir: () => "/fake-data",
  getProjectDir: (slug: string) => `/fake-data/projects/${slug}`,
}));

vi.mock("../src/retrieval/index-builder.js", () => ({
  buildProjectRetrievalIndex: vi.fn(),
}));

vi.mock("../src/utils/project-memory.js", () => ({
  readKnowledgeIndex: vi.fn(),
}));

import { readRootMeta } from "../src/utils/dag.js";
import { buildProjectRetrievalIndex } from "../src/retrieval/index-builder.js";
import { readKnowledgeIndex } from "../src/utils/project-memory.js";
import { searchAcrossProjects } from "../src/retrieval/cross-project-search.js";
import type { RetrievalIndex, ScoredEntry } from "../src/retrieval/index-builder.js";
import type { RootMeta } from "../src/utils/dag.js";

const mockReadRootMeta = vi.mocked(readRootMeta);
const mockBuildIndex = vi.mocked(buildProjectRetrievalIndex);
const mockReadKnowledge = vi.mocked(readKnowledgeIndex);

function makeIndex(knowledge: ScoredEntry[] = [], plans: ScoredEntry[] = []): RetrievalIndex {
  return {
    searchKnowledge: (_q: string, _l?: number) => knowledge,
    searchPlans: (_q: string, _l?: number) => plans,
    searchAll: (_q: string, _l?: number) => [...knowledge, ...plans].sort((a, b) => b.score - a.score),
  };
}

const twoProjectMeta: RootMeta = {
  version: "1.0",
  projects: [
    { id: "proj-a", name: "Project A", status: "active", dependsOn: [] },
    { id: "proj-b", name: "Project B", status: "active", dependsOn: [] },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockReadRootMeta.mockResolvedValue(twoProjectMeta);
});

describe("searchAcrossProjects", () => {
  it("returns results from multiple projects sorted by score", async () => {
    mockBuildIndex.mockImplementation(async (slug: string) => {
      if (slug === "proj-a") {
        return makeIndex([
          { id: "k1", type: "knowledge", title: "Auth patterns", summary: "Auth flows", score: 5.2 },
        ]);
      }
      return makeIndex([
        { id: "k2", type: "knowledge", title: "Auth middleware", summary: "Middleware auth", score: 7.1 },
      ]);
    });

    const results = await searchAcrossProjects({ query: "auth" });

    expect(results).toHaveLength(2);
    expect(results[0].projectSlug).toBe("proj-b");
    expect(results[0].entryId).toBe("k2");
    expect(results[0].score).toBe(7.1);
    expect(results[1].projectSlug).toBe("proj-a");
    expect(results[1].entryId).toBe("k1");
  });

  it("filters by projectSlugs subset", async () => {
    mockBuildIndex.mockImplementation(async (slug: string) => {
      if (slug === "proj-a") {
        return makeIndex([
          { id: "k1", type: "knowledge", title: "Something", summary: "", score: 3 },
        ]);
      }
      return makeIndex([
        { id: "k2", type: "knowledge", title: "Something else", summary: "", score: 5 },
      ]);
    });

    const results = await searchAcrossProjects({ query: "something", projectSlugs: ["proj-a"] });

    expect(results).toHaveLength(1);
    expect(results[0].projectSlug).toBe("proj-a");
  });

  it("skips projects with errors gracefully", async () => {
    mockBuildIndex.mockImplementation(async (slug: string) => {
      if (slug === "proj-a") throw new Error("corrupt data");
      return makeIndex([
        { id: "k1", type: "knowledge", title: "Valid", summary: "", score: 4 },
      ]);
    });

    const results = await searchAcrossProjects({ query: "valid" });

    expect(results).toHaveLength(1);
    expect(results[0].projectSlug).toBe("proj-b");
  });

  it("respects limit", async () => {
    mockBuildIndex.mockResolvedValue(
      makeIndex([
        { id: "k1", type: "knowledge", title: "A", summary: "", score: 10 },
        { id: "k2", type: "knowledge", title: "B", summary: "", score: 9 },
        { id: "k3", type: "knowledge", title: "C", summary: "", score: 8 },
      ]),
    );

    const results = await searchAcrossProjects({ query: "test", limit: 2, projectSlugs: ["proj-a"] });

    expect(results).toHaveLength(2);
    expect(results[0].score).toBe(10);
    expect(results[1].score).toBe(9);
  });

  it("returns empty for blank query", async () => {
    const results = await searchAcrossProjects({ query: "   " });
    expect(results).toHaveLength(0);
  });

  it("includes plans when includePlans is true", async () => {
    mockBuildIndex.mockResolvedValue(
      makeIndex(
        [{ id: "k1", type: "knowledge", title: "Knowledge entry", summary: "", score: 3 }],
        [{ id: "p1", type: "plan", title: "Plan entry", summary: "", score: 6 }],
      ),
    );

    const results = await searchAcrossProjects({ query: "entry", includePlans: true });

    const planResults = results.filter((r) => r.entryType === "plan");
    expect(planResults.length).toBeGreaterThan(0);
    expect(planResults[0].entryId).toBe("p1");
  });

  it("excludes plans by default", async () => {
    mockBuildIndex.mockResolvedValue(
      makeIndex(
        [{ id: "k1", type: "knowledge", title: "Only knowledge", summary: "", score: 3 }],
        [{ id: "p1", type: "plan", title: "Hidden plan", summary: "", score: 10 }],
      ),
    );

    const results = await searchAcrossProjects({ query: "test" });

    expect(results.every((r) => r.entryType === "knowledge")).toBe(true);
  });

  it("filters by kind when specified", async () => {
    mockBuildIndex.mockResolvedValue(
      makeIndex([
        { id: "k1", type: "knowledge", title: "Pattern A", summary: "", score: 5 },
        { id: "k2", type: "knowledge", title: "Lesson B", summary: "", score: 4 },
      ]),
    );

    mockReadKnowledge.mockResolvedValue({
      entries: [
        { id: "k1", normalizedId: "k1", title: "Pattern A", kind: "pattern", keywords: [], summary: "", file: "k1.md", createdAt: "", updatedAt: "" },
        { id: "k2", normalizedId: "k2", title: "Lesson B", kind: "lesson", keywords: [], summary: "", file: "k2.md", createdAt: "", updatedAt: "" },
      ],
    });

    const results = await searchAcrossProjects({ query: "test", kind: "pattern", projectSlugs: ["proj-a"] });

    expect(results).toHaveLength(1);
    expect(results[0].entryId).toBe("k1");
  });

  it("ignores unknown projectSlugs in filter", async () => {
    mockBuildIndex.mockResolvedValue(
      makeIndex([{ id: "k1", type: "knowledge", title: "X", summary: "", score: 1 }]),
    );

    const results = await searchAcrossProjects({ query: "x", projectSlugs: ["nonexistent"] });

    expect(results).toHaveLength(0);
  });
});
