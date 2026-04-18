import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import { KNOWLEDGE_KINDS, readKnowledgeIndex } from "../utils/project-memory.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function countMatches(queryTokens: Set<string>, fieldTokens: Set<string>): number {
  let count = 0;
  for (const t of queryTokens) {
    if (fieldTokens.has(t)) count++;
  }
  return count;
}

export function registerSearchKnowledge(server: McpServer) {
  server.tool(
    "search_project_knowledge",
    "Search knowledge entries by query with token-weighted scoring across title, keywords, and summary.",
    {
      slug: z.string().describe("Project slug"),
      query: z.string().describe("Search query string"),
      limit: z.number().optional().default(10).describe("Max results to return (default: 10)"),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Filter by knowledge kind"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const queryTokens = tokenize(params.query);
        if (queryTokens.size === 0) {
          return jsonResult({ results: [], totalScanned: 0 });
        }

        const index = await readKnowledgeIndex(projectDir);
        let entries = index.entries;

        if (params.kind) {
          entries = entries.filter((e) => e.kind === params.kind);
        }

        const totalScanned = entries.length;

        const scored = entries
          .map((entry) => {
            const titleScore = countMatches(queryTokens, tokenize(entry.title)) * 3;
            const keywordScore =
              countMatches(queryTokens, tokenize(entry.keywords.join(" "))) * 2;
            const summaryScore = countMatches(queryTokens, tokenize(entry.summary ?? ""));
            const score = titleScore + keywordScore + summaryScore;

            return {
              entryId: entry.id,
              title: entry.title,
              summary: entry.summary,
              kind: entry.kind,
              keywords: entry.keywords,
              score,
            };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, params.limit);

        return jsonResult({ results: scored, totalScanned });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
