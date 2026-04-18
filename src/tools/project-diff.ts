import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import {
  readPlanIndex,
  readKnowledgeIndex,
  listTasks,
} from "../utils/project-memory.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerProjectDiff(server: McpServer) {
  server.tool(
    "get_project_diff",
    "Return plans, knowledge entries, and tasks updated since a given timestamp.",
    {
      slug: z.string().describe("Project slug"),
      sinceIso: z.string().describe("ISO 8601 timestamp cutoff"),
    },
    async (params) => {
      try {
        // Validate sinceIso
        const sinceDate = new Date(params.sinceIso);
        if (Number.isNaN(sinceDate.getTime())) {
          return errorResult(new Error(`Invalid sinceIso: "${params.sinceIso}" is not a valid ISO 8601 date`));
        }
        const sinceMs = sinceDate.getTime();

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        // Read all indexes
        const [planIndex, knowledgeIndex, tasks] = await Promise.all([
          readPlanIndex(projectDir),
          readKnowledgeIndex(projectDir),
          listTasks(projectDir),
        ]);

        const effectiveTs = (item: { updatedAt: string; createdAt: string }) =>
          item.updatedAt || item.createdAt;

        const isAfter = (item: { updatedAt: string; createdAt: string }) =>
          new Date(effectiveTs(item)).getTime() >= sinceMs;

        // Filter and map plans
        const plans = planIndex.plans
          .filter(isAfter)
          .map((p) => ({
            planId: p.id,
            title: p.title,
            status: p.status,
            updatedAt: effectiveTs(p),
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        // Filter and map knowledge
        const knowledge = knowledgeIndex.entries
          .filter(isAfter)
          .map((e) => ({
            entryId: e.id,
            title: e.title,
            kind: e.kind,
            updatedAt: effectiveTs(e),
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        // Filter and map tasks
        const taskResults = tasks
          .filter(isAfter)
          .map((t) => ({
            taskId: t.id,
            title: t.title,
            status: t.status,
            updatedAt: effectiveTs(t),
          }))
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

        return jsonResult({
          since: params.sinceIso,
          plans,
          knowledge,
          tasks: taskResults,
          counts: {
            plans: plans.length,
            knowledge: knowledge.length,
            tasks: taskResults.length,
            total: plans.length + knowledge.length + taskResults.length,
          },
        });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
