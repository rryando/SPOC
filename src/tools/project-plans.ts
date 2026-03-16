import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { getDataDir } from "../utils/paths.js";
import {
  PLAN_STATUSES,
  createPlan,
  updatePlan,
  readPlanIndex,
  type PlanStatus,
} from "../utils/project-memory.js";
import { normalizeIdentifier } from "../utils/slug.js";
import { DagError, formatError, projectNotFound, itemNotFound } from "../utils/errors.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: `Error: ${err instanceof Error ? err.message : String(err)}`,
      },
    ],
    isError: true,
  };
}

function getProjectDir(slug: string): string {
  return resolve(getDataDir(), "projects", slug);
}

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
      planId: z
        .string()
        .optional()
        .describe("Plan identifier (derived from title if omitted)"),
      keywords: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Searchable keywords"),
      body: z.string().optional().describe("Markdown body content"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const id = params.planId ?? params.title;

        const meta = createPlan(projectDir, {
          id,
          title: params.title,
          status: params.status,
          keywords: params.keywords,
          summary: params.summary,
          content: params.body,
        });

        // Read back the body file
        const bodyContent = readFileSync(
          resolve(projectDir, meta.file),
          "utf-8"
        );

        return jsonResult({ meta, body: bodyContent });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    }
  );

  // ---- list_project_plans ----
  server.tool(
    "list_project_plans",
    "List plans for a project, optionally filtered by status and/or keywords.",
    {
      slug: z.string().describe("Project slug"),
      status: z
        .enum(PLAN_STATUSES)
        .optional()
        .describe("Filter by status"),
      keywords: z
        .array(z.string())
        .optional()
        .describe("Filter by keywords (any-match semantics)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const index = readPlanIndex(projectDir);
        let plans = index.plans;

        // Filter by status
        if (params.status) {
          plans = plans.filter((p) => p.status === params.status);
        }

        // Filter by keywords (any-match: include if intersection is non-empty)
        if (params.keywords && params.keywords.length > 0) {
          const filterKeywords = new Set(
            params.keywords.map((k) => k.trim().toLowerCase())
          );
          plans = plans.filter((p) =>
            p.keywords.some((k) => filterKeywords.has(k.trim().toLowerCase()))
          );
        }

        return jsonResult({ plans });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    }
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
        const metaPath = resolve(
          projectDir,
          "plans",
          `${normalizedId}.meta.json`
        );

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("plan", params.planId));
        }

        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));

        if (params.includeBody) {
          const bodyPath = resolve(projectDir, meta.file);
          const body = readFileSync(bodyPath, "utf-8");
          return jsonResult({ meta, body });
        }

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    }
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
      keywords: z
        .array(z.string())
        .optional()
        .describe("New keywords"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const meta = updatePlan(projectDir, {
          id: params.planId,
          title: params.title,
          summary: params.summary,
          status: params.status,
          keywords: params.keywords,
        });

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    }
  );

  // ---- update_project_plan_body ----
  server.tool(
    "update_project_plan_body",
    "Update a plan's markdown body content.",
    {
      slug: z.string().describe("Project slug"),
      planId: z.string().describe("Plan identifier"),
      body: z.string().describe("New markdown body content"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const normalizedId = normalizeIdentifier(params.planId);
        const metaPath = resolve(
          projectDir,
          "plans",
          `${normalizedId}.meta.json`
        );

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("plan", params.planId));
        }

        const existingMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const bodyPath = resolve(projectDir, existingMeta.file);

        // Write the new body
        writeFileSync(bodyPath, params.body, "utf-8");

        // Update the meta's updatedAt by calling updatePlan with just id
        const meta = updatePlan(projectDir, { id: params.planId });

        return jsonResult({ meta, body: params.body });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    }
  );
}
