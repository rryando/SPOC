import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPreviewServer, type PreviewServer } from "../preview/server.js";
import { readJsonSafeSync } from "../utils/json.js";
import { getProjectDir } from "../utils/paths.js";
import { jsonResult, toolError } from "../utils/tool-response.js";

// Process-scoped singleton state
let activeServer: PreviewServer | null = null;
let activeSlug: string | null = null;

function resolveProjectPlansDir(slug: string): string | null {
  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");
  if (!existsSync(metaPath)) return null;

  const meta = readJsonSafeSync<{ workspacePaths?: string[] }>(metaPath);
  if (!meta) return null;

  if (meta.workspacePaths && meta.workspacePaths.length > 0) {
    for (const ws of meta.workspacePaths) {
      const plansDir = resolve(ws, "plans");
      if (existsSync(plansDir)) return plansDir;
    }
  }

  // Fallback: plans/ in project data dir
  const plansDir = resolve(projectDir, "plans");
  return existsSync(plansDir) ? plansDir : null;
}

export function registerDiagramPreview(server: McpServer) {
  server.tool(
    "preview_diagram_server",
    "Start, stop, or check status of the diagram live preview server.",
    {
      action: z.enum(["start", "stop", "status"]).describe("Action to perform"),
      slug: z.string().optional().describe("Project slug (required for start)"),
      port: z.number().optional().describe("Port to bind (default 4077)"),
      open: z.boolean().optional().describe("Open browser after start"),
    },
    async (params) => {
      const { action } = params;

      if (action === "status") {
        return jsonResult({
          action: "status",
          running: activeServer !== null,
          port: activeServer?.port ?? null,
          url: activeServer ? `http://${activeServer.host}:${activeServer.port}` : null,
          message: activeServer
            ? `Preview server running for "${activeSlug}" on port ${activeServer.port}.`
            : "No preview server running.",
        });
      }

      if (action === "stop") {
        if (!activeServer) {
          return jsonResult({
            action: "stop",
            running: false,
            port: null,
            url: null,
            message: "No preview server is running.",
          });
        }
        const port = activeServer.port;
        await activeServer.close();
        activeServer = null;
        activeSlug = null;
        return jsonResult({
          action: "stop",
          running: false,
          port: null,
          url: null,
          message: `Preview server on port ${port} stopped.`,
        });
      }

      // action === "start"
      if (!params.slug) {
        return toolError("INVALID_INPUT", "slug is required for start action.");
      }

      if (activeServer) {
        if (activeSlug === params.slug) {
          return jsonResult({
            action: "start",
            running: true,
            port: activeServer.port,
            url: `http://${activeServer.host}:${activeServer.port}`,
            message: `Preview server already running for "${activeSlug}".`,
          });
        }
        return toolError(
          "CONFLICT",
          `A preview server is already running for "${activeSlug}". Stop it first before starting a new one.`,
        );
      }

      const plansDir = resolveProjectPlansDir(params.slug);
      if (!plansDir) {
        return toolError(
          "NOT_FOUND",
          `Could not find plans directory for project "${params.slug}".`,
        );
      }

      try {
        activeServer = await createPreviewServer({
          plansDir,
          host: "127.0.0.1",
          port: params.port ?? 4077,
        });
        activeSlug = params.slug;

        const url = `http://${activeServer.host}:${activeServer.port}`;

        if (params.open) {
          const { exec } = await import("node:child_process");
          const cmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";
          exec(`${cmd} ${url}`);
        }

        return jsonResult({
          action: "start",
          running: true,
          port: activeServer.port,
          url,
          message: `Preview server started for "${params.slug}" at ${url}.`,
        });
      } catch (err) {
        return toolError("SERVER_ERROR", err instanceof Error ? err.message : String(err));
      }
    },
  );
}

/**
 * Reset singleton state (for testing).
 */
export async function _resetPreviewServerState(): Promise<void> {
  if (activeServer) {
    await activeServer.close();
    activeServer = null;
    activeSlug = null;
  }
}
