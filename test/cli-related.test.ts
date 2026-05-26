import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock graph-retrieval
vi.mock("../src/retrieval/graph-retrieval.js", () => ({
  retrieveRelated: vi.fn().mockResolvedValue([]),
}));

import { retrieveRelated } from "../src/retrieval/graph-retrieval.js";
import { runCommand } from "./helpers/cli-runner.js";

const mockedRetrieveRelated = vi.mocked(retrieveRelated);

describe("CLI related command", () => {
  beforeEach(() => {
    mockedRetrieveRelated.mockReset();
    mockedRetrieveRelated.mockResolvedValue([]);
  });

  it("parses --task flag and calls retrieveRelated with task:<id>", async () => {
    await runCommand("related", ["my-project", "--task=abc-123"]);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "task:abc-123", { limit: 10 });
  });

  it("parses --knowledge flag and calls retrieveRelated with knowledge:<id>", async () => {
    await runCommand("related", ["my-project", "--knowledge=bm25-search"]);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "knowledge:bm25-search", {
      limit: 10,
    });
  });

  it("parses --plan flag and calls retrieveRelated with plan:<id>", async () => {
    await runCommand("related", ["my-project", "--plan=cli-layer"]);
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

    const result = await runCommand("related", ["my-project", "--task=abc"]);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: { related: unknown[] } }).data.related).toHaveLength(1);
    expect((result as { ok: true; data: { related: unknown[] } }).data.related[0]).toMatchObject({
      id: "bm25-retrieval",
      type: "knowledge",
      score: 0.85,
    });
  });

  it("returns empty array gracefully when no results", async () => {
    const result = await runCommand("related", ["my-project", "--task=abc"]);
    expect(result.ok).toBe(true);
    expect((result as { ok: true; data: { related: unknown[] } }).data.related).toEqual([]);
  });

  it("errors when no --task/--knowledge/--plan provided", async () => {
    const result = await runCommand("related", ["my-project"]);
    expect(result.ok).toBe(false);
    expect((result as { ok: false; message: string }).message).toContain(
      "One of --task, --knowledge, or --plan is required",
    );
  });

  it("respects --limit flag", async () => {
    await runCommand("related", ["my-project", "--task=abc", "--limit=5"]);
    expect(mockedRetrieveRelated).toHaveBeenCalledWith("my-project", "task:abc", { limit: 5 });
  });
});
