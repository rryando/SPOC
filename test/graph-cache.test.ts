import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGraphCache } from "../src/retrieval/graph-cache.js";
import type { AdjacencyIndex } from "../src/retrieval/graph-types.js";

vi.mock("../src/retrieval/graph-builder.js", () => {
  return { buildAdjacencyIndex: vi.fn() };
});

const { buildAdjacencyIndex } = await import("../src/retrieval/graph-builder.js");

const mockedBuild = vi.mocked(buildAdjacencyIndex);

function makeFakeIndex(sourceHashes: Record<string, number>): AdjacencyIndex {
  return {
    nodes: new Map(),
    edges: new Map(),
    fileIndex: new Map(),
    buildTime: new Date().toISOString(),
    sourceHashes,
  };
}

describe("GraphCache", () => {
  let tempDir: string;
  let knowledgePath: string;
  let plansPath: string;
  let tasksPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "graph-cache-test-"));
    await mkdir(join(tempDir, "knowledge"), { recursive: true });
    await mkdir(join(tempDir, "plans"), { recursive: true });
    await mkdir(join(tempDir, "tasks"), { recursive: true });
    knowledgePath = join(tempDir, "knowledge", "index.json");
    plansPath = join(tempDir, "plans", "index.json");
    tasksPath = join(tempDir, "tasks", "index.json");
    await writeFile(knowledgePath, "{}");
    await writeFile(plansPath, "{}");
    await writeFile(tasksPath, "{}");
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null on cache miss (first call)", async () => {
    const cache = createGraphCache();
    const result = await cache.get("my-slug");
    expect(result).toBeNull();
  });

  it("returns cached index on second call (cache hit)", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    const first = await cache.getOrBuild("my-slug");
    const second = await cache.get("my-slug");
    expect(second).toBe(first);
    expect(mockedBuild).toHaveBeenCalledTimes(1);
  });

  it("invalidates when file mtime changes", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    await cache.getOrBuild("my-slug");

    // Touch a file to change mtime
    const future = new Date(Date.now() + 5000);
    await utimes(knowledgePath, future, future);

    const result = await cache.get("my-slug");
    expect(result).toBeNull();
  });

  it("invalidate(slug) clears the cache for that slug", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    await cache.getOrBuild("my-slug");
    cache.invalidate("my-slug");
    const result = await cache.get("my-slug");
    expect(result).toBeNull();
  });

  it("invalidateAll() clears everything", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    await cache.getOrBuild("slug-a");
    await cache.getOrBuild("slug-b");
    cache.invalidateAll();
    expect(await cache.get("slug-a")).toBeNull();
    expect(await cache.get("slug-b")).toBeNull();
  });

  it("maxAge=0 causes immediate expiry", async () => {
    const cache = createGraphCache({ maxAge: 0 });
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    await cache.getOrBuild("my-slug");
    // With maxAge=0, the cache should be expired immediately
    const result = await cache.get("my-slug");
    expect(result).toBeNull();
  });

  it("getOrBuild() builds on miss and returns cached on hit", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    const first = await cache.getOrBuild("my-slug");
    const second = await cache.getOrBuild("my-slug");
    expect(first).toBe(second);
    expect(mockedBuild).toHaveBeenCalledTimes(1);
  });

  it("concurrent getOrBuild() calls only build once", async () => {
    const cache = createGraphCache();
    const { stat } = await import("node:fs/promises");
    const knowledgeStat = await stat(knowledgePath);
    const plansStat = await stat(plansPath);
    const tasksStat = await stat(tasksPath);

    const fakeIndex = makeFakeIndex({
      [knowledgePath]: knowledgeStat.mtimeMs,
      [plansPath]: plansStat.mtimeMs,
      [tasksPath]: tasksStat.mtimeMs,
    });
    mockedBuild.mockResolvedValue(fakeIndex);

    const [a, b] = await Promise.all([cache.getOrBuild("my-slug"), cache.getOrBuild("my-slug")]);
    expect(a).toBe(b);
    expect(mockedBuild).toHaveBeenCalledTimes(1);
  });
});
