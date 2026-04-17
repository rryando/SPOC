import { existsSync } from "node:fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DagError, formatError, projectNotFound } from "../utils/errors.js";
import { getProjectDir } from "../utils/paths.js";
import { cancelLoop, findActiveLoop, readLoopState, startLoop } from "../utils/loop-state.js";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerProjectLoopTools(server: McpServer) {
  // ---- start_project_loop ----
  server.tool(
    "start_project_loop",
    "Start a self-referential development loop for a project. The loop automatically re-prompts the agent when idle until the completion promise is emitted.",
    {
      slug: z.string().describe("Project slug"),
      sessionId: z.string().describe("Current session ID"),
      prompt: z.string().describe("The task description for the loop to work on"),
      maxIterations: z
        .number()
        .min(1)
        .max(1000)
        .optional()
        .default(100)
        .describe("Maximum number of iterations (default: 100)"),
      completionPromise: z
        .string()
        .optional()
        .default("DONE")
        .describe("The completion promise text to detect (default: DONE)"),
      strategy: z
        .enum(["continue", "reset"])
        .optional()
        .default("continue")
        .describe(
          "Continuation strategy: continue in same session or reset to new session (default: continue)",
        ),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const state = await startLoop(projectDir, {
          sessionId: params.sessionId,
          prompt: params.prompt,
          maxIterations: params.maxIterations,
          completionPromise: params.completionPromise,
          strategy: params.strategy,
          projectSlug: params.slug,
        });

        return jsonResult({
          message: `Loop started for project "${params.slug}"`,
          state,
        });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- cancel_project_loop ----
  server.tool(
    "cancel_project_loop",
    "Cancel an active development loop for a project.",
    {
      slug: z.string().describe("Project slug"),
      sessionId: z.string().describe("Current session ID (must match the loop's session)"),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }

        const cancelled = await cancelLoop(projectDir, params.sessionId);
        if (!cancelled) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No active loop found for project "${params.slug}" with session "${params.sessionId}".`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Loop cancelled for project "${params.slug}".`,
            },
          ],
        };
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );

  // ---- get_project_loop_state ----
  server.tool(
    "get_project_loop_state",
    "Get the current loop state for a project, or find any active loop across all projects.",
    {
      slug: z
        .string()
        .optional()
        .describe("Project slug. If omitted, searches all projects for an active loop."),
    },
    async (params) => {
      try {
        if (params.slug) {
          const projectDir = getProjectDir(params.slug);
          if (!existsSync(projectDir)) {
            return formatError(projectNotFound(params.slug));
          }

          const state = await readLoopState(projectDir);
          return jsonResult({ slug: params.slug, state });
        }

        // No slug — find any active loop
        const active = await findActiveLoop();
        if (!active) {
          return jsonResult({ message: "No active loop found.", state: null });
        }
        return jsonResult({
          slug: active.slug,
          state: active.state,
        });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
