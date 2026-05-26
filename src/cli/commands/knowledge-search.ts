// ---------------------------------------------------------------------------
// Knowledge search command — split from knowledge.ts for 400-line limit
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs";
import { buildProjectRetrievalIndex } from "../../retrieval/index-builder.js";
import { getProjectDir } from "../../utils/paths.js";
import { type KnowledgeKind, readKnowledgeIndex } from "../../utils/project-memory.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

defineCommand({
  path: "knowledge search",
  description: "Search knowledge entries using BM25 scoring",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    query: { type: "string", required: true, positional: 1, description: "Search query" },
    kind: {
      type: "string",
      description: "Filter by kind",
      enum: ["lesson", "gotcha", "pattern", "feature", "decision", "reference"],
    },
  },
  handler: handleKnowledgeSearch,
});

async function handleKnowledgeSearch(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const query = params.query as string;
  const kind = params.kind as KnowledgeKind | undefined;
  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }
  const index = await buildProjectRetrievalIndex(slug);
  let results = index.searchKnowledge(query, 10);
  if (kind) {
    const knowledgeIndex = await readKnowledgeIndex(projectDir);
    const kindSet = new Set(knowledgeIndex.entries.filter((e) => e.kind === kind).map((e) => e.id));
    results = results.filter((r) => kindSet.has(r.id));
  }
  return success(results);
}
