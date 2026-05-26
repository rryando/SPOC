// ---------------------------------------------------------------------------
// brief — Tight T0 routing brief for orchestrator
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { extractOverviewContent } from "../../utils/content-assembly.js";
import { type RootMeta, readRootMeta } from "../../utils/dag.js";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { projectMetaSchema } from "../../utils/json-schemas.js";
import { getDataDir, getProjectDir } from "../../utils/paths.js";
import {
  KNOWLEDGE_AUDIENCES,
  type KnowledgeAudience,
  listTasks,
  readKnowledgeIndex,
  readPlanIndex,
} from "../../utils/project-memory.js";
import { deriveOperatingBrief } from "../../utils/workflow-policy.js";
import { findBestMatch, type WorkspaceProject } from "../../utils/workspace-match.js";
import { renderBrief } from "../brief-renderer.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

// ---------------------------------------------------------------------------

defineCommand({
  path: "brief",
  description: "Tight T0 routing brief for orchestrator (slug, focus, counts, top knowledge)",
  params: {
    pathOrSlug: {
      type: "string",
      positional: 0,
      description: "Absolute path or project slug (defaults to cwd)",
    },
    audience: {
      type: "string",
      description: "Knowledge audience filter (default: orchestrator)",
      enum: ["orchestrator", "implementer", "designer"],
    },
    full: {
      type: "boolean",
      description: "Include done tasks/plans (default: false — only active items)",
    },
  },
  handler: handleBrief,
});

// ---------------------------------------------------------------------------

async function handleBrief(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const rawArg = params.pathOrSlug as string | undefined;
  const audience = (params.audience as KnowledgeAudience | undefined) ?? "orchestrator";
  const full = params.full as boolean | undefined;

  if (
    params.audience &&
    !(KNOWLEDGE_AUDIENCES as readonly string[]).includes(params.audience as string)
  ) {
    return failure(
      "invalid_enum",
      `Invalid audience "${params.audience}". Valid: ${KNOWLEDGE_AUDIENCES.join(", ")}`,
    );
  }

  // --- Resolve project ---
  const resolved = await resolveProject(rawArg);
  if (!resolved.ok) return resolved.result;

  const { slug, name, projectDir } = resolved;

  // --- Summary from overview ---
  const overviewPath = resolve(projectDir, "overview.md");
  let summary = "";
  if (existsSync(overviewPath)) {
    const raw = await readFile(overviewPath, "utf-8");
    const content = extractOverviewContent(raw);
    if (content) {
      summary = pickFirstProseParagraph(content);
    }
  }

  // --- Plans ---
  const planIndex = await readPlanIndex(projectDir);
  const activePlans = full
    ? planIndex.plans
    : planIndex.plans.filter((p) => p.status !== "done" && p.status !== "archived");

  // --- Tasks ---
  const allTasks = await listTasks(projectDir);
  const openTasks = full
    ? allTasks
    : allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

  // --- Knowledge (top 5 by recency, filtered by audience) ---
  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  const filtered = knowledgeIndex.entries.filter(
    (e) => !e.audience || e.audience === audience || e.audience === "universal",
  );
  // Sort by updatedAt descending
  filtered.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const topKnowledge = filtered
    .slice(0, 5)
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind }));

  const operatingBrief = deriveOperatingBrief({
    tasks: allTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      planId: t.planId,
      priority: t.priority,
    })),
    plans: planIndex.plans.map((p) => ({ id: p.id, title: p.title, status: p.status })),
  });

  // Top open tasks (up to 7) for markdown rendering
  const topOpenTasks = openTasks
    .slice(0, 7)
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));

  const activePlanTitles = activePlans.map((p) => p.title);

  const data = {
    slug,
    name,
    summary,
    operatingBrief,
    activePlansCount: activePlans.length,
    activePlanTitles,
    openTasksCount: openTasks.length,
    topOpenTasks,
    topKnowledge,
  };

  if (!flags.json) {
    return success(renderBrief(data));
  }
  return success(data);
}

// ---------------------------------------------------------------------------
// Summary extraction
// ---------------------------------------------------------------------------

/**
 * Walk paragraphs and return the first one that's actual prose (not a heading,
 * not a list, not a code fence). Truncates to 200 chars to keep the brief tight.
 *
 * Rationale: the SPOC project's own overview.md opens with `## Summary` which
 * is a heading — taking the first paragraph naively rendered the heading text
 * verbatim. By skipping until we find prose, we always emit a real description.
 */
