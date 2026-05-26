// ---------------------------------------------------------------------------
// Plan commands — registry-based
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getProjectDir } from "../../utils/paths.js";
import {
  createPlan,
  deletePlan,
  PLAN_STATUSES,
  type PlanStatus,
  readPlanIndex,
  updatePlan,
} from "../../utils/project-memory.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

// ---------------------------------------------------------------------------
// plan list
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan list",
  description: "List plans for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    status: {
      type: "string",
      description: "Filter by status",
      enum: ["proposed", "planned", "in_progress", "done", "archived"],
    },
    keywords: { type: "string", description: "Comma-separated keywords to filter by" },
  },
  handler: handlePlanList,
});

async function handlePlanList(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const status = params.status as PlanStatus | undefined;
  const keywordsRaw = params.keywords as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const planIndex = await readPlanIndex(projectDir);
  let plans = planIndex.plans;

  if (status) {
    plans = plans.filter((p) => p.status === status);
  }

  if (keywordsRaw) {
    const keywords = keywordsRaw.split(",").map((k) => k.trim().toLowerCase());
    plans = plans.filter((p) => p.keywords?.some((pk) => keywords.includes(pk.toLowerCase())));
  }

  return success(plans);
}

// ---------------------------------------------------------------------------
// plan get
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan get",
  description: "Get plan details",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    body: { type: "boolean", description: "Include plan body content" },
  },
  handler: handlePlanGet,
});

async function handlePlanGet(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const includeBody = params.body as boolean | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const planIndex = await readPlanIndex(projectDir);
  const plan = planIndex.plans.find((p) => p.id === planId || p.normalizedId === planId);

  if (!plan) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Plan "${planId}" not found`, {
      hint: `Run 'spoc plan list ${slug}' to see available plans.`,
    });
  }

  if (includeBody) {
    const bodyPath = resolve(projectDir, plan.file);
    let body: string | undefined;
    if (existsSync(bodyPath)) {
      body = await readFile(bodyPath, "utf-8");
    }
    return success({ ...plan, body });
  }

  return success(plan);
}

// ---------------------------------------------------------------------------
// plan create
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan create",
  description: "Create a new plan",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Plan title" },
    status: {
      type: "string",
      description: "Initial status (default: proposed)",
      enum: [...PLAN_STATUSES],
    },
    summary: { type: "string", description: "Plan summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    body: { type: "string", description: "Inline markdown body content" },
    "body-file": { type: "string", description: "Path to markdown file with plan body" },
  },
  handler: handlePlanCreate,
});

async function handlePlanCreate(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const status = (params.status as PlanStatus | undefined) ?? "proposed";
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const bodyInline = params.body as string | undefined;
  const bodyFile = params["body-file"] as string | undefined;
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (bodyFile && !existsSync(bodyFile)) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Body file not found: ${bodyFile}`);
  }

  const id = normalizeIdentifier(title);

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldCreate: {
        title,
        slug,
        id,
        status,
        summary,
        keywords,
        hasBody: !!(bodyInline || bodyFile),
      },
    });
  }

  // Resolve body content: inline > file > undefined
  let content: string | undefined;
  if (bodyInline) {
    content = bodyInline;
  } else if (bodyFile) {
    content = readFileSync(bodyFile, "utf-8");
  }

  try {
    const meta = await createPlan(projectDir, {
      id,
      title,
      status,
      keywords,
      summary,
      ...(content && { content }),
    });
    return success(meta);
  } catch (err) {
    return failure("plan_create_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// plan update-meta
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan update-meta",
  description: "Update plan metadata",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    title: { type: "string", description: "New title" },
    status: {
      type: "string",
      description: "New status",
      enum: ["proposed", "planned", "in_progress", "done", "archived"],
    },
    summary: { type: "string", description: "New summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
  },
  handler: handlePlanUpdateMeta,
});

async function handlePlanUpdateMeta(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const title = params.title as string | undefined;
  const status = params.status as PlanStatus | undefined;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldUpdate: { planId, slug, title, status, summary, keywords },
    });
  }

  try {
    const meta = await updatePlan(projectDir, {
      id: planId,
      title,
      status,
      summary,
      keywords,
    });
    return success(meta);
  } catch (err) {
    return failure("plan_update_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// plan update-body
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan update-body",
  description: "Update plan body content",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    "body-file": { type: "string", description: "Path to markdown file with plan body" },
    "body-stdin": { type: "boolean", description: "Read body from stdin" },
  },
  handler: handlePlanUpdateBody,
});

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function handlePlanUpdateBody(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const bodyFile = params["body-file"] as string | undefined;
  const bodyStdin = params["body-stdin"] as boolean | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (!bodyFile && !bodyStdin) {
    return failure("missing_param", "Either --body-file or --body-stdin is required", {
      usage: "spoc plan update-body <slug> <planId> --body-file=<path>",
    });
  }

  if (bodyFile && !existsSync(bodyFile)) {
    return failure("file_not_found", `Body file not found: ${bodyFile}`);
  }

  const planIndex = await readPlanIndex(projectDir);
  const normalizedId = normalizeIdentifier(planId);
  const plan = planIndex.plans.find((p) => p.id === planId || p.normalizedId === normalizedId);
  if (!plan) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Plan "${planId}" not found`, {
      hint: `Run 'spoc plan list ${slug}' to see available plans.`,
    });
  }

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldUpdate: { planId: plan.id, slug, source: bodyFile ? "file" : "stdin" },
    });
  }

  const body = bodyFile ? readFileSync(bodyFile, "utf-8") : await readStdin();
  const bodyPath = resolve(projectDir, plan.file);

  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(bodyPath, body, "utf-8");
    return success({ meta: plan, body });
  } catch (err) {
    return failure("plan_update_body_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// plan delete
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan delete",
  description: "Delete a plan",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
  },
  handler: handlePlanDelete,
});

async function handlePlanDelete(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const planIndex = await readPlanIndex(projectDir);
  const plan = planIndex.plans.find((p) => p.id === planId || p.normalizedId === planId);
  if (!plan) {
    return failure(ERROR_CODES.ENTITY_NOT_FOUND, `Plan "${planId}" not found`, {
      hint: `Run 'spoc plan list ${slug}' to see available plans.`,
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldDelete: { slug, planId: plan.id } });
  }

  try {
    await deletePlan(projectDir, plan.id);
    return success({ deleted: plan.id });
  } catch (err) {
    return failure("plan_delete_error", err instanceof Error ? err.message : String(err));
  }
}
