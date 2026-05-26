import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/retrieval/graph-cache.js", () => ({
  createGraphCache: vi.fn(),
}));

vi.mock("../src/utils/paths.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/utils/paths.js")>();
  return {
    ...orig,
    getProjectDir: vi.fn().mockReturnValue("/tmp/opencode/test-project"),
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  return {
    ...orig,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

import { existsSync } from "node:fs";
import { handleGraph } from "../src/cli/dag-commands.js";
import { createGraphCache } from "../src/retrieval/graph-cache.js";
import type { AdjacencyIndex } from "../src/retrieval/graph-types.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedCreateGraphCache = vi.mocked(createGraphCache);

function makeIndex(overrides?: Partial<AdjacencyIndex>): AdjacencyIndex {
  const nodes = new Map([
    ["task:t1", { id: "task:t1", type: "task" as const, title: "Task 1" }],
    ["task:t2", { id: "task:t2", type: "task" as const, title: "Task 2" }],
    ["knowledge:k1", { id: "knowledge:k1", type: "knowledge" as const, title: "K1" }],
    ["file:src/a.ts", { id: "file:src/a.ts", type: "file" as const, title: "src/a.ts" }],
    ["file:src/b.ts", { id: "file:src/b.ts", type: "file" as const, title: "src/b.ts" }],
    ["plan:p1", { id: "plan:p1", type: "plan" as const, title: "Plan 1" }],
  ]);

  const edges = new Map([
    [
      "task:t1",
      [
        {
          source: "task:t1",
          target: "file:src/a.ts",
          relation: "shares_source_file" as const,
          weight: 1,
        },
        {
          source: "task:t1",
          target: "knowledge:k1",
          relation: "shares_keywords" as const,
          weight: 0.5,
        },
      ],
    ],
    [
      "task:t2",
      [
        {
          source: "task:t2",
          target: "file:src/a.ts",
          relation: "shares_source_file" as const,
          weight: 1,
        },
        {
          source: "task:t2",
          target: "file:src/b.ts",
          relation: "shares_source_file" as const,
          weight: 1,
        },
      ],
    ],
  ]);

  const fileIndex = new Map([
    ["src/a.ts", ["task:t1", "task:t2", "knowledge:k1"]],
    ["src/b.ts", ["task:t2"]],
  ]);

  return {
    nodes,
    edges,
    fileIndex,
    buildTime: new Date().toISOString(),
    sourceHashes: {},
    ...overrides,
  };
}

describe("CLI graph inspect command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedExistsSync.mockReturnValue(true);
    mockedCreateGraphCache.mockReturnValue({
      get: vi.fn(),
      getOrBuild: vi.fn().mockResolvedValue(makeIndex()),
      invalidate: vi.fn(),
      invalidateAll: vi.fn(),
    });
  });

  it("returns correct node and edge counts", async () => {
    await handleGraph(["inspect", "my-project", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.nodeCount).toBe(6);
    expect(output.edgeCount).toBe(4);
  });

  it("mostConnectedFiles sorted correctly", async () => {
    await handleGraph(["inspect", "my-project", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    expect(output.mostConnectedFiles[0]).toEqual({ path: "src/a.ts", refs: 3 });
    expect(output.mostConnectedFiles[1]).toEqual({ path: "src/b.ts", refs: 1 });
  });

  it("identifies orphan nodes", async () => {
    await handleGraph(["inspect", "my-project", "--json"], true);
    const output = JSON.parse(logSpy.mock.calls[0][0]);
    // plan:p1 has no edges in or out
    expect(output.orphanNodes).toContain("plan:p1");
    // Nodes with edges should not be orphans
    expect(output.orphanNodes).not.toContain("task:t1");
    expect(output.orphanNodes).not.toContain("file:src/a.ts");
  });

  it("handles non-existent project gracefully", async () => {
    mockedExistsSync.mockReturnValue(false);
    await handleGraph(["inspect", "nonexistent"], false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("not found"));
  });
});
