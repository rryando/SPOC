import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "../utils/tool-response.js";

export function registerLintBundle(server: McpServer) {
  server.tool(
    "lint_bundle",
    "Lint the opencode superpowers bundle for drift, missing files, and structural issues. Returns structured issues without modifying anything.",
    {
      bundleRoot: z
        .string()
        .optional()
        .describe("Override bundle root (default: opencode/superpowers)"),
      configRoot: z
        .string()
        .optional()
        .describe("Override config root for drift detection (default: ~/.config/opencode/skills/superpowers)"),
    },
    async (params) => {
      try {
        const repoRoot = resolve(import.meta.dirname, "../..");
        const scriptPath = resolve(repoRoot, "scripts/lint-bundle.mjs");

        const env: Record<string, string> = { ...process.env } as Record<string, string>;
        if (params.bundleRoot) env.BUNDLE_LINT_BUNDLE_ROOT = params.bundleRoot;
        if (params.configRoot) env.BUNDLE_LINT_CONFIG_ROOT = params.configRoot;

        const proc = spawnSync("node", [scriptPath], {
          cwd: repoRoot,
          env,
          encoding: "utf-8",
        });

        if (proc.stdout) {
          return jsonResult(JSON.parse(proc.stdout));
        }

        return errorResult(new Error(proc.stderr || "lint-bundle produced no output"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
