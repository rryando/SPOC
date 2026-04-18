import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, invalidFileFormat, itemNotFound, projectNotFound } from "../utils/errors.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { planMetaSchema } from "../utils/json-schemas.js";
import { getProjectDir } from "../utils/paths.js";
import {
  createPlan,
  deletePlan,
  PLAN_STATUSES,
  readPlanIndex,
  updatePlan,
} from "../utils/project-memory.js";
import { fileRefSchema } from "../utils/schemas.js";
import { normalizeIdentifier } from "../utils/slug.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerProjectPlanTools(server: McpServer) {
  // ---- create_project_plan ----
  server.tool(
    "create_project_plan",
    "Create a new structured plan within a project.",
    {
      slug: z.string().describe("Project slug"),
      title: z.string().describe("Plan title"),
      summary: z.string().optional().describe("One-line summary"),
      status: z
        .enum(PLAN_STATUSES)
        .optional()
        .default("proposed")
        .describe("Plan status (default: proposed)"),
      planId: z.string().optional().describe("Plan identifier (derived from title if omitted)"),
      keywords: z.array(z.string()).optional().default([]).describe("Searchable keywords"),
      body: z.string().optional().describe("Markdown body content"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("Source file references (path + optional anchor)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const id = params.planId ?? params.title;

        const meta = await createPlan(projectDir, {
          id,
          title: params.title,
          status: params.status,
          keywords: params.keywords,
          summary: params.summary,
          content: params.body,
          sourceFiles: params.sourceFiles,
        });

        // Read back the body file
        const bodyContent = await readFile(resolve(projectDir, meta.file), "utf-8");

        return jsonResult({ meta, body: bodyContent });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- list_project_plans ----
  server.tool(
    "list_project_plans",
    "List plans for a project, optionally filtered by status and/or keywords.",
    {
      slug: z.string().describe("Project slug"),
      status: z.enum(PLAN_STATUSES).optional().describe("Filter by status"),
      keywords: z.array(z.string()).optional().describe("Filter by keywords (any-match semantics)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const index = await readPlanIndex(projectDir);
        let plans = index.plans;

        // Filter by status
        if (params.status) {
          plans = plans.filter((p) => p.status === params.status);
        }

        // Filter by keywords (any-match: include if intersection is non-empty)
        if (params.keywords && params.keywords.length > 0) {
          const filterKeywords = new Set(params.keywords.map((k) => k.trim().toLowerCase()));
          plans = plans.filter((p) =>
            p.keywords.some((k) => filterKeywords.has(k.trim().toLowerCase())),
          );
        }

        return jsonResult({ plans });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- get_project_plan ----
  server.tool(
    "get_project_plan",
    "Get a plan's metadata and optionally its body content.",
    {
      slug: z.string().describe("Project slug"),
      planId: z.string().describe("Plan identifier"),
      includeBody: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include the markdown body (default: false)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const normalizedId = normalizeIdentifier(params.planId);
        const metaPath = resolve(projectDir, "plans", `${normalizedId}.meta.json`);

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("plan", params.planId));
        }

        const raw = await readJsonSafe<unknown>(metaPath);
        if (raw === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
        const meta = validateJson(raw, planMetaSchema, metaPath);

        if (params.includeBody) {
          const bodyPath = resolve(projectDir, meta.file);
          const body = await readFile(bodyPath, "utf-8");
          return jsonResult({ meta, body });
        }

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- update_project_plan_meta ----
  server.tool(
    "update_project_plan_meta",
    "Update a plan's metadata (title, summary, status, keywords).",
    {
      slug: z.string().describe("Project slug"),
      planId: z.string().describe("Plan identifier"),
      title: z.string().optional().describe("New title"),
      summary: z.string().optional().describe("New summary"),
      status: z.enum(PLAN_STATUSES).optional().describe("New status"),
      keywords: z.array(z.string()).optional().describe("New keywords"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("New source file references (replaces existing; empty array clears)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const meta = await updatePlan(projectDir, {
          id: params.planId,
          title: params.title,
          summary: params.summary,
          status: params.status,
          keywords: params.keywords,
          sourceFiles: params.sourceFiles,
        });

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- update_project_plan_body ----
  server.tool(
    "update_project_plan_body",
    "Update a plan's markdown body content.",
    {
      slug: z.string().describe("Project slug"),
      planId: z.string().describe("Plan identifier"),
      body: z.string().describe("New markdown body content"),
      dryRun: z.boolean().optional().default(false).describe("Return what would be written without writing to disk"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const normalizedId = normalizeIdentifier(params.planId);
        const metaPath = resolve(projectDir, "plans", `${normalizedId}.meta.json`);

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("plan", params.planId));
        }

        const rawMeta = await readJsonSafe<unknown>(metaPath);
        if (rawMeta === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
        const existingMeta = validateJson(rawMeta, planMetaSchema, metaPath);
        const bodyPath = resolve(projectDir, existingMeta.file);

        if (params.dryRun) {
          const bytes = Buffer.byteLength(params.body, "utf-8");
          return jsonResult({
            dryRun: true,
            wouldWrite: {
              path: bodyPath,
              bytes,
              preview: params.body.slice(0, 200),
            },
          });
        }

        // Write the new body
        await writeFile(bodyPath, params.body, "utf-8");

        // Update the meta's updatedAt by calling updatePlan with just id
        const meta = await updatePlan(projectDir, { id: params.planId });

        return jsonResult({ meta, body: params.body });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- delete_project_plan ----
  server.tool(
    "delete_project_plan",
    "Delete a plan and its body from a project.",
    {
      slug: z.string().describe("Project slug"),
      planId: z.string().describe("Plan identifier"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }
        await deletePlan(projectDir, params.planId);
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Deleted plan "${params.planId}" from project "${params.slug}".`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
