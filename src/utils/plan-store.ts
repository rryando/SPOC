/**
 * Plan CRUD storage for ARCS projects.
 *
 * Provides create, update, delete, and index-read operations for plans,
 * with automatic index maintenance and rebuild-on-read resilience.
 */

import { readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { invalidateGraphCache } from "../retrieval/graph-invalidate.js";
import {
  indexRebuildFailed,
  invalidFileFormat,
  itemNotFound,
  normalizedIdCollision,
} from "./errors.js";
import { withLock } from "./file-lock.js";
import { readJsonSafe } from "./json.js";
import { planMetaSchema } from "./json-schemas.js";
import { normalizeIdentifier } from "./slug.js";
import {
  buildBody,
  ensureDir,
  fileExists,
  nowISO,
  rewriteH1,
  sanitizeFileRefs,
  sanitizeKeywords,
  validatePlanStatus,
  writeJson,
} from "./storage-utils.js";

// ---------------------------------------------------------------------------
// Re-export types used by consumers
// ---------------------------------------------------------------------------

export type { FileRef, PlanStatus } from "./storage-utils.js";
export { PLAN_STATUSES } from "./storage-utils.js";

// ---------------------------------------------------------------------------
// Meta types
// ---------------------------------------------------------------------------

export interface PlanMeta {
  id: string;
  normalizedId: string;
  title: string;
  status: import("./storage-utils.js").PlanStatus;
  keywords: string[];
  summary: string;
  sourceFiles?: import("./storage-utils.js").FileRef[];
  file: string;
  createdAt: string;
  updatedAt: string;
}

interface PlanIndex {
  plans: PlanMeta[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  id: string;
  title: string;
  status: import("./storage-utils.js").PlanStatus;
  keywords: string[];
  summary?: string;
  content?: string;
  sourceFiles?: import("./storage-utils.js").FileRef[];
  now?: string;
}

export interface UpdatePlanInput {
  id: string;
  status?: import("./storage-utils.js").PlanStatus;
  title?: string;
  summary?: string;
  keywords?: string[];
  sourceFiles?: import("./storage-utils.js").FileRef[];
  now?: string;
}

// ---------------------------------------------------------------------------
// Index helpers
// ---------------------------------------------------------------------------

async function rebuildPlanIndex(plansDir: string): Promise<PlanIndex> {
  const files = (await readdir(plansDir)).filter((f) => f.endsWith(".meta.json"));
  const plans: PlanMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const filePath = join(plansDir, file);
      const raw = await readJsonSafe<unknown>(filePath);
      if (raw === undefined) {
        errors.push(file);
        continue;
      }
      const result = planMetaSchema.safeParse(raw);
      if (!result.success) {
        throw invalidFileFormat(
          filePath,
          result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
        );
      }
      plans.push(result.data as PlanMeta);
    } catch (e) {
      if (e instanceof Error && e.name === "DagError") throw e;
      errors.push(file);
    }
  }

  if (errors.length > 0) {
    throw indexRebuildFailed("plans", `corrupt meta files: ${errors.join(", ")}`);
  }

  const index: PlanIndex = { plans };
  await writeJson(join(plansDir, "index.json"), index);
  return index;
}

async function isPlanIndexStale(plansDir: string, index: PlanIndex): Promise<boolean> {
  const metaFiles = (await readdir(plansDir)).filter((f) => f.endsWith(".meta.json"));
  if (metaFiles.length !== index.plans.length) return true;

  for (const entry of index.plans) {
    const metaPath = join(plansDir, `${entry.normalizedId}.meta.json`);
    const diskMeta = await readJsonSafe<PlanMeta>(metaPath);
    if (!diskMeta || diskMeta.updatedAt !== entry.updatedAt) {
      return true;
    }
  }
  return false;
}

