import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DiagramInfo, DiagramListResponse, DiagramPayload, PlanMeta } from "./types.js";

const DIAGRAM_SUFFIX = ".diagram.mmd";

function planIdFromFilename(filename: string): string {
  return filename.slice(0, -DIAGRAM_SUFFIX.length);
}

async function readPlanMeta(plansDir: string, planId: string): Promise<PlanMeta | undefined> {
  try {
    const metaPath = resolve(plansDir, `${planId}.meta.json`);
    const raw = await readFile(metaPath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      title: parsed.title,
      summary: parsed.summary,
      status: parsed.status,
    };
  } catch {
    return undefined;
  }
}

/**
 * List all `.diagram.mmd` files in a plans directory.
 * Returns empty list if directory does not exist.
 */
export async function listDiagramFiles(plansDir: string): Promise<DiagramListResponse> {
  let entries: string[];
  try {
    entries = await readdir(plansDir);
  } catch {
    return { diagrams: [] };
  }

  const diagrams: DiagramInfo[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(DIAGRAM_SUFFIX)) continue;
    const filePath = resolve(plansDir, entry);
    const planId = planIdFromFilename(entry);
    const stats = await stat(filePath);
    const meta = await readPlanMeta(plansDir, planId);
    let content: string | undefined;
    try {
      content = await readFile(filePath, "utf-8");
    } catch {
      // skip unreadable files
    }
    diagrams.push({
      planId,
      path: filePath,
      modifiedAt: stats.mtime.toISOString(),
      meta,
      content,
    });
  }

  return { diagrams };
}

/**
 * Read a specific diagram by plan ID. Throws if not found.
 */
export async function readDiagram(plansDir: string, planId: string): Promise<DiagramPayload> {
  const filePath = resolve(plansDir, `${planId}${DIAGRAM_SUFFIX}`);
  let content: string;
  try {
    content = await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Diagram not found for plan "${planId}" at ${filePath}`);
  }
  const stats = await stat(filePath);
  const meta = await readPlanMeta(plansDir, planId);
  return {
    planId,
    path: filePath,
    content,
    updatedAt: stats.mtime.toISOString(),
    meta,
  };
}
