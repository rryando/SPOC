// ---------------------------------------------------------------------------
// Plan commands — registry-based
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { getProjectDir } from "../../utils/paths.js";
import {
  createPlan,
  readPlanIndex,
  updatePlan,
  PLAN_STATUSES,
  type PlanStatus,
} from "../../utils/project-memory.js";
import { normalizeIdentifier } from "../../utils/slug.js";
import { requireWriteGate, WriteGateError } from "../../utils/write-gate.js";

// ---------------------------------------------------------------------------
// plan list
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan list",
  description: "List plans for a project",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    status: { type: "string", description: "Filter by status", enum: ["proposed", "planned", "in_progress", "done", "archived"] },
    keywords: { type: "string", description: "Comma-separated keywords to filter by" },
  },
  handler: handlePlanList,
});

async function handlePlanList(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
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
    plans = plans.filter((p) =>
      p.keywords?.some((pk) => keywords.includes(pk.toLowerCase())),
    );
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

async function handlePlanGet(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
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
// plan create (write-gated)
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan create",
  description: "Create a new plan",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    title: { type: "string", required: true, positional: 1, description: "Plan title" },
    summary: { type: "string", description: "Plan summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handlePlanCreate,
});

async function handlePlanCreate(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const title = params.title as string;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const token = params.token as string | undefined;
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : [];

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  const id = normalizeIdentifier(title);

  if (flags.dryRun) {
    return success({ dryRun: true, wouldCreate: { title, slug, id, status: "proposed", summary, keywords } });
  }

  try {
    requireWriteGate(token, slug, "tool:create_project_plan");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  try {
    const meta = await createPlan(projectDir, {
      id,
      title,
      status: "proposed",
      keywords,
      summary,
    });
    return success(meta);
  } catch (err) {
    return failure("plan_create_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// plan update-meta (write-gated)
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan update-meta",
  description: "Update plan metadata",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    title: { type: "string", description: "New title" },
    status: { type: "string", description: "New status", enum: ["proposed", "planned", "in_progress", "done", "archived"] },
    summary: { type: "string", description: "New summary" },
    keywords: { type: "string", description: "Comma-separated keywords" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handlePlanUpdateMeta,
});

async function handlePlanUpdateMeta(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const title = params.title as string | undefined;
  const status = params.status as PlanStatus | undefined;
  const summary = params.summary as string | undefined;
  const keywordsRaw = params.keywords as string | undefined;
  const token = params.token as string | undefined;
  const keywords = keywordsRaw ? keywordsRaw.split(",").map((k) => k.trim()) : undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldUpdate: { planId, slug, title, status, summary, keywords } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_plan_meta");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
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
// plan update-body (write-gated)
// ---------------------------------------------------------------------------

defineCommand({
  path: "plan update-body",
  description: "Update plan body content",
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    planId: { type: "string", required: true, positional: 1, description: "Plan ID" },
    "body-file": { type: "string", description: "Path to markdown file with plan body" },
    "body-stdin": { type: "boolean", description: "Read body from stdin" },
    token: { type: "string", description: "Write-gate token" },
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

async function handlePlanUpdateBody(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const planId = params.planId as string;
  const bodyFile = params["body-file"] as string | undefined;
  const bodyStdin = params["body-stdin"] as boolean | undefined;
  const token = params.token as string | undefined;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`, {
      hint: "Run 'spoc project list' to see available projects.",
    });
  }

  if (!bodyFile && !bodyStdin) {
    return failure("missing_param", "Either --body-file or --body-stdin is required", {
      usage: "spoc plan update-body <slug> <planId> --body-file=<path> --token=<token>",
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
    return success({ dryRun: true, wouldUpdate: { planId: plan.id, slug, source: bodyFile ? "file" : "stdin" } });
  }

  try {
    requireWriteGate(token, slug, "tool:update_project_plan_body");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
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
