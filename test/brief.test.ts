// ---------------------------------------------------------------------------
// Tests for `arcs brief` command
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";

function seedProject(
  dir: string,
  slug: string,
  opts?: { tasks?: unknown[]; plans?: unknown[]; knowledge?: unknown[]; overview?: string },
) {
  const rootMeta = {
    version: "1.0",
    projects: [{ id: slug, name: "Test Project", status: "active", dependsOn: [] }],
  };
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify(rootMeta), "utf-8");

  const projDir = resolve(dir, "projects", slug);
  mkdirSync(projDir, { recursive: true });

  const cwd = process.cwd();
  const projectMeta = {
    id: slug,
    name: "Test Project",
    description: "A test project",
    createdAt: "2025-01-01T00:00:00Z",
    workspacePaths: [cwd],
  };
  writeFileSync(resolve(projDir, "meta.json"), JSON.stringify(projectMeta), "utf-8");

  // Overview
  const overview = opts?.overview ?? "This is the project summary paragraph.\n\nMore details here.";
  writeFileSync(resolve(projDir, "overview.md"), overview, "utf-8");

  // Tasks
  const tasksDir = resolve(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const tasks = opts?.tasks ?? [
    {
      id: "t1",
      normalizedId: "t1",
      title: "Open task",
      status: "in_progress",
      priority: "high",
      planId: "p1",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "t2",
      normalizedId: "t2",
      title: "Done task",
      status: "done",
      priority: "medium",
      planId: "p1",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "t3",
      normalizedId: "t3",
      title: "Cancelled task",
      status: "cancelled",
      priority: "low",
      planId: "p1",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ];
  writeFileSync(resolve(tasksDir, "index.json"), JSON.stringify({ tasks }), "utf-8");

  // Plans
  const plansDir = resolve(projDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  const plans = opts?.plans ?? [
    {
      id: "p1",
      normalizedId: "p1",
      title: "Active plan",
      status: "in_progress",
      keywords: [],
      summary: "s",
      file: "plans/p1.md",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "p2",
      normalizedId: "p2",
      title: "Done plan",
      status: "done",
      keywords: [],
      summary: "s",
      file: "plans/p2.md",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ];
  writeFileSync(resolve(plansDir, "index.json"), JSON.stringify({ plans }), "utf-8");
  for (const p of plans as Array<{ normalizedId: string } & Record<string, unknown>>) {
    writeFileSync(resolve(plansDir, `${p.normalizedId}.meta.json`), JSON.stringify(p), "utf-8");
  }

  // Knowledge
  const knowledgeDir = resolve(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  const knowledge = opts?.knowledge ?? [
    {
      id: "k1",
      normalizedId: "k1",
      title: "K1",
      kind: "pattern",
      audience: "orchestrator",
      keywords: [],
      summary: "s",
      file: "knowledge/k1.md",
      createdAt: "2025-01-05T00:00:00Z",
      updatedAt: "2025-01-05T00:00:00Z",
    },
    {
      id: "k2",
      normalizedId: "k2",
      title: "K2",
      kind: "lesson",
      audience: "implementer",
      keywords: [],
      summary: "s",
      file: "knowledge/k2.md",
      createdAt: "2025-01-04T00:00:00Z",
      updatedAt: "2025-01-04T00:00:00Z",
    },
    {
      id: "k3",
      normalizedId: "k3",
      title: "K3",
      kind: "gotcha",
      audience: "orchestrator",
      keywords: [],
      summary: "s",
      file: "knowledge/k3.md",
      createdAt: "2025-01-03T00:00:00Z",
      updatedAt: "2025-01-03T00:00:00Z",
    },
    {
      id: "k4",
      normalizedId: "k4",
      title: "K4",
      kind: "architecture",
      audience: "universal",
      keywords: [],
      summary: "s",
      file: "knowledge/k4.md",
      createdAt: "2025-01-02T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    },
    {
      id: "k5",
      normalizedId: "k5",
      title: "K5",
      kind: "reference",
      audience: "orchestrator",
      keywords: [],
      summary: "s",
      file: "knowledge/k5.md",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "k6",
      normalizedId: "k6",
      title: "K6",
      kind: "feature",
      audience: "designer",
      keywords: [],
      summary: "s",
      file: "knowledge/k6.md",
      createdAt: "2025-01-06T00:00:00Z",
      updatedAt: "2025-01-06T00:00:00Z",
    },
  ];
  writeFileSync(
    resolve(knowledgeDir, "index.json"),
    JSON.stringify({ entries: knowledge }),
    "utf-8",
  );
  for (const k of knowledge as Array<{ normalizedId: string } & Record<string, unknown>>) {
    writeFileSync(resolve(knowledgeDir, `${k.normalizedId}.meta.json`), JSON.stringify(k), "utf-8");
  }
}

describe("arcs brief", () => {
  it("returns correct envelope shape", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data).toHaveProperty("slug");
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("summary");
      expect(data).toHaveProperty("operatingBrief");
      expect(data).toHaveProperty("activePlansCount");
      expect(data).toHaveProperty("openTasksCount");
      expect(data).toHaveProperty("topKnowledge");
      expect(data).toHaveProperty("topOpenTasks");
      expect(data).toHaveProperty("activePlanTitles");
      // With an in_progress task seeded, operatingBrief is populated
      expect(data.operatingBrief).not.toBeNull();
      const brief = data.operatingBrief as Record<string, unknown>;
      expect(brief).toHaveProperty("currentFocus");
      expect(brief).toHaveProperty("recommendedSurface");
      expect(brief).toHaveProperty("why");
      expect(brief).toHaveProperty("nextAction");
    });
  });

  it("filters done/cancelled tasks by default", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.openTasksCount).toBe(1); // only in_progress
    });
  });

  it("filters done plans by default", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.activePlansCount).toBe(1); // only in_progress (p2 is done, filtered out)
    });
  });

  it("--full includes done tasks and plans", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--full", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.openTasksCount).toBe(3);
      expect(data.activePlansCount).toBe(2);
    });
  });

  it("defaults audience to orchestrator", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { topKnowledge: Array<{ id: string }> };
      // orchestrator audience + universal: k1, k3, k4, k5 (not k2=implementer, not k6=designer)
      const ids = data.topKnowledge.map((k) => k.id);
      expect(ids).not.toContain("k2");
      expect(ids).not.toContain("k6");
    });
  });

  it("respects audience filter param", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--audience=designer", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { topKnowledge: Array<{ id: string }> };
      const ids = data.topKnowledge.map((k) => k.id);
      // designer + universal: k4, k6
      expect(ids).toContain("k6");
      expect(ids).toContain("k4");
      expect(ids).not.toContain("k1");
    });
  });

  it("returns top 5 knowledge entries max", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      // With audience=orchestrator, we have k1, k3, k4, k5 (4 entries, under 5)
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as {
        topKnowledge: Array<{ id: string; title: string; kind: string }>;
      };
      expect(data.topKnowledge.length).toBeLessThanOrEqual(5);
      // Each entry has id, title, kind only
      for (const k of data.topKnowledge) {
        expect(Object.keys(k).sort()).toEqual(["id", "kind", "title"]);
      }
    });
  });

  it("byte budget ≤ 2048 bytes", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--lean", "--json"]);
      const json = JSON.stringify(result);
      expect(json.length).toBeLessThanOrEqual(2048);
    });
  });

  it("auto-resolves cwd when no arg given", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.slug).toBe("test-proj");
    });
  });

  it("envelope keys are correctly typed", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(typeof data.slug).toBe("string");
      expect(typeof data.name).toBe("string");
      expect(typeof data.summary).toBe("string");
      expect(typeof data.operatingBrief).toBe("object");
      expect(typeof data.activePlansCount).toBe("number");
      expect(typeof data.openTasksCount).toBe("number");
      expect(Array.isArray(data.topKnowledge)).toBe(true);
      expect(Array.isArray(data.topOpenTasks)).toBe(true);
      expect(Array.isArray(data.activePlanTitles)).toBe(true);
    });
  });

  it("operatingBrief fields are strings when active work exists", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { operatingBrief: Record<string, unknown> };
      const ob = data.operatingBrief;
      expect(typeof ob.currentFocus).toBe("string");
      expect(typeof ob.recommendedSurface).toBe("string");
      expect(typeof ob.why).toBe("string");
      expect(typeof ob.nextAction).toBe("string");
      expect((ob.currentFocus as string).length).toBeGreaterThan(0);
    });
  });

  it("--help renders", async () => {
    const result = await runCommand("brief", ["--help"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Record<string, unknown>;
    expect(data.help).toBe(true);
  });

  it("summary is truncated to 200 chars", async () => {
    await withTempDataDir(async (dir) => {
      const longOverview = `${"A".repeat(300)}\n\nSecond paragraph.`;
      seedProject(dir, "test-proj", { overview: longOverview });
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { summary: string };
      expect(data.summary.length).toBeLessThanOrEqual(200);
    });
  });

  it("summary skips leading H2 heading and grabs first prose paragraph", async () => {
    // Regression: arcs's own overview.md starts with `## Summary` which the
    // brief was rendering verbatim instead of skipping to the actual prose.
    await withTempDataDir(async (dir) => {
      const overview =
        "## Summary\n\nThis is the actual project description prose.\n\n## Goals\n\n- something";
      seedProject(dir, "test-proj", { overview });
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { summary: string };
      expect(data.summary).toBe("This is the actual project description prose.");
      expect(data.summary).not.toMatch(/^##/);
    });
  });

  it("summary skips leading H1 followed by H2", async () => {
    await withTempDataDir(async (dir) => {
      const overview = "# Project Title\n\n## Summary\n\nReal prose here.\n\nMore.";
      seedProject(dir, "test-proj", { overview });
      const result = await runCommand("brief", ["test-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { summary: string };
      expect(data.summary).toBe("Real prose here.");
    });
  });

  it("renders markdown when no --json flag", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("brief", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const md = result.data as string;
      expect(typeof md).toBe("string");
      expect(md).toMatch(/^# Test Project\n/);
      expect(md).toContain("**Focus:**");
      expect(md).toContain("## Active Plans (1)");
      expect(md).toContain("## Open Tasks (1)");
      expect(md).toContain("- [/] Open task");
      expect(md).toContain("## Top Knowledge");
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape detection
      expect(md).not.toMatch(/\u001b\[/);
    });
  });
});

// ---------------------------------------------------------------------------
// arcs context — default filtering and --full
// ---------------------------------------------------------------------------

describe("arcs context", () => {
  it("defaults audience to orchestrator", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.audience).toBe("orchestrator");
    });
  });

  it("filters done/cancelled tasks by default", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { tasks: Array<{ status: string }> };
      // Only in_progress task remains (done and cancelled filtered)
      expect(data.tasks.length).toBe(1);
      expect(data.tasks[0].status).toBe("in_progress");
    });
  });

  it("filters done/archived plans by default", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { plans: Array<{ status: string }> };
      // Only in_progress plan remains (done filtered)
      expect(data.plans.length).toBe(1);
      expect(data.plans[0].status).toBe("in_progress");
    });
  });

  it("--full includes done tasks and plans", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj", "--full"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as {
        tasks: Array<{ status: string }>;
        plans: Array<{ status: string }>;
      };
      expect(data.tasks.length).toBe(3);
      expect(data.plans.length).toBe(2);
    });
  });

  it("returns operatingBrief", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { operatingBrief: Record<string, unknown> };
      expect(data.operatingBrief).not.toBeNull();
      expect(data.operatingBrief).toHaveProperty("currentFocus");
      expect(data.operatingBrief).toHaveProperty("recommendedSurface");
    });
  });

  it("filters knowledge by default audience (orchestrator)", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("context", ["test-proj"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as { knowledge: Array<{ id: string }> };
      const ids = data.knowledge.map((k) => k.id);
      // orchestrator + universal: k1, k3, k4, k5 (not k2=implementer, not k6=designer)
      expect(ids).not.toContain("k2");
      expect(ids).not.toContain("k6");
    });
  });
});
