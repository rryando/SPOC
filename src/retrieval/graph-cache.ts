/**
 * Mtime-based cache for graph adjacency indexes.
 */

import { stat } from "node:fs/promises";
import { buildAdjacencyIndex } from "./graph-builder.js";
import type { AdjacencyIndex } from "./graph-types.js";

export interface GraphCacheOptions {
  maxAge?: number; // max cache age in ms, default 60000 (1 minute)
}

export interface GraphCache {
  get(slug: string): Promise<AdjacencyIndex | null>;
  getOrBuild(slug: string): Promise<AdjacencyIndex>;
  invalidate(slug: string): void;
  invalidateAll(): void;
}

async function getMtimeMs(filePath: string): Promise<number> {
  try {
    const s = await stat(filePath);
    return s.mtimeMs;
  } catch {
    return -1;
  }
}

async function isValid(index: AdjacencyIndex, maxAge: number): Promise<boolean> {
  const age = Date.now() - new Date(index.buildTime).getTime();
  if (age >= maxAge) return false;

  for (const [filePath, storedMtime] of Object.entries(index.sourceHashes)) {
    const currentMtime = await getMtimeMs(filePath);
    if (currentMtime === -1 || currentMtime !== storedMtime) return false;
  }

  return true;
}

export function createGraphCache(options?: GraphCacheOptions): GraphCache {
  const maxAge = options?.maxAge ?? 60_000;
  const store = new Map<string, AdjacencyIndex>();
  const pending = new Map<string, Promise<AdjacencyIndex>>();

  const cache: GraphCache = {
    async get(slug: string): Promise<AdjacencyIndex | null> {
      const cached = store.get(slug);
      if (!cached) return null;
      if (await isValid(cached, maxAge)) return cached;
      store.delete(slug);
      return null;
    },

    async getOrBuild(slug: string): Promise<AdjacencyIndex> {
      const cached = await cache.get(slug);
      if (cached) return cached;

      const inflight = pending.get(slug);
      if (inflight) return inflight;

      const promise = buildAdjacencyIndex(slug).then((index) => {
        store.set(slug, index);
        pending.delete(slug);
        return index;
      });
      pending.set(slug, promise);
      return promise;
    },

    invalidate(slug: string): void {
      store.delete(slug);
      pending.delete(slug);
    },

    invalidateAll(): void {
      store.clear();
      pending.clear();
    },
  };

  return cache;
}
