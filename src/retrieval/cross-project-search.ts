/**
 * Cross-project knowledge search.
 *
 * Queries knowledge entries (and optionally plans) across ALL projects in the
 * DAG, returning results annotated with their source project slug.
 */

import { readRootMeta } from "../utils/dag.js";
import { getDataDir, getProjectDir } from "../utils/paths.js";
import { readKnowledgeIndex } from "../utils/project-memory.js";
import { buildProjectRetrievalIndex, type RetrievalIndex } from "./index-builder.js";

export interface CrossProjectSearchOptions {
  query: string;
  limit?: number;
  projectSlugs?: string[];
  includeKnowledge?: boolean;
  includePlans?: boolean;
  kind?: string;
}

export interface CrossProjectResult {
  projectSlug: string;
  entryId: string;
  entryType: "knowledge" | "plan";
  title: string;
  summary: string;
  score: number;
  kind?: string;
  status?: string;
}

/**
 * Search knowledge and/or plan entries across all (or a subset of) projects.
 * Results are sorted by BM25 score descending and capped at the specified limit.
 */
export async function searchAcrossProjects(
  options: CrossProjectSearchOptions,
): Promise<CrossProjectResult[]> {
  const {
    query,
    limit = 10,
    projectSlugs,
    includeKnowledge = true,
    includePlans = false,
  } = options;

  if (!query.trim()) return [];

  const dataDir = getDataDir();
  const rootMeta = await readRootMeta(dataDir);

  // Determine which projects to search
  const slugs =
    projectSlugs && projectSlugs.length > 0
      ? projectSlugs.filter((s) => rootMeta.projects.some((p) => p.id === s))
      : rootMeta.projects.map((p) => p.id);

  // Collect results across all projects
  const allResults: CrossProjectResult[] = [];

  // Use a generous per-project limit to avoid premature truncation before global sort
  const perProjectLimit = limit * 3;

  for (const slug of slugs) {
    let index: RetrievalIndex;
    try {
      index = await buildProjectRetrievalIndex(slug);
    } catch {
      // Skip projects with missing/corrupt data
      continue;
    }

    if (includeKnowledge) {
      const knowledgeResults = index.searchKnowledge(query, perProjectLimit);
      for (const r of knowledgeResults) {
        // Apply kind filter if specified (BM25 doesn't filter by kind natively)
        if (options.kind && r.type === "knowledge") {
          // We need to check kind from the entry metadata — but ScoredEntry doesn't carry kind.
          // We'll do a post-filter below after enrichment.
        }
        allResults.push({
          projectSlug: slug,
          entryId: r.id,
          entryType: "knowledge",
          title: r.title,
          summary: r.summary,
          score: r.score,
        });
      }
    }

    if (includePlans) {
      const planResults = index.searchPlans(query, perProjectLimit);
      for (const r of planResults) {
        allResults.push({
          projectSlug: slug,
          entryId: r.id,
          entryType: "plan",
          title: r.title,
          summary: r.summary,
          score: r.score,
        });
      }
    }
  }

  // Sort by score descending
  allResults.sort((a, b) => b.score - a.score);

  // Apply kind filter if specified (for knowledge entries only)
  let filtered = allResults;
  if (options.kind) {
    // We need to enrich knowledge entries with their kind to filter.
    // Since buildProjectRetrievalIndex doesn't expose kind, we do a lazy
    // enrichment by re-reading knowledge indexes for projects that have results.
    filtered = await filterByKind(allResults, options.kind);
  }

  return filtered.slice(0, limit);
}

/**
 * Post-filter results by knowledge kind. Plan entries pass through unfiltered.
 */
async function filterByKind(
  results: CrossProjectResult[],
  kind: string,
): Promise<CrossProjectResult[]> {
  // Build a map of project -> Set<entryId> that match the kind
  const kindCache = new Map<string, Set<string>>();

  const projectSlugs = [
    ...new Set(results.filter((r) => r.entryType === "knowledge").map((r) => r.projectSlug)),
  ];

  for (const slug of projectSlugs) {
    try {
      const projectDir = getProjectDir(slug);
      const knowledgeIndex = await readKnowledgeIndex(projectDir);
      const matchingIds = new Set(
        knowledgeIndex.entries.filter((e) => e.kind === kind).map((e) => e.id),
      );
      kindCache.set(slug, matchingIds);
    } catch {
      kindCache.set(slug, new Set());
    }
  }

  return results.filter((r) => {
    if (r.entryType !== "knowledge") return true;
    const allowed = kindCache.get(r.projectSlug);
    return allowed?.has(r.entryId) ?? false;
  });
}
