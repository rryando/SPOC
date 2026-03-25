import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createKnowledgeEntry,
  createPlan,
  readKnowledgeIndex,
  readPlanIndex,
  updateKnowledgeEntry,
  updatePlan,
} from "../src/utils/project-memory.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-project-memory-"));
  tempDirs.push(dir);
  return dir;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("project memory utilities", () => {
  it("rejects normalized id collisions", async () => {
    const projectDir = makeProjectDir();

    await createPlan(projectDir, {
      id: "Alpha Plan",
      title: "Alpha Plan",
      status: "proposed",
      keywords: ["Architecture"],
    });

    await expect(
      createPlan(projectDir, {
        id: "alpha-plan",
        title: "Alpha Plan Again",
        status: "proposed",
        keywords: ["Architecture"],
      }),
    ).rejects.toThrow(/normalized id .*alpha-plan/i);
  });

  it("rejects invalid status, kind, and keyword values", async () => {
    const projectDir = makeProjectDir();

    await expect(
      createPlan(projectDir, {
        id: "invalid-status",
        title: "Invalid Status",
        status: "oops" as never,
        keywords: ["valid-keyword"],
      }),
    ).rejects.toThrow(/invalid plan status/i);

    await expect(
      createKnowledgeEntry(projectDir, {
        id: "invalid-kind",
        title: "Invalid Kind",
        kind: "note" as never,
        keywords: ["valid-keyword"],
      }),
    ).rejects.toThrow(/invalid knowledge kind/i);

    await expect(
      createPlan(projectDir, {
        id: "invalid-keyword",
        title: "Invalid Keyword",
        status: "proposed",
        keywords: ["###"],
      }),
    ).rejects.toThrow(/invalid keyword/i);
  });

  it("creates a single title h1", async () => {
    const projectDir = makeProjectDir();

    const plan = await createPlan(projectDir, {
      id: "single-h1",
      title: "Single H1",
      status: "proposed",
      keywords: ["docs"],
      content: "# Single H1\n\nBody text.",
    });

    const markdown = readFileSync(resolve(projectDir, plan.file), "utf-8");

    expect(markdown.startsWith("# Single H1\n\nBody text.")).toBe(true);
    expect(markdown.match(/^# Single H1$/gm)).toHaveLength(1);
  });

  it("rewrites the leading h1 when a title changes", async () => {
    const projectDir = makeProjectDir();

    const entry = await createKnowledgeEntry(projectDir, {
      id: "decision-1",
      title: "Old Title",
      kind: "reference",
      keywords: ["api"],
      content: "# Old Title\n\nKeep this body.",
    });

    await updateKnowledgeEntry(projectDir, {
      id: entry.id,
      title: "New Title",
    });

    const markdown = readFileSync(resolve(projectDir, entry.file), "utf-8");

    expect(markdown.startsWith("# New Title\n\nKeep this body.")).toBe(true);
    expect(markdown).not.toContain("# Old Title");
  });

  it("keeps item meta and index updatedAt in sync", async () => {
    const projectDir = makeProjectDir();

    const created = await createPlan(projectDir, {
      id: "sync-updated-at",
      title: "Sync updatedAt",
      status: "proposed",
      keywords: ["timing"],
      now: "2026-03-16T10:00:00.000Z",
    });

    const updated = await updatePlan(projectDir, {
      id: created.id,
      status: "in_progress",
      now: "2026-03-16T11:00:00.000Z",
    });

    const meta = readJson(resolve(projectDir, "plans", `${updated.normalizedId}.meta.json`)) as {
      updatedAt: string;
    };
    const index = await readPlanIndex(projectDir);

    expect(meta.updatedAt).toBe("2026-03-16T11:00:00.000Z");
    expect(index.plans[0]?.updatedAt).toBe("2026-03-16T11:00:00.000Z");
  });

  it("reads legacy projects without creating memory directories", async () => {
    const projectDir = makeProjectDir();

    expect(await readPlanIndex(projectDir)).toEqual({ plans: [] });
    expect(await readKnowledgeIndex(projectDir)).toEqual({ entries: [] });
    expect(existsSync(resolve(projectDir, "plans"))).toBe(false);
    expect(existsSync(resolve(projectDir, "knowledge"))).toBe(false);
  });

  it("rebuilds and writes back a missing plans index", async () => {
    const projectDir = makeProjectDir();

    await createPlan(projectDir, {
      id: "missing-index",
      title: "Missing Index",
      status: "proposed",
      keywords: ["rebuild"],
      now: "2026-03-16T12:00:00.000Z",
    });

    const indexPath = resolve(projectDir, "plans", "index.json");
    unlinkSync(indexPath);

    const index = await readPlanIndex(projectDir);

    expect(index.plans).toHaveLength(1);
    expect(readJson(indexPath)).toEqual(index);
  });

  it("rebuilds and writes back a corrupted knowledge index", async () => {
    const projectDir = makeProjectDir();

    await createKnowledgeEntry(projectDir, {
      id: "corrupted-index",
      title: "Corrupted Index",
      kind: "reference",
      keywords: ["rebuild"],
      now: "2026-03-16T12:30:00.000Z",
    });

    const indexPath = resolve(projectDir, "knowledge", "index.json");
    writeFileSync(indexPath, "{not-json", "utf-8");

    const index = await readKnowledgeIndex(projectDir);

    expect(index.entries).toHaveLength(1);
    expect(readJson(indexPath)).toEqual(index);
  });

  it("rebuilds stale indexes for both plans and knowledge", async () => {
    const projectDir = makeProjectDir();

    const plan = await createPlan(projectDir, {
      id: "stale-plan",
      title: "Stale Plan",
      status: "proposed",
      keywords: ["rebuild"],
      now: "2026-03-16T13:00:00.000Z",
    });
    const entry = await createKnowledgeEntry(projectDir, {
      id: "stale-knowledge",
      title: "Stale Knowledge",
      kind: "pattern",
      keywords: ["rebuild"],
      now: "2026-03-16T13:00:00.000Z",
    });

    writeFileSync(
      resolve(projectDir, "plans", "index.json"),
      JSON.stringify({ plans: [{ ...plan, updatedAt: "1999-01-01T00:00:00.000Z" }] }, null, 2),
      "utf-8",
    );
    writeFileSync(
      resolve(projectDir, "knowledge", "index.json"),
      JSON.stringify({ entries: [{ ...entry, updatedAt: "1999-01-01T00:00:00.000Z" }] }, null, 2),
      "utf-8",
    );

    const plans = await readPlanIndex(projectDir);
    const knowledge = await readKnowledgeIndex(projectDir);

    expect(plans.plans[0]?.updatedAt).toBe("2026-03-16T13:00:00.000Z");
    expect(knowledge.entries[0]?.updatedAt).toBe("2026-03-16T13:00:00.000Z");
    expect(readJson(resolve(projectDir, "plans", "index.json"))).toEqual(plans);
    expect(readJson(resolve(projectDir, "knowledge", "index.json"))).toEqual(knowledge);
  });

  it("fails descriptively when an index rebuild is impossible", async () => {
    const projectDir = makeProjectDir();
    const plansDir = resolve(projectDir, "plans");

    mkdirSync(plansDir, { recursive: true });
    writeFileSync(resolve(plansDir, "broken.meta.json"), "{", "utf-8");

    await expect(readPlanIndex(projectDir)).rejects.toThrow(/unable to rebuild plans index/i);
    await expect(readPlanIndex(projectDir)).rejects.toThrow(/broken.meta.json/i);
  });

  it("creates memory directories lazily on the first write for legacy projects", async () => {
    const projectDir = makeProjectDir();

    expect(existsSync(resolve(projectDir, "plans"))).toBe(false);
    expect(existsSync(resolve(projectDir, "knowledge"))).toBe(false);

    await createPlan(projectDir, {
      id: "lazy-plan",
      title: "Lazy Plan",
      status: "proposed",
      keywords: ["legacy"],
    });
    await createKnowledgeEntry(projectDir, {
      id: "lazy-knowledge",
      title: "Lazy Knowledge",
      kind: "gotcha",
      keywords: ["legacy"],
    });

    expect(existsSync(resolve(projectDir, "plans", "index.json"))).toBe(true);
    expect(existsSync(resolve(projectDir, "knowledge", "index.json"))).toBe(true);
  });
});
