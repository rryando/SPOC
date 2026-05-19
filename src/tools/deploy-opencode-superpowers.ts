import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { errorResult, jsonResult } from "../utils/tool-response.js";

interface DeployScriptResult {
  dryRun: boolean;
  source: string;
  destination: string;
  filesAdded: string[];
  filesChanged: string[];
  filesRemoved: string[];
  filesUnchanged: string[];
  restartRequired: boolean;
  restartGuidance?: string;
}

export function registerDeployOpencodeSuperpowers(server: McpServer) {
  server.tool(
    "deploy_opencode_superpowers",
    "Deploy the opencode superpowers bundle from repo to user config (~/.config/opencode). Direction: repo → config only. Default is dry-run.",
    {
      dryRun: z
        .boolean()
        .default(true)
        .describe(
          "If true (default), report what would change without writing. Set false to deploy.",
        ),
      bundleRoot: z
        .string()
        .optional()
        .describe("Override bundle root (default: opencode/superpowers)"),
      configRoot: z
        .string()
        .optional()
        .describe("Override config root (default: ~/.config/opencode)"),
    },
    async (params) => {
      try {
        const repoRoot = resolve(import.meta.dirname, "../..");
        const scriptPath = resolve(repoRoot, "scripts/deploy-opencode-superpowers.mjs");

        const env: Record<string, string> = { ...process.env } as Record<string, string>;
        env.DEPLOY_DRY_RUN = params.dryRun ? "true" : "false";
        if (params.bundleRoot) env.DEPLOY_BUNDLE_ROOT = params.bundleRoot;
        if (params.configRoot) env.DEPLOY_CONFIG_ROOT = params.configRoot;

        const proc = spawnSync("node", [scriptPath], {
          cwd: repoRoot,
          env,
          encoding: "utf-8",
        });

        if (proc.stdout) {
          const result: DeployScriptResult = JSON.parse(proc.stdout);
          return jsonResult(result);
        }

        return errorResult(new Error(proc.stderr || "deploy script produced no output"));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
}
