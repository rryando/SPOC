import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { buildProjectRetrievalIndex } from "../retrieval/index-builder.js";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import { KNOWLEDGE_KINDS, readKnowledgeIndex } from "../utils/project-memory.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerSearchKnowledge(server: McpServer) {
  server.tool(
    "search_project_knowledge",
    "Search knowledge entries by query with token-weighted scoring across title, keywords, and summary.",
    {
      slug: z.string().describe("Project slug"),
      query: z.string().describe("Search query string"),
      limit: z.number().int().min(1).max(100).optional().default(10).describe("Max results to return (default: 10)"),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Filter by knowledge kind"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        if (!params.query.trim()) {
          return jsonResult({ results: [], totalScanned: 0 });
        }

        // Build BM25 index and search
        const retrievalIndex = await buildProjectRetrievalIndex(params.slug);
        const bm25Results = retrievalIndex.searchKnowledge(params.query, params.limit);

        // Read full knowledge index to enrich results with kind/keywords
        const knowledgeIndex = await readKnowledgeIndex(projectDir);
        const entryMap = new Map(knowledgeIndex.entries.map((e) => [e.id, e]));

        let totalScanned = knowledgeIndex.entries.length;
        if (params.kind) {
          totalScanned = knowledgeIndex.entries.filter((e) => e.kind === params.kind).length;
        }

        // Map BM25 results to existing output format, applying kind post-filter
        const results = bm25Results
          .map((r) => {
            const entry = entryMap.get(r.id);
            if (!entry) return null;
            return {
              entryId: entry.id,
              title: entry.title,
              summary: entry.summary,
              kind: entry.kind,
              keywords: entry.keywords,
              score: r.score,
            };
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .filter((r) => !params.kind || r.kind === params.kind)
          .slice(0, params.limit);

        return jsonResult({ results, totalScanned });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