async function writePlanIndex(plansDir: string, index: PlanIndex): Promise<void> {
  const indexPath = join(plansDir, "index.json");
  await withLock(indexPath, async () => {
    await writeJson(indexPath, index);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createPlan(projectDir: string, input: CreatePlanInput): Promise<PlanMeta> {
  validatePlanStatus(input.status);
  const keywords = sanitizeKeywords(input.keywords);
  const sourceFiles = input.sourceFiles ? sanitizeFileRefs(input.sourceFiles) : undefined;
  const normalizedId = normalizeIdentifier(input.id);

  const plansDir = join(projectDir, "plans");
  await ensureDir(plansDir);

  const metaPath = join(plansDir, `${normalizedId}.meta.json`);
  if (await fileExists(metaPath)) {
    throw normalizedIdCollision("plan", input.id, normalizedId);
  }

  const ts = nowISO(input.now);
  const bodyFile = join("plans", `${normalizedId}.md`);

  const meta: PlanMeta = {
    id: normalizedId,
    normalizedId,
    title: input.title,
    status: input.status,
    keywords,
    summary: input.summary ?? "",
    ...(sourceFiles && { sourceFiles }),
    file: bodyFile,
    createdAt: ts,
    updatedAt: ts,
  };

  await writeJson(metaPath, meta);
  await writeFile(join(projectDir, bodyFile), buildBody(input.title, input.content), "utf-8");

  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? { plans: [] };
  index.plans.push(meta);
  await writePlanIndex(plansDir, index);

  invalidateGraphCache(basename(projectDir));
  return meta;
}

export async function updatePlan(projectDir: string, input: UpdatePlanInput): Promise<PlanMeta> {
  if (input.status !== undefined) {
    validatePlanStatus(input.status);
  }

  const normalizedId = normalizeIdentifier(input.id);
  const plansDir = join(projectDir, "plans");
  const metaPath = join(plansDir, `${normalizedId}.meta.json`);

  const meta = await readJsonSafe<PlanMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("plan", input.id);
  }

  const ts = nowISO(input.now);

  if (input.status !== undefined) meta.status = input.status;
  if (input.title !== undefined && input.title !== meta.title) {
    const bodyPath = join(projectDir, meta.file);
    await rewriteH1(bodyPath, input.title);
    meta.title = input.title;
  }
  if (input.summary !== undefined) meta.summary = input.summary;
  if (input.keywords !== undefined) meta.keywords = sanitizeKeywords(input.keywords);
  if (input.sourceFiles !== undefined) {
    if (input.sourceFiles.length === 0) {
      delete meta.sourceFiles;
    } else {
      meta.sourceFiles = sanitizeFileRefs(input.sourceFiles);
    }
  }
  meta.updatedAt = ts;

  await writeJson(metaPath, meta);

  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? { plans: [] };
  const idx = index.plans.findIndex((p) => p.normalizedId === normalizedId);
  if (idx >= 0) {
    index.plans[idx] = meta;
  } else {
    index.plans.push(meta);
  }
  await writePlanIndex(plansDir, index);

  invalidateGraphCache(basename(projectDir));
  return meta;
}

export async function deletePlan(projectDir: string, id: string): Promise<void> {
  const normalizedId = normalizeIdentifier(id);
  const plansDir = join(projectDir, "plans");
  const metaPath = join(plansDir, `${normalizedId}.meta.json`);

  const meta = await readJsonSafe<PlanMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("plan", id);
  }

  const { unlink } = await import("node:fs/promises");
  const bodyPath = join(projectDir, meta.file);
  await unlink(metaPath);
  if (await fileExists(bodyPath)) {
    await unlink(bodyPath);
  }

  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? { plans: [] };
  index.plans = index.plans.filter((p) => p.normalizedId !== normalizedId);
  await writePlanIndex(plansDir, index);
}

export async function readPlanIndex(projectDir: string): Promise<{ plans: PlanMeta[] }> {
  const plansDir = join(projectDir, "plans");

  if (!(await fileExists(plansDir))) {
    return { plans: [] };
  }

  const indexPath = join(plansDir, "index.json");
  const index = await readJsonSafe<PlanIndex>(indexPath);

  if (!index || !Array.isArray(index.plans)) {
    return rebuildPlanIndex(plansDir);
  }

  if (await isPlanIndexStale(plansDir, index)) {
    return rebuildPlanIndex(plansDir);
  }

  return index;
}
