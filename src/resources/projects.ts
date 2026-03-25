import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDataDir } from "../utils/paths.js";
import { PROJECT_DOC_FILES } from "../utils/project-documents.js";
import { readKnowledgeIndex, readPlanIndex } from "../utils/project-memory.js";
import { normalizeIdentifier } from "../utils/slug.js";

/**
 * Registration order matters: the MCP SDK matches the FIRST template whose
 * pattern fits the URI.  More-specific plan/knowledge templates must be
 * registered BEFORE the generic `{slug}/{doc}` catch-all.
 */
export function registerProjectResources(server: McpServer) {
  // ── 1. Static: list all projects (root DAG graph) ──────────────────
  server.resource(
    "projects-list",
    "spoc://projects",
    {
      description: "Root DAG graph — all projects and their dependency edges",
      mimeType: "application/json",
    },
    async (uri) => {
      const metaPath = resolve(getDataDir(), "meta.json");
      const content = await readFile(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    },
  );

  // ── 2. Template: single project meta ───────────────────────────────
  server.resource(
    "project-meta",
    new ResourceTemplate("spoc://projects/{slug}", { list: undefined }),
    { description: "Per-project metadata and document references", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const metaPath = resolve(getDataDir(), "projects", slug, "meta.json");

      if (!existsSync(metaPath)) {
        throw new Error(`Project "${slug}" not found.`);
      }

      const content = await readFile(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    },
  );

  // ── 3. Plan & knowledge templates (specific — before catch-all) ────

  // 3a. Plan index
  server.resource(
    "project-plans-index",
    new ResourceTemplate("spoc://projects/{slug}/plans", { list: undefined }),
    { description: "Plan index for a project", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const projectDir = resolve(getDataDir(), "projects", slug);
      if (!existsSync(resolve(projectDir, "meta.json"))) {
        throw new Error(`Project "${slug}" not found.`);
      }
      const index = await readPlanIndex(projectDir);
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(index, null, 2), mimeType: "application/json" },
        ],
      };
    },
  );

  // 3b. Plan body (markdown)
  server.resource(
    "project-plan-body",
    new ResourceTemplate("spoc://projects/{slug}/plans/{planId}", { list: undefined }),
    { description: "Plan body markdown", mimeType: "text/markdown" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const planId = normalizeIdentifier(variables.planId as string);
      const projectDir = resolve(getDataDir(), "projects", slug);
      const metaPath = join(projectDir, "plans", `${planId}.meta.json`);

      if (!existsSync(metaPath)) {
        throw new Error(`Plan "${planId}" not found in project "${slug}".`);
      }

      const meta = JSON.parse(await readFile(metaPath, "utf-8"));
      const bodyPath = resolve(projectDir, meta.file);

      if (!existsSync(bodyPath)) {
        throw new Error(`Plan body file not found for "${planId}" in project "${slug}".`);
      }

      const content = await readFile(bodyPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }],
      };
    },
  );

  // 3c. Plan meta (JSON)
  server.resource(
    "project-plan-meta",
    new ResourceTemplate("spoc://projects/{slug}/plans/{planId}/meta", { list: undefined }),
    { description: "Plan metadata JSON", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const planId = normalizeIdentifier(variables.planId as string);
      const projectDir = resolve(getDataDir(), "projects", slug);
      const metaPath = join(projectDir, "plans", `${planId}.meta.json`);

      if (!existsSync(metaPath)) {
        throw new Error(`Plan "${planId}" not found in project "${slug}".`);
      }

      const content = await readFile(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    },
  );

  // 3d. Knowledge index
  server.resource(
    "project-knowledge-index",
    new ResourceTemplate("spoc://projects/{slug}/knowledge", { list: undefined }),
    { description: "Knowledge entry index for a project", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const projectDir = resolve(getDataDir(), "projects", slug);
      if (!existsSync(resolve(projectDir, "meta.json"))) {
        throw new Error(`Project "${slug}" not found.`);
      }
      const index = await readKnowledgeIndex(projectDir);
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(index, null, 2), mimeType: "application/json" },
        ],
      };
    },
  );

  // 3e. Knowledge body (markdown)
  server.resource(
    "project-knowledge-body",
    new ResourceTemplate("spoc://projects/{slug}/knowledge/{entryId}", { list: undefined }),
    { description: "Knowledge entry body markdown", mimeType: "text/markdown" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const entryId = normalizeIdentifier(variables.entryId as string);
      const projectDir = resolve(getDataDir(), "projects", slug);
      const metaPath = join(projectDir, "knowledge", `${entryId}.meta.json`);

      if (!existsSync(metaPath)) {
        throw new Error(`Knowledge entry "${entryId}" not found in project "${slug}".`);
      }

      const meta = JSON.parse(await readFile(metaPath, "utf-8"));
      const bodyPath = resolve(projectDir, meta.file);

      if (!existsSync(bodyPath)) {
        throw new Error(`Knowledge body file not found for "${entryId}" in project "${slug}".`);
      }

      const content = await readFile(bodyPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }],
      };
    },
  );

  // 3f. Knowledge meta (JSON)
  server.resource(
    "project-knowledge-meta",
    new ResourceTemplate("spoc://projects/{slug}/knowledge/{entryId}/meta", { list: undefined }),
    { description: "Knowledge entry metadata JSON", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const entryId = normalizeIdentifier(variables.entryId as string);
      const projectDir = resolve(getDataDir(), "projects", slug);
      const metaPath = join(projectDir, "knowledge", `${entryId}.meta.json`);

      if (!existsSync(metaPath)) {
        throw new Error(`Knowledge entry "${entryId}" not found in project "${slug}".`);
      }

      const content = await readFile(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    },
  );

  // ── 4. Catch-all: legacy project document ──────────────────────────
  server.resource(
    "project-doc",
    new ResourceTemplate("spoc://projects/{slug}/{doc}", { list: undefined }),
    {
      description: "Project document content (overview, tasks, dependencies, knowledge)",
      mimeType: "text/markdown",
    },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const doc = variables.doc as string;
      const fileName = PROJECT_DOC_FILES[doc as keyof typeof PROJECT_DOC_FILES];

      if (!fileName) {
        throw new Error(
          `Invalid doc type "${doc}". Must be: ${Object.keys(PROJECT_DOC_FILES).join(", ")}`,
        );
      }

      const filePath = resolve(getDataDir(), "projects", slug, fileName);
      if (!existsSync(filePath)) {
        throw new Error(`Document "${doc}" not found for project "${slug}".`);
      }

      const content = await readFile(filePath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }],
      };
    },
  );
}