function pickFirstProseParagraph(content: string): string {
  const paragraphs = content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const para of paragraphs) {
    // Skip headings, fenced code blocks, list-only blocks, and blockquotes
    if (para.startsWith("#")) continue;
    if (para.startsWith("```")) continue;
    if (para.startsWith(">")) continue;
    // Skip blocks that are entirely list items (every line starts with - or *)
    const allLines = para
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (allLines.length > 0 && allLines.every((l) => /^[-*]\s/.test(l))) continue;
    return para.length > 200 ? para.slice(0, 200) : para;
  }
  // Fallback: nothing prose-like found, take the first non-empty paragraph as-is
  const fallback = paragraphs[0] ?? "";
  return fallback.length > 200 ? fallback.slice(0, 200) : fallback;
}

// ---------------------------------------------------------------------------
// Project resolution — reuses same logic as handleContext
// ---------------------------------------------------------------------------

type ResolveSuccess = { ok: true; slug: string; name: string; projectDir: string };
type ResolveFailure = { ok: false; result: CLIResult };

async function resolveProject(
  rawArg: string | undefined,
): Promise<ResolveSuccess | ResolveFailure> {
  let queryPath: string;
  if (!rawArg) {
    queryPath = process.cwd();
  } else if (rawArg.startsWith("/")) {
    queryPath = rawArg;
  } else if (!rawArg.includes("/") && !rawArg.includes(".")) {
    // Slug resolution
    const dataDir = getDataDir();
    const projMetaPath = resolve(dataDir, "projects", rawArg, "meta.json");
    if (!existsSync(projMetaPath)) {
      return {
        ok: false,
        result: failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${rawArg}" not found in SPOC`),
      };
    }
    try {
      const projMeta = JSON.parse(readFileSync(projMetaPath, "utf-8"));
      const paths: string[] = Array.isArray(projMeta.workspacePaths) ? projMeta.workspacePaths : [];
      if (paths.length === 0) {
        return {
          ok: false,
          result: failure(
            "no_workspace_paths",
            `Project "${rawArg}" has no workspace paths configured`,
          ),
        };
      }
      const first = paths[0];
      queryPath = first.startsWith("~") ? resolve(homedir(), first.slice(2)) : resolve(first);
    } catch {
      return {
        ok: false,
        result: failure("read_error", `Could not read project metadata for "${rawArg}"`),
      };
    }
  } else {
    queryPath = resolve(rawArg);
    if (!existsSync(queryPath)) {
      return { ok: false, result: failure("path_not_found", `Path "${rawArg}" does not exist.`) };
    }
  }

  const dataDir = getDataDir();
  let rootMeta: RootMeta;
  try {
    rootMeta = await readRootMeta(dataDir);
  } catch {
    return { ok: false, result: failure("read_error", "Could not read SPOC data directory") };
  }

  type PM = { id: string; name: string; workspacePaths: string[] };
  const workspaceProjects: WorkspaceProject[] = [];
  const projectMetas = new Map<string, PM>();

  for (const node of rootMeta.projects) {
    const metaPath = resolve(dataDir, "projects", node.id, "meta.json");
    if (!existsSync(metaPath)) continue;
    const raw = await readJsonSafe<unknown>(metaPath);
    if (raw === undefined) continue;
    const meta = validateJson(raw, projectMetaSchema, metaPath) as PM;
    const paths = Array.isArray(meta.workspacePaths) ? meta.workspacePaths : [];
    if (paths.length > 0) {
      workspaceProjects.push({ slug: node.id, workspacePaths: paths });
      projectMetas.set(node.id, meta);
    }
  }

  const matchResult = findBestMatch(queryPath, workspaceProjects);
  if (matchResult.kind === "none") {
    return {
      ok: false,
      result: failure("no_match", `No project found matching path "${queryPath}"`),
    };
  }
  if (matchResult.kind === "ambiguous") {
    return { ok: false, result: failure("ambiguous_match", `Ambiguous match for "${queryPath}"`) };
  }

  const slug = matchResult.slug;
  const meta = projectMetas.get(slug);
  return { ok: true, slug, name: meta?.name ?? slug, projectDir: getProjectDir(slug) };
}
