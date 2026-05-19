import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, invalidFileFormat, itemNotFound, projectNotFound } from "../utils/errors.js";
import { readJsonSafe, validateJson } from "../utils/json.js";
import { knowledgeMetaSchema } from "../utils/json-schemas.js";
import { getProjectDir } from "../utils/paths.js";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  KNOWLEDGE_KINDS,
  readKnowledgeIndex,
  updateKnowledgeEntry,
} from "../utils/project-memory.js";
import { fileRefSchema } from "../utils/schemas.js";
import { normalizeIdentifier } from "../utils/slug.js";
import { errorResult, jsonResult, toolError } from "../utils/tool-response.js";
import { requireWriteGate, WriteGateError } from "../utils/write-gate.js";

export function registerProjectKnowledgeTools(server: McpServer) {
  // ---- create_project_knowledge_entry ----
  server.tool(
    "create_project_knowledge_entry",
    "Create a new structured knowledge entry within a project.",
    {
      slug: z.string().describe("Project slug"),
      title: z.string().describe("Entry title"),
      summary: z.string().optional().describe("One-line summary"),
      kind: z
        .enum(KNOWLEDGE_KINDS)
        .optional()
        .default("reference")
        .describe("Knowledge kind (default: reference)"),
      entryId: z.string().optional().describe("Entry identifier (derived from title if omitted)"),
      keywords: z.array(z.string()).optional().default([]).describe("Searchable keywords"),
      body: z.string().optional().describe("Markdown body content"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("Source file references (path + optional anchor)"),
      confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
    },
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:create_project_knowledge_entry");

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const id = params.entryId ?? params.title;

        const meta = await createKnowledgeEntry(projectDir, {
          id,
          title: params.title,
          kind: params.kind,
          keywords: params.keywords,
          summary: params.summary,
          content: params.body,
          sourceFiles: params.sourceFiles,
        });

        // Read back the body file
        const bodyContent = await readFile(resolve(projectDir, meta.file), "utf-8");

        return jsonResult({ meta, body: bodyContent });
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- list_project_knowledge_entries ----
  server.tool(
    "list_project_knowledge_entries",
    "List knowledge entries for a project, optionally filtered by kind and/or keywords.",
    {
      slug: z.string().describe("Project slug"),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Filter by kind"),
      keywords: z.array(z.string()).optional().describe("Filter by keywords (any-match semantics)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const index = await readKnowledgeIndex(projectDir);
        let entries = index.entries;

        // Filter by kind
        if (params.kind) {
          entries = entries.filter((e) => e.kind === params.kind);
        }

        // Filter by keywords (any-match: include if intersection is non-empty)
        if (params.keywords && params.keywords.length > 0) {
          const filterKeywords = new Set(params.keywords.map((k) => k.trim().toLowerCase()));
          entries = entries.filter((e) =>
            e.keywords.some((k) => filterKeywords.has(k.trim().toLowerCase())),
          );
        }

        return jsonResult({ entries });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- get_project_knowledge_entry ----
  server.tool(
    "get_project_knowledge_entry",
    "Get a knowledge entry's metadata and optionally its body content.",
    {
      slug: z.string().describe("Project slug"),
      entryId: z.string().describe("Entry identifier"),
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

        const normalizedId = normalizeIdentifier(params.entryId);
        const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("knowledge entry", params.entryId));
        }

        const raw = await readJsonSafe<unknown>(metaPath);
        if (raw === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
        const meta = validateJson(raw, knowledgeMetaSchema, metaPath);

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

  // ---- update_project_knowledge_meta ----
  server.tool(
    "update_project_knowledge_meta",
    "Update a knowledge entry's metadata (title, summary, kind, keywords).",
    {
      slug: z.string().describe("Project slug"),
      entryId: z.string().describe("Entry identifier"),
      title: z.string().optional().describe("New title"),
      summary: z.string().optional().describe("New summary"),
      kind: z.enum(KNOWLEDGE_KINDS).optional().describe("New kind"),
      keywords: z.array(z.string()).optional().describe("New keywords"),
      sourceFiles: z
        .array(fileRefSchema)
        .optional()
        .describe("New source file references (replaces existing; empty array clears)"),
      confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
    },
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:update_project_knowledge_meta");

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const meta = await updateKnowledgeEntry(projectDir, {
          id: params.entryId,
          title: params.title,
          summary: params.summary,
          kind: params.kind,
          keywords: params.keywords,
          sourceFiles: params.sourceFiles,
        });

        return jsonResult({ meta });
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- update_project_knowledge_body ----
  server.tool(
    "update_project_knowledge_body",
    "Update a knowledge entry's markdown body content.",
    {
      slug: z.string().describe("Project slug"),
      entryId: z.string().describe("Entry identifier"),
      body: z.string().describe("New markdown body content"),
      dryRun: z.boolean().optional().default(false).describe("Return what would be written without writing to disk"),
      confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
    },
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:update_project_knowledge_body");

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const normalizedId = normalizeIdentifier(params.entryId);
        const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

        if (!existsSync(metaPath)) {
          return formatError(itemNotFound("knowledge entry", params.entryId));
        }

        const rawMeta = await readJsonSafe<unknown>(metaPath);
        if (rawMeta === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
        const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
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

        // Update the meta's updatedAt by calling updateKnowledgeEntry with just id
        const meta = await updateKnowledgeEntry(projectDir, { id: params.entryId });

        return jsonResult({ meta, body: params.body });
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- delete_project_knowledge_entry ----
  server.tool(
    "delete_project_knowledge_entry",
    "Delete a knowledge entry and its body from a project.",
    {
      slug: z.string().describe("Project slug"),
      entryId: z.string().describe("Entry identifier"),
      confirmationToken: z.string().optional().describe("Write-gate confirmation token"),
    },
    async (params) => {
      try {
        requireWriteGate(params.confirmationToken, params.slug, "tool:delete_project_knowledge_entry");

        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }
        await deleteKnowledgeEntry(projectDir, params.entryId);
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Deleted knowledge entry "${params.entryId}" from project "${params.slug}".`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof WriteGateError) return toolError("WRITE_GATE", err.message);
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
