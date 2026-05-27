// ---------------------------------------------------------------------------
// Knowledge commands — registry-based
// ---------------------------------------------------------------------------
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { knowledgeMetaSchema } from "../../utils/json-schemas.js";
import { getProjectDir } from "../../utils/paths.js";
import {
  createKnowledgeEntry,
  deleteKnowledgeEntry,
  type KnowledgeKind,
  readKnowledgeIndex,
  updateKnowledgeEntry,
} from "../../utils/project-memory.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import { readStdin } from "../../utils/stdin.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

const KIND_ENUM = [
  "lesson",
  "gotcha",
  "pattern",
  "architecture",
  "module",
  "feature",
  "reference",
  "decision",
];
function requireProject(slug: string): CLIResult | string {
  const dir = getProjectDir(slug);
  if (!existsSync(dir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }
  return dir;
}
// --- knowledge list ---
defineCommand({
  path: "knowledge list",
  description: "List knowledge entries for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    kind: { type: "string", description: "Filter by kind", enum: KIND_ENUM },
    keywords: { type: "string", description: "Comma-separated keywords to filter by" },
    fields: {
      type: "string",
      required: false,
      description: "Comma-separated field names to include in output",
    },
  },
  handler: handleKnowledgeList,
});

async function handleKnowledgeList(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const kind = params.kind as KnowledgeKind | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const fields = params.fields as string | undefined;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  let entries = knowledgeIndex.entries;
  if (kind) {
    entries = entries.filter((e) => e.kind === kind);
  }
  if (keywordsRaw) {
    const keywords = keywordsRaw.split(",").map((k) => k.trim().toLowerCase());
    entries = entries.filter((e) => e.keywords.some((ek) => keywords.includes(ek.toLowerCase())));
  }
  if (fields) {
    const keys = fields.split(",").map((k) => k.trim());
    const projected = entries.map((item) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        if (key in item) out[key] = (item as unknown as Record<string, unknown>)[key];
      }
      return out;
    });
    return success(projected);
  }
  return success(entries);
}
// --- knowledge get ---
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

async function handleKnowledgeGet(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const includeBody = params.body as boolean | undefined;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
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
// --- knowledge create ---
defineCommand({
  path: "knowledge create",
  description: "Create a new knowledge entry",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Entry title" },
    kind: { type: "string", required: true, description: "Entry kind", enum: KIND_ENUM },
    summary: { type: "string", description: "Entry summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    body: { type: "string", description: "Inline markdown body content" },
    "body-file": { type: "string", description: "Path to markdown file with entry body" },
    "source-files": {
      type: "string",
      description:
        'Comma-separated source file references (e.g. "src/utils/dag.ts,src/cli/index.ts:MyClass")',
    },
  },
  handler: handleKnowledgeCreate,
});

async function handleKnowledgeCreate(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const kind = params.kind as KnowledgeKind;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const bodyInline = params.body as string | undefined;
  const bodyFile = params["body-file"] as string | undefined;
  const sourceFilesRaw = params["source-files"] as string | undefined;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
  if (bodyFile && !existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }
  const sourceFiles = sourceFilesRaw
    ? sourceFilesRaw.split(",").map((s) => {
        const [path, anchor] = s.trim().split(":");
        return anchor ? { path, anchor } : { path };
      })
    : undefined;
  if (flags.dryRun) {
    const id = normalizeIdentifier(title);
    const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
    return success({
      dryRun: true,
      wouldCreate: {
        id,
        title,
        kind,
        summary,
        keywords,
        slug,
        hasBody: !!(bodyInline || bodyFile),
        ...(sourceFiles && { sourceFiles }),
      },
    });
  }
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
  const id = normalizeIdentifier(title);

  const content = bodyInline
    ? bodyInline
    : bodyFile
      ? await readFile(bodyFile, "utf-8")
      : undefined;
  try {
    const entry = await createKnowledgeEntry(projectDir, {
      id,
      title,
      kind,
      keywords,
      ...(summary && { summary }),
      ...(content && { content }),
      ...(sourceFiles && { sourceFiles }),
    });
    return success(entry);
  } catch (err) {
    return failure("knowledge_create_error", err instanceof Error ? err.message : String(err));
  }
}
// --- knowledge update-meta ---
defineCommand({
  path: "knowledge update-meta",
  description: "Update metadata of a knowledge entry",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Entry ID" },
    title: { type: "string", description: "New title" },
    kind: { type: "string", description: "New kind", enum: KIND_ENUM },
    summary: { type: "string", description: "New summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
  },
  handler: handleKnowledgeUpdateMeta,
});

async function handleKnowledgeUpdateMeta(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const title = params.title as string | undefined;
  const kind = params.kind as KnowledgeKind | undefined;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
  if (flags.dryRun) {
    const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;
    return success({
      dryRun: true,
      wouldUpdate: { slug, entryId, title, kind, summary, keywords },
    });
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
// --- knowledge update-body ---
defineCommand({
  path: "knowledge update-body",
  description: "Update the body content of a knowledge entry",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Entry ID" },
    body: { type: "string", required: false, description: "Inline markdown body content" },
    "body-file": { type: "string", description: "Path to markdown file with entry body" },
    "body-stdin": { type: "boolean", description: "Read body from stdin" },
  },
  handler: handleKnowledgeUpdateBody,
});

async function handleKnowledgeUpdateBody(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const bodyInline = params.body as string | undefined;
  const bodyFile = params["body-file"] as string | undefined;
  const bodyStdin = params["body-stdin"] as boolean | undefined;
  if (!bodyInline && !bodyFile && !bodyStdin) {
    return failure(
      ERROR_CODES.MISSING_PARAM,
      "Either --body, --body-file, or --body-stdin is required",
      {
        hint: "Provide --body=<content>, --body-file=<path>, or --body-stdin to read from stdin.",
      },
    );
  }
  if (bodyFile && !existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }
  const result2 = requireProject(slug);
  if (typeof result2 !== "string") return result2;
  const projectDir = result2;
  const normalizedId = normalizeIdentifier(entryId);
  const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);
  if (!existsSync(metaPath)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Knowledge entry "${entryId}" not found`);
  }
  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldUpdate: { slug, entryId, bodyInline: !!bodyInline, bodyFile, bodyStdin },
    });
  }
  const rawMeta = await readJsonSafe<unknown>(metaPath);
  if (rawMeta === undefined) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Unable to parse meta for "${entryId}"`);
  }
  const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
  const bodyPath = resolve(projectDir, existingMeta.file);
  let body: string;
  if (bodyInline) {
    body = bodyInline;
  } else if (bodyFile) {
    body = await readFile(bodyFile, "utf-8");
  } else {
    body = await readStdin();
  }
  await writeFile(bodyPath, body, "utf-8");
  const meta = await updateKnowledgeEntry(projectDir, { id: entryId });
  return success({ meta, body });
}
// --- knowledge upsert ---
defineCommand({
  path: "knowledge upsert",
  description: "Create or update a knowledge entry by title (idempotent)",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Entry title" },
    kind: { type: "string", required: true, description: "Entry kind", enum: KIND_ENUM },
    summary: { type: "string", description: "Entry summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    body: { type: "string", description: "Inline markdown body content" },
    "body-file": { type: "string", description: "Path to markdown file with entry body" },
  },
  handler: handleKnowledgeUpsert,
});

