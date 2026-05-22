import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readRootMeta } from "../utils/dag.js";
import { getDataDir } from "../utils/paths.js";
import { jsonResult, toolError, errorResult } from "../utils/tool-response.js";
import {
  createWriteProposal,
  consumeWriteProposalToken,
  WriteGateError,
} from "../utils/write-gate.js";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const ProposeDagWriteSchema = {
  slug: z.string().describe("Project slug to propose writes against"),
  summary: z.string().describe("Human-readable summary of intended write"),
  operations: z
    .array(z.string())
    .describe("List of operation identifiers (e.g. update_project_doc:overview)"),
  ttlMs: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Time-to-live in milliseconds (default: 120000)"),
};

const ApplyDagWriteSchema = {
  token: z.string().describe("Write proposal token to consume"),
  slug: z.string().describe("Target project slug (must match proposal scope)"),
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const DEFAULT_TTL_MS = 120_000; // 2 minutes

export function registerWriteGateTools(server: McpServer) {
  server.tool(
    "propose_dag_write",
    "Create a write proposal token scoped to a project. Must be consumed via apply_dag_write before the write proceeds.",
    ProposeDagWriteSchema,
    async (params) => {
      try {
        // Validate project exists
        const dataDir = getDataDir();
        const rootMeta = await readRootMeta(dataDir);
        const project = rootMeta.projects.find((p) => p.id === params.slug);
        if (!project) {
          return toolError("NOT_FOUND", `Project "${params.slug}" not found`);
        }

        const proposal = createWriteProposal({
          slug: params.slug,
          summary: params.summary,
          operations: params.operations,
          ttlMs: params.ttlMs ?? DEFAULT_TTL_MS,
        });

        return jsonResult(proposal);
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    "apply_dag_write",
    "Consume a write proposal token, authorizing the described operations. Returns the authorized operations list for downstream enforcement.",
    ApplyDagWriteSchema,
    async (params) => {
      try {
        const consumed = consumeWriteProposalToken(params.token, params.slug);
        return jsonResult({
          consumed: true,
          token: consumed.token,
          slug: consumed.slug,
          operations: consumed.operations,
          consumedAt: consumed.consumedAt,
        });
      } catch (err) {
        if (err instanceof WriteGateError) {
          return toolError("WRITE_GATE", err.message);
        }
        return errorResult(err);
      }
    },
  );
}
