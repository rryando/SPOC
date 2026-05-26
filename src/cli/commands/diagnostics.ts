// ---------------------------------------------------------------------------
// Diagnostic commands — audit, diff (registry-based)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getProjectDir } from "../../utils/paths.js";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { projectMetaSchema } from "../../utils/json-schemas.js";
import {
  listTasks,
  readKnowledgeIndex,
  readPlanIndex,
} from "../../utils/project-memory.js";

// ---------------------------------------------------------------------------
// audit
// ---------------------------------------------------------------------------

defineCommand({
  path: "audit",
  description: "Run a structural audit of a project (stale sourceFile references)",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
  },
  handler: async (params) => {
    const slug = params.slug as string;
    const projectDir = getProjectDir(slug);

    if (!existsSync(projectDir)) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const metaPath = resolve(projectDir, "meta.json");
    const rawMeta = await readJsonSafe<unknown>(metaPath);
    if (rawMeta === undefined) {
      return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Failed to read project meta at ${metaPath}`);
    }

    const projectMeta = validateJson(rawMeta, projectMetaSchema, metaPath);
    const workspacePaths = (projectMeta as { workspacePaths?: string[] }).workspacePaths ?? [];

    const index = await readKnowledgeIndex(projectDir);
    const entries = index.entries;

    let totalSourceFiles = 0;
    let staleCount = 0;
    const staleEntries: {
      entryId: string;
      entryTitle: string;
      staleFiles: { path: string; anchor?: string }[];
    }[] = [];

    for (const entry of entries) {
      const sourceFiles = entry.sourceFiles ?? [];
      const staleFiles: { path: string; anchor?: string }[] = [];

      for (const ref of sourceFiles) {
        totalSourceFiles++;
        const found = workspacePaths.some((ws: string) => existsSync(resolve(ws, ref.path)));
        if (!found) {
          staleCount++;
          const stale: { path: string; anchor?: string } = { path: ref.path };
          if (ref.anchor) stale.anchor = ref.anchor;
          staleFiles.push(stale);
        }
      }

      if (staleFiles.length > 0) {
        staleEntries.push({
          entryId: entry.id,
          entryTitle: entry.title,
          staleFiles,
        });
      }
    }

    return success({
      staleEntries,
      counts: {
        totalEntries: entries.length,
        totalSourceFiles,
        staleCount,
      },
    });
  },
});

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

defineCommand({
  path: "diff",
  description: "Show what changed in a project since a given timestamp",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    since: { type: "string", required: true, description: "ISO timestamp to diff from" },
  },
  handler: async (params) => {
    const slug = params.slug as string;
    const sinceIso = params.since as string;

    const sinceMs = new Date(sinceIso).getTime();
    if (!Number.isFinite(sinceMs)) {
      return failure(ERROR_CODES.INVALID_TYPE, `Invalid ISO timestamp "${sinceIso}"`);
    }

    const projectDir = getProjectDir(slug);
    if (!existsSync(projectDir)) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const [planIndex, knowledgeIndex, tasks] = await Promise.all([
      readPlanIndex(projectDir),
      readKnowledgeIndex(projectDir),
      listTasks(projectDir),
    ]);

    const effectiveTs = (item: { updatedAt: string; createdAt: string }) =>
      item.updatedAt || item.createdAt;

    const isAfter = (item: { updatedAt: string; createdAt: string }) =>
      new Date(effectiveTs(item)).getTime() > sinceMs;

    const plans = planIndex.plans
      .filter(isAfter)
      .map((p) => ({ planId: p.id, title: p.title, status: p.status, updatedAt: effectiveTs(p) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const knowledge = knowledgeIndex.entries
      .filter(isAfter)
      .map((e) => ({ entryId: e.id, title: e.title, kind: e.kind, updatedAt: effectiveTs(e) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    const taskResults = tasks
      .filter(isAfter)
      .map((t) => ({ taskId: t.id, title: t.title, status: t.status, updatedAt: effectiveTs(t) }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return success({
      since: sinceIso,
      plans,
      knowledge,
      tasks: taskResults,
      counts: {
        plans: plans.length,
        knowledge: knowledge.length,
        tasks: taskResults.length,
        total: plans.length + knowledge.length + taskResults.length,
      },
    });
  },
});