async function handleKnowledgeUpsert(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const kind = params.kind as KnowledgeKind;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const bodyInline = params.body as string | undefined;
  const bodyFile = params["body-file"] as string | undefined;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
  if (bodyFile && !existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];
  const id = normalizeIdentifier(title);
  const metaPath = resolve(projectDir, "knowledge", `${id}.meta.json`);
  const exists = existsSync(metaPath);

  const content = bodyInline
    ? bodyInline
    : bodyFile
      ? await readFile(bodyFile, "utf-8")
      : undefined;
  try {
    if (exists) {
      const meta = await updateKnowledgeEntry(projectDir, {
        id,
        title,
        kind,
        summary: summary || undefined,
        keywords,
      });
      if (content) {
        const existing = validateJson(
          await readJsonSafe<unknown>(metaPath),
          knowledgeMetaSchema,
          metaPath,
        );
        await writeFile(resolve(projectDir, existing.file), content, "utf-8");
      }
      return success({ created: false, id, meta });
    }
    const entry = await createKnowledgeEntry(projectDir, {
      id,
      title,
      kind,
      keywords,
      ...(summary && { summary }),
      ...(content && { content }),
    });
    return success({ created: true, id, meta: entry });
  } catch (err) {
    return failure("knowledge_upsert_error", err instanceof Error ? err.message : String(err));
  }
}
// --- knowledge delete ---
defineCommand({
  path: "knowledge delete",
  description: "Delete a knowledge entry",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    entryId: { type: "string", required: true, positional: 1, description: "Entry ID" },
  },
  handler: handleKnowledgeDelete,
});

async function handleKnowledgeDelete(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const entryId = params.entryId as string;
  const result = requireProject(slug);
  if (typeof result !== "string") return result;
  const projectDir = result;
  const knowledgeIndex = await readKnowledgeIndex(projectDir);
  const entry = knowledgeIndex.entries.find((e) => e.id === entryId || e.normalizedId === entryId);
  if (!entry) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Knowledge entry "${entryId}" not found`, {
      hint: `Run 'spoc knowledge list ${slug}' to see available entries.`,
    });
  }
  if (flags.dryRun) {
    return success({ dryRun: true, wouldDelete: { slug, entryId: entry.id } });
  }
  try {
    await deleteKnowledgeEntry(projectDir, entry.id);
    return success({ deleted: entry.id });
  } catch (err) {
    return failure("knowledge_delete_error", err instanceof Error ? err.message : String(err));
  }
}
