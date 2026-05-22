/**
 * Adapter that builds BM25 retrieval indexes from SPOC project knowledge and plan entries.
 */

import { createBm25Index, type Document, type Bm25Index } from "./bm25.js";
import { getProjectDir } from "../utils/paths.js";
import { readKnowledgeIndex, readPlanIndex, type KnowledgeMeta, type PlanMeta } from "../utils/project-memory.js";

export interface ScoredEntry {
  id: string;
  type: "knowledge" | "plan";
  title: string;
  summary: string;
  score: number;
}

export interface RetrievalIndex {
  searchKnowledge(query: string, limit?: number): ScoredEntry[];
  searchPlans(query: string, limit?: number): ScoredEntry[];
  searchAll(query: string, limit?: number): ScoredEntry[];
}

const FIELD_WEIGHTS = { title: 3, keywords: 2, summary: 1 };

function knowledgeToDocument(entry: KnowledgeMeta): Document {
  return {
    id: entry.id,
    fields: {
      title: entry.title,
      keywords: entry.keywords.join(" "),
      summary: entry.summary ?? "",
    },
  };
}

function planToDocument(plan: PlanMeta): Document {
  return {
    id: plan.id,
    fields: {
      title: plan.title,
      keywords: plan.keywords.join(" "),
      summary: plan.summary ?? "",
    },
  };
}

function buildSearchFn(
  index: Bm25Index,
  metaMap: Map<string, { title: string; summary: string; type: "knowledge" | "plan" }>,
): (query: string, limit?: number) => ScoredEntry[] {
  return (query: string, limit = 10): ScoredEntry[] => {
    const results = index.search(query, limit);
    return results.map((r) => {
      const meta = metaMap.get(r.id)!;
      return {
        id: r.id,
        type: meta.type,
        title: meta.title,
        summary: meta.summary,
        score: r.score,
      };
    });
  };
}

/**
 * Builds a retrieval index for a project's knowledge and plan entries.
 * Gracefully returns empty results if the project data cannot be read.
 */
export async function buildProjectRetrievalIndex(slug: string): Promise<RetrievalIndex> {
  const projectDir = getProjectDir(slug);

  let knowledgeEntries: KnowledgeMeta[] = [];
  let planEntries: PlanMeta[] = [];

  try {
    const knowledgeIndex = await readKnowledgeIndex(projectDir);
    knowledgeEntries = knowledgeIndex.entries;
  } catch {
    // Graceful: empty knowledge
  }

  try {
    const planIndex = await readPlanIndex(projectDir);
    planEntries = planIndex.plans;
  } catch {
    // Graceful: empty plans
  }

  // Build BM25 indexes
  const knowledgeDocs = knowledgeEntries.map(knowledgeToDocument);
  const planDocs = planEntries.map(planToDocument);

  const knowledgeBm25 = createBm25Index(knowledgeDocs, FIELD_WEIGHTS);
  const planBm25 = createBm25Index(planDocs, FIELD_WEIGHTS);

  // Build meta maps for hydrating results
  const knowledgeMetaMap = new Map<string, { title: string; summary: string; type: "knowledge" | "plan" }>();
  for (const entry of knowledgeEntries) {
    knowledgeMetaMap.set(entry.id, { title: entry.title, summary: entry.summary ?? "", type: "knowledge" });
  }

  const planMetaMap = new Map<string, { title: string; summary: string; type: "knowledge" | "plan" }>();
  for (const plan of planEntries) {
    planMetaMap.set(plan.id, { title: plan.title, summary: plan.summary ?? "", type: "plan" });
  }

  const searchKnowledge = buildSearchFn(knowledgeBm25, knowledgeMetaMap);
  const searchPlans = buildSearchFn(planBm25, planMetaMap);

  const searchAll = (query: string, limit = 10): ScoredEntry[] => {
    const knowledgeResults = searchKnowledge(query, limit);
    const planResults = searchPlans(query, limit);
    const merged = [...knowledgeResults, ...planResults];
    merged.sort((a, b) => b.score - a.score);
    return merged.slice(0, limit);
  };

  return { searchKnowledge, searchPlans, searchAll };
}
