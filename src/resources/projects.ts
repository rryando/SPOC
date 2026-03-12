import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const DOC_FILES: Record<string, string> = {
  overview: "overview.md",
  tasks: "tasks.md",
  dependencies: "dependencies.md",
  knowledge: "knowledge.md",
};

export function registerProjectResources(server: McpServer) {
  // Static: list all projects (root DAG graph)
  server.resource(
    "projects-list",
    "cc-dag://projects",
    { description: "Root DAG graph — all projects and their dependency edges", mimeType: "application/json" },
    async (uri) => {
      const metaPath = resolve(getDataDir(), "meta.json");
      const content = readFileSync(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    }
  );

  // Template: single project meta
  server.resource(
    "project-meta",
    new ResourceTemplate("cc-dag://projects/{slug}", { list: undefined }),
    { description: "Per-project metadata and document references", mimeType: "application/json" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const metaPath = resolve(getDataDir(), "projects", slug, "meta.json");

      if (!existsSync(metaPath)) {
        throw new Error(`Project "${slug}" not found.`);
      }

      const content = readFileSync(metaPath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "application/json" }],
      };
    }
  );

  // Template: project document
  server.resource(
    "project-doc",
    new ResourceTemplate("cc-dag://projects/{slug}/{doc}", { list: undefined }),
    { description: "Project document content (overview, tasks, dependencies, knowledge)", mimeType: "text/markdown" },
    async (uri, variables) => {
      const slug = variables.slug as string;
      const doc = variables.doc as string;
      const fileName = DOC_FILES[doc];

      if (!fileName) {
        throw new Error(`Invalid doc type "${doc}". Must be: ${Object.keys(DOC_FILES).join(", ")}`);
      }

      const filePath = resolve(getDataDir(), "projects", slug, fileName);
      if (!existsSync(filePath)) {
        throw new Error(`Document "${doc}" not found for project "${slug}".`);
      }

      const content = readFileSync(filePath, "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }],
      };
    }
  );
}
