import { readRootMeta } from "../utils/dag.js";
import { getDataDir } from "../utils/paths.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerListProjects(server: McpServer) {
  server.tool(
    "list_projects",
    "List all projects in the DAG with their status and dependency edges. Use this to check for duplicates, find project slugs, or understand the full project graph.",
    {},
    async () => {
      try {
        const rootMeta = readRootMeta(getDataDir());
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(rootMeta, null, 2),
            },
          ],
        };
      } catch (err) {
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
    }
  );
}
