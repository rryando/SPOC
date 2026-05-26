// ---------------------------------------------------------------------------
// Knowledge commands — registry-based
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getProjectDir } from "../../utils/paths.js";
import {
  createKnowledgeEntry,
  readKnowledgeIndex,
  updateKnowledgeEntry,
  KNOWLEDGE_KINDS,
  type KnowledgeKind,
} from "../../utils/project-memory.js";
import { knowledgeMetaSchema } from "../../utils/json-schemas.js";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import { requireWriteGate, WriteGateError } from "../../utils/write-gate.js";
import { buildProjectRetrievalIndex } from "../../retrieval/index-builder.js";

// ---------------------------------------------------------------------------
// knowledge list
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge list",
  description: "List knowledge entries for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    kind: { type: "string", description: "Filter by kind", enum: ["lesson", "gotcha", "pattern", "feature", "decision", "reference"] },
    keywords: { type: "string", description: "Comma-separated keywords to filter by" },
  },
  handler: handleKnowledgeList,
});

async function handleKnowledgeList(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const kind = params.kind as KnowledgeKind | undefined;
  const keywordsRaw = params.keywords as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  let entries = knowledgeIndex.entries;

  if (kind) {
    entries = entries.filter((e) => e.kind === kind);
  }

  if (keywordsRaw) {
    const keywords = keywordsRaw.split(",").map((k) => k.trim().toLowerCase());
    entries = entries.filter((e) =>
      e.keywords.some((ek) => keywords.includes(ek.toLowerCase())),
    );
  }

  return success(entries);
}

// ---------------------------------------------------------------------------
// knowledge get
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge get",
  description: "Get a knowledge entry by ID",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Knowledge entry ID" },
    body: { type: "boolean", description: "Include entry body content" },
  },
  handler: handleKnowledgeGet,
});

async function handleKnowledgeGet(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const includeBody = params.body as boolean | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const normalizedId = normalizeIdentifier(entryId);
  const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

  if (!existsSync(metaPath)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Knowledge entry "${entryId}" not found`);
  }

  const raw = await readJsonSafe<unknown>(metaPath);
  if (raw === undefined) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Unable to parse meta for "${entryId}"`);
  }
  const meta = validateJson(raw, knowledgeMetaSchema, metaPath);

  if (includeBody) {
    const bodyPath = resolve(projectDir, meta.file);
    const body = existsSync(bodyPath) ? await readFile(bodyPath, "utf-8") : "";
    return success({ meta, body });
  }

  return success({ meta });
}

// ---------------------------------------------------------------------------
// knowledge create
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge create",
  description: "Create a new knowledge entry",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Entry title" },
    kind: { type: "string", required: true, description: "Entry kind", enum: ["lesson", "gotcha", "pattern", "feature", "decision", "reference"] },
    summary: { type: "string", description: "Entry summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleKnowledgeCreate,
});

async function handleKnowledgeCreate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const kind = params.kind as KnowledgeKind;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const token = params.token as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    const id = normalizeIdentifier(title);
    const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
    return success({ dryRun: true, wouldCreate: { id, title, kind, summary, keywords, slug } });
  }

  try {
    requireWriteGate(token, slug, "tool:create_project_knowledge_entry");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
  const id = normalizeIdentifier(title);

  try {
    const entry = await createKnowledgeEntry(projectDir, {
      id,
      title,
      kind,
      keywords,
      ...(summary && { summary }),
    });
    return success(entry);
  } catch (err) {
    return failure("knowledge_create_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// knowledge update-meta
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge update-meta",
  description: "Update metadata of a knowledge entry",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Entry ID" },
    title: { type: "string", description: "New title" },
    kind: { type: "string", description: "New kind", enum: ["lesson", "gotcha", "pattern", "feature", "decision", "reference"] },
    summary: { type: "string", description: "New summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleKnowledgeUpdateMeta,
});

async function handleKnowledgeUpdateMeta(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const title = params.title as string | undefined;
  const kind = params.kind as KnowledgeKind | undefined;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const token = params.token as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;
    return success({ dryRun: true, wouldUpdate: { slug, entryId, title, kind, summary, keywords } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_knowledge_meta");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;

  try {
    const meta = await updateKnowledgeEntry(projectDir, {
      id: entryId,
      title: title || undefined,
      kind: kind || undefined,
      summary: summary || undefined,
      keywords,
    });
    return success({ meta });
  } catch (err) {
    return failure("knowledge_update_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// knowledge update-body
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge update-body",
  description: "Update the body content of a knowledge entry",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Entry ID" },
    "body-file": { type: "string", description: "Path to markdown file with entry body" },
    "body-stdin": { type: "boolean", description: "Read body from stdin" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleKnowledgeUpdateBody,
});

async function handleKnowledgeUpdateBody(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const bodyFile = params["body-file"] as string | undefined;
  const bodyStdin = params["body-stdin"] as boolean | undefined;
  const token = params.token as string | undefined;

  if (!bodyFile && !bodyStdin) {
    return failure(ERROR_CODES.MISSING_PARAM, "Either --body-file or --body-stdin is required", {
      hint: "Provide --body-file=<path> or --body-stdin to read from stdin.",
    });
  }

  if (bodyFile && !existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const normalizedId = normalizeIdentifier(entryId);
  const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);

  if (!existsSync(metaPath)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Knowledge entry "${entryId}" not found`);
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { slug, entryId, bodyFile, bodyStdin } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_knowledge_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  const rawMeta = await readJsonSafe<unknown>(metaPath);
  if (rawMeta === undefined) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Unable to parse meta for "${entryId}"`);
  }
  const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
  const bodyPath = resolve(projectDir, existingMeta.file);

  let body: string;
  if (bodyFile) {
    body = await readFile(bodyFile, "utf-8");
  } else {
    body = await readStdin();
  }

  await writeFile(bodyPath, body, "utf-8");
  const meta = await updateKnowledgeEntry(projectDir, { id: entryId });

  return success({ meta, body });
}

// ---------------------------------------------------------------------------
// knowledge search
// ---------------------------------------------------------------------------

defineCommand({
  path: "knowledge search",
  description: "Search knowledge entries using BM25 scoring",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    query: { type: "string", required: true, positional: 1, description: "Search query" },
    kind: { type: "string", description: "Filter by kind", enum: ["lesson", "gotcha", "pattern", "feature", "decision", "reference"] },
  },
  handler: handleKnowledgeSearch,
});

async function handleKnowledgeSearch(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
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
    const kindSet = new Set(
      knowledgeIndex.entries.filter((e) => e.kind === kind).map((e) => e.id),
    );
    results = results.filter((r) => kindSet.has(r.id));
  }

  return success(results);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      reject(new Error("Timed out reading from stdin (5s). Ensure data is piped to the command."));
    }, 5000);
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
