import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock graph-retrieval
vi.mock("../src/retrieval/graph-retrieval.js", () => ({
  retrieveRelated: vi.fn().mockResolvedValue([]),
}));

import { handleRelated } from "../src/cli/dag-commands.js";
import { retrieveRelated } from "../src/retrieval/graph-retrieval.js";

const mockedRetrieveRelated = vi.mocked(retrieveRelated);

describe("CLI related command", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedRetrieveRelated.mockReset();
    mockedRetrieveRelated.mockResolvedValue([]);
  });

  it("parses --task flag and calls retrieveRelated with task:<id>", async () => {
    await handleRelated(["my-project", "--task=abc-123"], true);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "task:abc-123", { limit: 10 });
  });

  it("parses --knowledge flag and calls retrieveRelated with knowledge:<id>", async () => {
    await handleRelated(["my-project", "--knowledge=bm25-search"], true);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "knowledge:bm25-search", {
      limit: 10,
    });
  });

  it("parses --plan flag and calls retrieveRelated with plan:<id>", async () => {
    await handleRelated(["my-project", "--plan=cli-layer"], true);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "plan:cli-layer", {
      limit: 10,
    });
  });

  it("returns formatted JSON output", async () => {
    mockedRetrieveRelated.mockResolvedValue([
      {
        id: "bm25-retrieval",
        type: "knowledge",
        title: "BM25 Retrieval",
        score: 0.85,
        relation: "shares file src/retrieval/bm25.ts",
      },
    ]);

    await handleRelated(["my-project", "--task=abc", "--json"], true);

    const output = logSpy.mock.calls[0][0];
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "bm25-retrieval", type: "knowledge", score: 0.85 });
  });

  it("returns empty array gracefully when no results", async () => {
    await handleRelated(["my-project", "--task=abc"], true);
    const output = logSpy.mock.calls[0][0];
    expect(JSON.parse(output)).toEqual([]);
  });

  it("errors when no --task/--knowledge/--plan provided", async () => {
    await handleRelated(["my-project"], false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("one of --task, --knowledge, or --plan is required"),
    );
  });

  it("respects --limit flag", async () => {
    await handleRelated(["my-project", "--task=abc", "--limit=5"], true);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "task:abc", { limit: 5 });
  });
});
