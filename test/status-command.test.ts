// ---------------------------------------------------------------------------
// Tests for `spoc status` command
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";

function seedProject(dir: string, slug: string) {
  const rootMeta = {
    version: "1.0",
    projects: [{ id: slug, name: "Status Test", status: "active", dependsOn: [] }],
  };
  writeFileSync(resolve(dir, "meta.json"), JSON.stringify(rootMeta), "utf-8");

  const projDir = resolve(dir, "projects", slug);
  mkdirSync(projDir, { recursive: true });

  const cwd = process.cwd();
  writeFileSync(
    resolve(projDir, "meta.json"),
    JSON.stringify({
      id: slug,
      name: "Status Test",
      description: "Test",
      createdAt: "2025-01-01T00:00:00Z",
      workspacePaths: [cwd],
    }),
    "utf-8",
  );
  writeFileSync(resolve(projDir, "overview.md"), "Overview.\n", "utf-8");

  const tasksDir = resolve(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    resolve(tasksDir, "index.json"),
    JSON.stringify({
      tasks: [
        {
          id: "t1",
          normalizedId: "t1",
          title: "Open task",
          status: "backlog",
          priority: "high",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-01T00:00:00Z",
        },
        {
          id: "t2",
          normalizedId: "t2",
          title: "Done task",
          status: "done",
          priority: "medium",
          createdAt: "2025-01-01T00:00:00Z",
          updatedAt: "2025-01-02T00:00:00Z",
        },
      ],
    }),
    "utf-8",
  );

  const plansDir = resolve(projDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  const plan = {
    id: "p1",
    normalizedId: "p1",
    title: "Active Plan",
    status: "in_progress",
    keywords: [],
    summary: "Active plan summary.",
    file: "plans/p1.md",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
  writeFileSync(resolve(plansDir, "index.json"), JSON.stringify({ plans: [plan] }), "utf-8");
  writeFileSync(resolve(plansDir, "p1.meta.json"), JSON.stringify(plan), "utf-8");

  const knowledgeDir = resolve(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  const k1 = { id: "k1", normalizedId: "k1", title: "A pattern", kind: "pattern", keywords: [], summary: "", file: "knowledge/k1.md", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" };
  const k2 = { id: "k2", normalizedId: "k2", title: "A lesson", kind: "lesson", keywords: [], summary: "", file: "knowledge/k2.md", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" };
  writeFileSync(resolve(knowledgeDir, "index.json"), JSON.stringify({ entries: [k1, k2] }), "utf-8");
  writeFileSync(resolve(knowledgeDir, "k1.meta.json"), JSON.stringify(k1), "utf-8");
  writeFileSync(resolve(knowledgeDir, "k2.meta.json"), JSON.stringify(k2), "utf-8");
}

describe("spoc status", () => {
  it("returns structured JSON with plans, tasks, and knowledge counts", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "status-proj");
      const result = await runCommand("status", ["status-proj", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect(data.project).toBe("Status Test");
      const plans = data.plans as Record<string, number>;
      expect(plans.active).toBe(1);
      expect(plans.done).toBe(0);
      const tasks = data.tasks as Record<string, number>;
      expect(tasks.open).toBe(1);
      expect(tasks.done).toBe(1);
      const knowledge = data.knowledge as Record<string, unknown>;
      expect(knowledge.total).toBe(2);
      const recent = data.recent as Record<string, unknown>;
      expect(recent.next).toBeTruthy();
      const next = recent.next as Record<string, unknown>;
      expect(next.id).toBe("t1");
    });
  });

  it("returns human-readable output without --json", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "status-human");
      const result = await runCommand("status", ["status-human"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.data as string;
      expect(output).toContain("Project: Status Test");
      expect(output).toContain("Plans:");
      expect(output).toContain("Tasks:");
      expect(output).toContain("Knowledge:");
      expect(output).toContain("Recent:");
    });
  });

  it("returns error for unknown project", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("status", ["no-such-proj", "--json"]);
      expect(result.ok).toBe(false);
    });
  });
});
