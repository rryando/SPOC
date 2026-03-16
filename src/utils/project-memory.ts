/**
 * Structured plan and knowledge entry management for cc-dag projects.
 *
 * Provides CRUD operations with flat-file storage, automatic index
 * maintenance, and rebuild-on-read resilience.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { normalizeIdentifier } from "./slug.js";
import {
  indexRebuildFailed,
  invalidKeyword,
  invalidKnowledgeKind,
  invalidPlanStatus,
  normalizedIdCollision,
  itemNotFound,
} from "./errors.js";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const PLAN_STATUSES = [
  "proposed",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "archived",
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const KNOWLEDGE_KINDS = [
  "lesson",
  "gotcha",
  "pattern",
  "architecture",
  "module",
  "feature",
  "reference",
] as const;

export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

// ---------------------------------------------------------------------------
// Meta types
// ---------------------------------------------------------------------------

export interface PlanMeta {
  id: string;
  normalizedId: string;
  title: string;
  status: PlanStatus;
  keywords: string[];
  summary: string;
  file: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMeta {
  id: string;
  normalizedId: string;
  title: string;
  kind: KnowledgeKind;
  keywords: string[];
  summary: string;
  file: string;
  createdAt: string;
  updatedAt: string;
}

interface PlanIndex {
  plans: PlanMeta[];
}

interface KnowledgeIndex {
  entries: KnowledgeMeta[];
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreatePlanInput {
  id: string;
  title: string;
  status: PlanStatus;
  keywords: string[];
  summary?: string;
  content?: string;
  now?: string;
}

export interface UpdatePlanInput {
  id: string;
  status?: PlanStatus;
  title?: string;
  summary?: string;
  keywords?: string[];
  now?: string;
}

export interface CreateKnowledgeInput {
  id: string;
  title: string;
  kind: KnowledgeKind;
  keywords: string[];
  summary?: string;
  content?: string;
  now?: string;
}

export interface UpdateKnowledgeInput {
  id: string;
  title?: string;
  kind?: KnowledgeKind;
  summary?: string;
  keywords?: string[];
  now?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validatePlanStatus(status: string): asserts status is PlanStatus {
  if (!(PLAN_STATUSES as readonly string[]).includes(status)) {
    throw invalidPlanStatus(status);
  }
}

function validateKnowledgeKind(kind: string): asserts kind is KnowledgeKind {
  if (!(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
    throw invalidKnowledgeKind(kind);
  }
}

/** A valid keyword is a non-empty, lowercase, alpha-numeric-or-dash string. */
function sanitizeKeywords(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kw of raw) {
    const trimmed = kw.trim().toLowerCase();
    // Reject empty/blank or anything that normalizes to nothing useful
    if (!trimmed || !/[a-z0-9]/.test(trimmed)) {
      throw invalidKeyword(kw);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function readJsonSafe<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function nowISO(override?: string): string {
  return override ?? new Date().toISOString();
}

// ---------------------------------------------------------------------------
// H1 rewrite
// ---------------------------------------------------------------------------

/**
 * Build body markdown. If `content` is supplied and already starts with
 * a matching H1, use as-is. Otherwise, prepend `# title\n\n`.
 */
function buildBody(title: string, content?: string): string {
  if (content !== undefined) {
    // If content starts with the correct H1, keep it
    if (content.startsWith(`# ${title}`)) {
      return content;
    }
    // If it starts with a different H1, replace it
    if (content.startsWith("# ")) {
      const rest = content.slice(content.indexOf("\n"));
      return `# ${title}${rest}`;
    }
    return `# ${title}\n\n${content}`;
  }
  return `# ${title}\n\n`;
}

/**
 * Rewrite the leading H1 in an existing body file.
 */
function rewriteH1(filePath: string, newTitle: string): void {
  const body = readFileSync(filePath, "utf-8");
  if (body.startsWith("# ")) {
    const rest = body.slice(body.indexOf("\n"));
    writeFileSync(filePath, `# ${newTitle}${rest}`, "utf-8");
  } else {
    writeFileSync(filePath, `# ${newTitle}\n\n${body}`, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Index maintenance
// ---------------------------------------------------------------------------

function rebuildPlanIndex(plansDir: string): PlanIndex {
  const files = readdirSync(plansDir).filter((f) => f.endsWith(".meta.json"));
  const plans: PlanMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const meta = JSON.parse(
        readFileSync(join(plansDir, file), "utf-8")
      ) as PlanMeta;
      plans.push(meta);
    } catch {
      errors.push(file);
    }
  }

  if (errors.length > 0) {
    throw indexRebuildFailed("plans", `corrupt meta files: ${errors.join(", ")}`);
  }

  const index: PlanIndex = { plans };
  writeJson(join(plansDir, "index.json"), index);
  return index;
}

function rebuildKnowledgeIndex(knowledgeDir: string): KnowledgeIndex {
  const files = readdirSync(knowledgeDir).filter((f) =>
    f.endsWith(".meta.json")
  );
  const entries: KnowledgeMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const meta = JSON.parse(
        readFileSync(join(knowledgeDir, file), "utf-8")
      ) as KnowledgeMeta;
      entries.push(meta);
    } catch {
      errors.push(file);
    }
  }

  if (errors.length > 0) {
    throw indexRebuildFailed(
      "knowledge",
      `corrupt meta files: ${errors.join(", ")}`
    );
  }

  const index: KnowledgeIndex = { entries };
  writeJson(join(knowledgeDir, "index.json"), index);
  return index;
}

/**
 * Detect staleness: compare index entries against the on-disk meta files.
 * Returns true if any meta file updatedAt differs from its index entry.
 */
function isPlanIndexStale(plansDir: string, index: PlanIndex): boolean {
  // Check for orphaned meta files not yet in the index
  const metaFiles = readdirSync(plansDir).filter((f) => f.endsWith(".meta.json"));
  if (metaFiles.length !== index.plans.length) return true;

  for (const entry of index.plans) {
    const metaPath = join(plansDir, `${entry.normalizedId}.meta.json`);
    const diskMeta = readJsonSafe<PlanMeta>(metaPath);
    if (!diskMeta || diskMeta.updatedAt !== entry.updatedAt) {
      return true;
    }
  }
  return false;
}

function isKnowledgeIndexStale(
  knowledgeDir: string,
  index: KnowledgeIndex
): boolean {
  // Check for orphaned meta files not yet in the index
  const metaFiles = readdirSync(knowledgeDir).filter((f) => f.endsWith(".meta.json"));
  if (metaFiles.length !== index.entries.length) return true;

  for (const entry of index.entries) {
    const metaPath = join(knowledgeDir, `${entry.normalizedId}.meta.json`);
    const diskMeta = readJsonSafe<KnowledgeMeta>(metaPath);
    if (!diskMeta || diskMeta.updatedAt !== entry.updatedAt) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Index writers (sync index.json after individual create/update)
// ---------------------------------------------------------------------------

function writePlanIndex(plansDir: string, index: PlanIndex): void {
  writeJson(join(plansDir, "index.json"), index);
}

function writeKnowledgeIndex(
  knowledgeDir: string,
  index: KnowledgeIndex
): void {
  writeJson(join(knowledgeDir, "index.json"), index);
}

// ---------------------------------------------------------------------------
// Public API — Plans
// ---------------------------------------------------------------------------

export function createPlan(projectDir: string, input: CreatePlanInput): PlanMeta {
  validatePlanStatus(input.status);
  const keywords = sanitizeKeywords(input.keywords);
  const normalizedId = normalizeIdentifier(input.id);

  const plansDir = join(projectDir, "plans");
  ensureDir(plansDir);

  // Check collision
  const metaPath = join(plansDir, `${normalizedId}.meta.json`);
  if (existsSync(metaPath)) {
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
    file: bodyFile,
    createdAt: ts,
    updatedAt: ts,
  };

  // Write meta + body
  writeJson(metaPath, meta);
  writeFileSync(
    join(projectDir, bodyFile),
    buildBody(input.title, input.content),
    "utf-8"
  );

  // Update index
  const index = readJsonSafe<PlanIndex>(join(plansDir, "index.json")) ?? {
    plans: [],
  };
  index.plans.push(meta);
  writePlanIndex(plansDir, index);

  return meta;
}

export function updatePlan(projectDir: string, input: UpdatePlanInput): PlanMeta {
  if (input.status !== undefined) {
    validatePlanStatus(input.status);
  }

  const normalizedId = normalizeIdentifier(input.id);
  const plansDir = join(projectDir, "plans");
  const metaPath = join(plansDir, `${normalizedId}.meta.json`);

  const meta = readJsonSafe<PlanMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("plan", input.id);
  }

  const ts = nowISO(input.now);

  if (input.status !== undefined) meta.status = input.status;
  if (input.title !== undefined && input.title !== meta.title) {
    const bodyPath = join(projectDir, meta.file);
    rewriteH1(bodyPath, input.title);
    meta.title = input.title;
  }
  if (input.summary !== undefined) meta.summary = input.summary;
  if (input.keywords !== undefined) meta.keywords = sanitizeKeywords(input.keywords);
  meta.updatedAt = ts;

  writeJson(metaPath, meta);

  // Sync index
  const index = readJsonSafe<PlanIndex>(join(plansDir, "index.json")) ?? {
    plans: [],
  };
  const idx = index.plans.findIndex((p) => p.normalizedId === normalizedId);
  if (idx >= 0) {
    index.plans[idx] = meta;
  } else {
    index.plans.push(meta);
  }
  writePlanIndex(plansDir, index);

  return meta;
}

export function readPlanIndex(projectDir: string): PlanIndex {
  const plansDir = join(projectDir, "plans");

  if (!existsSync(plansDir)) {
    return { plans: [] };
  }

  const indexPath = join(plansDir, "index.json");
  const index = readJsonSafe<PlanIndex>(indexPath);

  // Missing or corrupted → rebuild
  if (!index || !Array.isArray(index.plans)) {
    return rebuildPlanIndex(plansDir);
  }

  // Stale → rebuild
  if (isPlanIndexStale(plansDir, index)) {
    return rebuildPlanIndex(plansDir);
  }

  return index;
}

// ---------------------------------------------------------------------------
// Public API — Knowledge
// ---------------------------------------------------------------------------

export function createKnowledgeEntry(
  projectDir: string,
  input: CreateKnowledgeInput
): KnowledgeMeta {
  validateKnowledgeKind(input.kind);
  const keywords = sanitizeKeywords(input.keywords);
  const normalizedId = normalizeIdentifier(input.id);

  const knowledgeDir = join(projectDir, "knowledge");
  ensureDir(knowledgeDir);

  // Check collision
  const metaPath = join(knowledgeDir, `${normalizedId}.meta.json`);
  if (existsSync(metaPath)) {
    throw normalizedIdCollision("knowledge entry", input.id, normalizedId);
  }

  const ts = nowISO(input.now);
  const bodyFile = join("knowledge", `${normalizedId}.md`);

  const meta: KnowledgeMeta = {
    id: normalizedId,
    normalizedId,
    title: input.title,
    kind: input.kind,
    keywords,
    summary: input.summary ?? "",
    file: bodyFile,
    createdAt: ts,
    updatedAt: ts,
  };

  writeJson(metaPath, meta);
  writeFileSync(
    join(projectDir, bodyFile),
    buildBody(input.title, input.content),
    "utf-8"
  );

  // Update index
  const index = readJsonSafe<KnowledgeIndex>(
    join(knowledgeDir, "index.json")
  ) ?? { entries: [] };
  index.entries.push(meta);
  writeKnowledgeIndex(knowledgeDir, index);

  return meta;
}

export function updateKnowledgeEntry(
  projectDir: string,
  input: UpdateKnowledgeInput
): KnowledgeMeta {
  if (input.kind !== undefined) {
    validateKnowledgeKind(input.kind);
  }

  const normalizedId = normalizeIdentifier(input.id);
  const knowledgeDir = join(projectDir, "knowledge");
  const metaPath = join(knowledgeDir, `${normalizedId}.meta.json`);

  const meta = readJsonSafe<KnowledgeMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("knowledge entry", input.id);
  }

  if (input.kind !== undefined) meta.kind = input.kind;
  if (input.title !== undefined && input.title !== meta.title) {
    const bodyPath = join(projectDir, meta.file);
    rewriteH1(bodyPath, input.title);
    meta.title = input.title;
  }
  if (input.summary !== undefined) meta.summary = input.summary;
  if (input.keywords !== undefined) meta.keywords = sanitizeKeywords(input.keywords);
  meta.updatedAt = nowISO(input.now);

  writeJson(metaPath, meta);

  // Sync index
  const index = readJsonSafe<KnowledgeIndex>(
    join(knowledgeDir, "index.json")
  ) ?? { entries: [] };
  const idx = index.entries.findIndex(
    (e) => e.normalizedId === normalizedId
  );
  if (idx >= 0) {
    index.entries[idx] = meta;
  } else {
    index.entries.push(meta);
  }
  writeKnowledgeIndex(knowledgeDir, index);

  return meta;
}

export function readKnowledgeIndex(projectDir: string): KnowledgeIndex {
  const knowledgeDir = join(projectDir, "knowledge");

  if (!existsSync(knowledgeDir)) {
    return { entries: [] };
  }

  const indexPath = join(knowledgeDir, "index.json");
  const index = readJsonSafe<KnowledgeIndex>(indexPath);

  if (!index || !Array.isArray(index.entries)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }

  if (isKnowledgeIndexStale(knowledgeDir, index)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }

  return index;
}
