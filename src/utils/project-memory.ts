/**
 * Structured plan and knowledge entry management for SPOC projects.
 *
 * Provides CRUD operations with flat-file storage, automatic index
 * maintenance, and rebuild-on-read resilience.
 */

import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  indexRebuildFailed,
  invalidFileRef,
  invalidKeyword,
  invalidKnowledgeKind,
  invalidPlanStatus,
  invalidTaskPriority,
  invalidTaskStatus,
  itemNotFound,
  normalizedIdCollision,
} from "./errors.js";
import { withLock } from "./file-lock.js";
import { normalizeIdentifier } from "./slug.js";

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
// FileRef type
// ---------------------------------------------------------------------------

export interface FileRef {
  path: string;
  anchor?: string;
}

/**
 * Validates and normalizes an array of FileRef objects.
 * - path: backslashes normalized to forward slashes first, then validated.
 *   Must be relative (no leading /), no .., no empty, no #, comma, or colon.
 * - anchor: if provided, must be non-empty/non-whitespace, no # or comma.
 * Returns a new array with normalized paths. Throws on invalid input.
 */
export function sanitizeFileRefs(refs: FileRef[]): FileRef[] {
  return refs.map((ref) => {
    // Normalize backslashes to forward slashes first (Windows path compat)
    const path = ref.path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!path || !path.trim()) {
      throw invalidFileRef("path must not be empty");
    }
    if (path.startsWith("/")) {
      throw invalidFileRef(`path must be relative, got "${path}"`);
    }
    if (/(^|\/)\.\.($|\/)/.test(path)) {
      throw invalidFileRef(`path must not contain ".." segments, got "${path}"`);
    }
    // Note: backslash already normalized above, so only check #, comma, colon
    if (/[#,:]/.test(path)) {
      throw invalidFileRef(`path must not contain #, comma, or colon, got "${path}"`);
    }
    const result: FileRef = { path };
    if (ref.anchor !== undefined) {
      if (!ref.anchor || !ref.anchor.trim()) {
        throw invalidFileRef("anchor must not be empty or whitespace-only");
      }
      if (/[#,]/.test(ref.anchor)) {
        throw invalidFileRef(`anchor must not contain # or comma, got "${ref.anchor}"`);
      }
      result.anchor = ref.anchor;
    }
    return result;
  });
}

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

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
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
async function rewriteH1(filePath: string, newTitle: string): Promise<void> {
  const body = await readFile(filePath, "utf-8");
  if (body.startsWith("# ")) {
    const rest = body.slice(body.indexOf("\n"));
    await writeFile(filePath, `# ${newTitle}${rest}`, "utf-8");
  } else {
    await writeFile(filePath, `# ${newTitle}\n\n${body}`, "utf-8");
  }
}

// ---------------------------------------------------------------------------
// Index maintenance
// ---------------------------------------------------------------------------

async function rebuildPlanIndex(plansDir: string): Promise<PlanIndex> {
  const files = (await readdir(plansDir)).filter((f) => f.endsWith(".meta.json"));
  const plans: PlanMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const meta = JSON.parse(await readFile(join(plansDir, file), "utf-8")) as PlanMeta;
      plans.push(meta);
    } catch {
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

async function rebuildKnowledgeIndex(knowledgeDir: string): Promise<KnowledgeIndex> {
  const files = (await readdir(knowledgeDir)).filter((f) => f.endsWith(".meta.json"));
  const entries: KnowledgeMeta[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const meta = JSON.parse(await readFile(join(knowledgeDir, file), "utf-8")) as KnowledgeMeta;
      entries.push(meta);
    } catch {
      errors.push(file);
    }
  }

  if (errors.length > 0) {
    throw indexRebuildFailed("knowledge", `corrupt meta files: ${errors.join(", ")}`);
  }

  const index: KnowledgeIndex = { entries };
  await writeJson(join(knowledgeDir, "index.json"), index);
  return index;
}

/**
 * Detect staleness: compare index entries against the on-disk meta files.
 * Returns true if any meta file updatedAt differs from its index entry.
 */
async function isPlanIndexStale(plansDir: string, index: PlanIndex): Promise<boolean> {
  // Check for orphaned meta files not yet in the index
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

async function isKnowledgeIndexStale(
  knowledgeDir: string,
  index: KnowledgeIndex,
): Promise<boolean> {
  // Check for orphaned meta files not yet in the index
  const metaFiles = (await readdir(knowledgeDir)).filter((f) => f.endsWith(".meta.json"));
  if (metaFiles.length !== index.entries.length) return true;

  for (const entry of index.entries) {
    const metaPath = join(knowledgeDir, `${entry.normalizedId}.meta.json`);
    const diskMeta = await readJsonSafe<KnowledgeMeta>(metaPath);
    if (!diskMeta || diskMeta.updatedAt !== entry.updatedAt) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Index writers (sync index.json after individual create/update)
// ---------------------------------------------------------------------------

async function writePlanIndex(plansDir: string, index: PlanIndex): Promise<void> {
  const indexPath = join(plansDir, "index.json");
  await withLock(indexPath, async () => {
    await writeJson(indexPath, index);
  });
}

async function writeKnowledgeIndex(knowledgeDir: string, index: KnowledgeIndex): Promise<void> {
  const indexPath = join(knowledgeDir, "index.json");
  await withLock(indexPath, async () => {
    await writeJson(indexPath, index);
  });
}

// ---------------------------------------------------------------------------
// Public API — Plans
// ---------------------------------------------------------------------------

export async function createPlan(projectDir: string, input: CreatePlanInput): Promise<PlanMeta> {
  validatePlanStatus(input.status);
  const keywords = sanitizeKeywords(input.keywords);
  const normalizedId = normalizeIdentifier(input.id);

  const plansDir = join(projectDir, "plans");
  await ensureDir(plansDir);

  // Check collision
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
    file: bodyFile,
    createdAt: ts,
    updatedAt: ts,
  };

  // Write meta + body
  await writeJson(metaPath, meta);
  await writeFile(join(projectDir, bodyFile), buildBody(input.title, input.content), "utf-8");

  // Update index
  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? {
    plans: [],
  };
  index.plans.push(meta);
  await writePlanIndex(plansDir, index);

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
  meta.updatedAt = ts;

  await writeJson(metaPath, meta);

  // Sync index
  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? {
    plans: [],
  };
  const idx = index.plans.findIndex((p) => p.normalizedId === normalizedId);
  if (idx >= 0) {
    index.plans[idx] = meta;
  } else {
    index.plans.push(meta);
  }
  await writePlanIndex(plansDir, index);

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

  // Delete meta and body files
  const bodyPath = join(projectDir, meta.file);
  await unlink(metaPath);
  if (await fileExists(bodyPath)) {
    await unlink(bodyPath);
  }

  // Update index
  const index = (await readJsonSafe<PlanIndex>(join(plansDir, "index.json"))) ?? { plans: [] };
  index.plans = index.plans.filter((p) => p.normalizedId !== normalizedId);
  await writePlanIndex(plansDir, index);
}

export async function readPlanIndex(projectDir: string): Promise<PlanIndex> {
  const plansDir = join(projectDir, "plans");

  if (!(await fileExists(plansDir))) {
    return { plans: [] };
  }

  const indexPath = join(plansDir, "index.json");
  const index = await readJsonSafe<PlanIndex>(indexPath);

  // Missing or corrupted → rebuild
  if (!index || !Array.isArray(index.plans)) {
    return rebuildPlanIndex(plansDir);
  }

  // Stale → rebuild
  if (await isPlanIndexStale(plansDir, index)) {
    return rebuildPlanIndex(plansDir);
  }

  return index;
}

// ---------------------------------------------------------------------------
// Public API — Knowledge
// ---------------------------------------------------------------------------

export async function createKnowledgeEntry(
  projectDir: string,
  input: CreateKnowledgeInput,
): Promise<KnowledgeMeta> {
  validateKnowledgeKind(input.kind);
  const keywords = sanitizeKeywords(input.keywords);
  const normalizedId = normalizeIdentifier(input.id);

  const knowledgeDir = join(projectDir, "knowledge");
  await ensureDir(knowledgeDir);

  // Check collision
  const metaPath = join(knowledgeDir, `${normalizedId}.meta.json`);
  if (await fileExists(metaPath)) {
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

  await writeJson(metaPath, meta);
  await writeFile(join(projectDir, bodyFile), buildBody(input.title, input.content), "utf-8");

  // Update index
  const index = (await readJsonSafe<KnowledgeIndex>(join(knowledgeDir, "index.json"))) ?? {
    entries: [],
  };
  index.entries.push(meta);
  await writeKnowledgeIndex(knowledgeDir, index);

  return meta;
}

export async function updateKnowledgeEntry(
  projectDir: string,
  input: UpdateKnowledgeInput,
): Promise<KnowledgeMeta> {
  if (input.kind !== undefined) {
    validateKnowledgeKind(input.kind);
  }

  const normalizedId = normalizeIdentifier(input.id);
  const knowledgeDir = join(projectDir, "knowledge");
  const metaPath = join(knowledgeDir, `${normalizedId}.meta.json`);

  const meta = await readJsonSafe<KnowledgeMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("knowledge entry", input.id);
  }

  if (input.kind !== undefined) meta.kind = input.kind;
  if (input.title !== undefined && input.title !== meta.title) {
    const bodyPath = join(projectDir, meta.file);
    await rewriteH1(bodyPath, input.title);
    meta.title = input.title;
  }
  if (input.summary !== undefined) meta.summary = input.summary;
  if (input.keywords !== undefined) meta.keywords = sanitizeKeywords(input.keywords);
  meta.updatedAt = nowISO(input.now);

  await writeJson(metaPath, meta);

  // Sync index
  const index = (await readJsonSafe<KnowledgeIndex>(join(knowledgeDir, "index.json"))) ?? {
    entries: [],
  };
  const idx = index.entries.findIndex((e) => e.normalizedId === normalizedId);
  if (idx >= 0) {
    index.entries[idx] = meta;
  } else {
    index.entries.push(meta);
  }
  await writeKnowledgeIndex(knowledgeDir, index);

  return meta;
}

export async function deleteKnowledgeEntry(projectDir: string, id: string): Promise<void> {
  const normalizedId = normalizeIdentifier(id);
  const knowledgeDir = join(projectDir, "knowledge");
  const metaPath = join(knowledgeDir, `${normalizedId}.meta.json`);

  const meta = await readJsonSafe<KnowledgeMeta>(metaPath);
  if (!meta) {
    throw itemNotFound("knowledge entry", id);
  }

  const bodyPath = join(projectDir, meta.file);
  await unlink(metaPath);
  if (await fileExists(bodyPath)) {
    await unlink(bodyPath);
  }

  const index = (await readJsonSafe<KnowledgeIndex>(join(knowledgeDir, "index.json"))) ?? {
    entries: [],
  };
  index.entries = index.entries.filter((e) => e.normalizedId !== normalizedId);
  await writeKnowledgeIndex(knowledgeDir, index);
}

export async function readKnowledgeIndex(projectDir: string): Promise<KnowledgeIndex> {
  const knowledgeDir = join(projectDir, "knowledge");

  if (!(await fileExists(knowledgeDir))) {
    return { entries: [] };
  }

  const indexPath = join(knowledgeDir, "index.json");
  const index = await readJsonSafe<KnowledgeIndex>(indexPath);

  if (!index || !Array.isArray(index.entries)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }

  if (await isKnowledgeIndexStale(knowledgeDir, index)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }

  return index;
}

// ---------------------------------------------------------------------------
// Enums — Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["backlog", "in_progress", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "medium", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

// ---------------------------------------------------------------------------
// Meta types — Tasks
// ---------------------------------------------------------------------------

export interface TaskMeta {
  id: string;
  normalizedId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  updatedAt: string;
}

interface TaskIndex {
  tasks: TaskMeta[];
}

// ---------------------------------------------------------------------------
// Input types — Tasks
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  now?: string;
}

export interface UpdateTaskInput {
  id: string;
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  now?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers — Tasks
// ---------------------------------------------------------------------------

function validateTaskStatus(status: string): asserts status is TaskStatus {
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    throw invalidTaskStatus(status);
  }
}

function validateTaskPriority(priority: string): asserts priority is TaskPriority {
  if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    throw invalidTaskPriority(priority);
  }
}

// ---------------------------------------------------------------------------
// Task index helpers
// ---------------------------------------------------------------------------

async function readTaskIndex(projectDir: string): Promise<TaskIndex> {
  const tasksDir = join(projectDir, "tasks");
  if (!(await fileExists(tasksDir))) {
    return { tasks: [] };
  }
  const indexPath = join(tasksDir, "index.json");
  const index = await readJsonSafe<TaskIndex>(indexPath);
  if (!index || !Array.isArray(index.tasks)) {
    return { tasks: [] };
  }
  return index;
}

async function writeTaskIndex(projectDir: string, index: TaskIndex): Promise<void> {
  const tasksDir = join(projectDir, "tasks");
  await ensureDir(tasksDir);
  const indexPath = join(tasksDir, "index.json");
  await withLock(indexPath, async () => {
    await writeJson(indexPath, index);
  });
}

// ---------------------------------------------------------------------------
// Render — Tasks
// ---------------------------------------------------------------------------

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

function sortByPriority(tasks: TaskMeta[]): TaskMeta[] {
  return [...tasks].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}

export async function renderTasksMd(projectDir: string, index: TaskIndex): Promise<void> {
  const metaPath = join(projectDir, "meta.json");
  const meta = await readJsonSafe<{ name?: string }>(metaPath);
  const name = meta?.name ?? "Unknown";

  const sections: string[] = [`# Tasks — ${name}\n`];

  const statusConfig: Array<{
    status: TaskStatus;
    heading: string;
    marker: string;
    showPriority: boolean;
  }> = [
    { status: "in_progress", heading: "In Progress", marker: "[/]", showPriority: true },
    { status: "backlog", heading: "Backlog", marker: "[ ]", showPriority: true },
    { status: "done", heading: "Done", marker: "[x]", showPriority: false },
    { status: "cancelled", heading: "Cancelled", marker: "[~]", showPriority: false },
  ];

  for (const { status, heading, marker, showPriority } of statusConfig) {
    const tasks = sortByPriority(index.tasks.filter((t) => t.status === status));
    if (tasks.length === 0) continue;

    sections.push(`## ${heading}`);
    for (const task of tasks) {
      const priorityTag = showPriority ? ` **[${task.priority}]**` : "";
      sections.push(`- ${marker}${priorityTag} ${task.title}`);
    }
    sections.push("");
  }

  await writeFile(join(projectDir, "tasks.md"), sections.join("\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// Public API — Tasks
// ---------------------------------------------------------------------------

export async function createTask(projectDir: string, input: CreateTaskInput): Promise<TaskMeta> {
  const status = input.status ?? "backlog";
  const priority = input.priority ?? "medium";
  validateTaskStatus(status);
  validateTaskPriority(priority);

  const normalizedId = normalizeIdentifier(input.title);
  const index = await readTaskIndex(projectDir);

  // Check collision
  if (index.tasks.some((t) => t.normalizedId === normalizedId)) {
    throw normalizedIdCollision("task", input.title, normalizedId);
  }

  const ts = nowISO(input.now);

  const meta: TaskMeta = {
    id: normalizedId,
    normalizedId,
    title: input.title,
    status,
    priority,
    createdAt: ts,
    updatedAt: ts,
  };

  index.tasks.push(meta);
  await writeTaskIndex(projectDir, index);
  await renderTasksMd(projectDir, index);

  return meta;
}

export async function listTasks(
  projectDir: string,
  filters?: { status?: TaskStatus; priority?: TaskPriority },
): Promise<TaskMeta[]> {
  const index = await readTaskIndex(projectDir);
  let tasks = index.tasks;

  if (filters?.status) {
    tasks = tasks.filter((t) => t.status === filters.status);
  }
  if (filters?.priority) {
    tasks = tasks.filter((t) => t.priority === filters.priority);
  }

  return tasks;
}

export async function getTask(projectDir: string, taskId: string): Promise<TaskMeta> {
  const normalizedId = normalizeIdentifier(taskId);
  const index = await readTaskIndex(projectDir);
  const task = index.tasks.find((t) => t.normalizedId === normalizedId);
  if (!task) {
    throw itemNotFound("task", taskId);
  }
  return task;
}

export async function updateTask(projectDir: string, input: UpdateTaskInput): Promise<TaskMeta> {
  if (input.status !== undefined) {
    validateTaskStatus(input.status);
  }
  if (input.priority !== undefined) {
    validateTaskPriority(input.priority);
  }

  const normalizedId = normalizeIdentifier(input.id);
  const index = await readTaskIndex(projectDir);
  const task = index.tasks.find((t) => t.normalizedId === normalizedId);
  if (!task) {
    throw itemNotFound("task", input.id);
  }

  if (input.title !== undefined) task.title = input.title;
  if (input.status !== undefined) task.status = input.status;
  if (input.priority !== undefined) task.priority = input.priority;
  task.updatedAt = nowISO(input.now);

  await writeTaskIndex(projectDir, index);
  await renderTasksMd(projectDir, index);

  return task;
}

export async function deleteTask(projectDir: string, taskId: string): Promise<void> {
  const normalizedId = normalizeIdentifier(taskId);
  const index = await readTaskIndex(projectDir);
  const task = index.tasks.find((t) => t.normalizedId === normalizedId);
  if (!task) {
    throw itemNotFound("task", taskId);
  }

  index.tasks = index.tasks.filter((t) => t.normalizedId !== normalizedId);
  await writeTaskIndex(projectDir, index);
  await renderTasksMd(projectDir, index);
}
