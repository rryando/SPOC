// ---------------------------------------------------------------------------
// Tests for `arcs done` command
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./helpers/cli-runner.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";

function seedProject(dir: string, slug: string, opts?: { tasks?: unknown[]; plans?: unknown[] }) {
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
  writeFileSync(resolve(projDir, "overview.md"), "Overview content.\n", "utf-8");

  const tasksDir = resolve(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const tasks = opts?.tasks ?? [
    {
      id: "t1",
      normalizedId: "t1",
      title: "Implement feature X",
      status: "backlog",
      priority: "high",
      planId: "p1",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    {
      id: "t2",
      normalizedId: "t2",
      title: "Write tests",
      status: "backlog",
      priority: "medium",
      planId: "p1",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ];
  writeFileSync(resolve(tasksDir, "index.json"), JSON.stringify({ tasks }), "utf-8");

  const plansDir = resolve(projDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  const plans = opts?.plans ?? [
    {
      id: "p1",
      normalizedId: "p1",
      title: "Feature Plan",
      status: "in_progress",
      keywords: [],
      summary: "This plan implements feature X.",
      file: "plans/p1.md",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
  ];
  writeFileSync(resolve(plansDir, "index.json"), JSON.stringify({ plans }), "utf-8");
  for (const p of plans as Array<{ normalizedId: string } & Record<string, unknown>>) {
    writeFileSync(resolve(plansDir, `${p.normalizedId}.meta.json`), JSON.stringify(p), "utf-8");
  }

  const knowledgeDir = resolve(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(resolve(knowledgeDir, "index.json"), JSON.stringify({ entries: [] }), "utf-8");
}

describe("arcs done", () => {
  it("marks task as done and returns next task as JSON", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "test-proj");
      const result = await runCommand("done", ["test-proj", "t1", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      const completed = data.completed as Record<string, unknown>;
      expect(completed.id).toBe("t1");
      expect(completed.title).toBe("Implement feature X");
      const next = data.next as Record<string, unknown>;
      expect(next).not.toBeNull();
      expect(next.id).toBe("t2");
      expect(next.title).toBe("Write tests");
    });
  });

  it("returns null next when last open task is completed", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "single-proj", {
        tasks: [
          {
            id: "t1",
            normalizedId: "t1",
            title: "Only task",
            status: "backlog",
            priority: "medium",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
        plans: [],
      });
      const result = await runCommand("done", ["single-proj", "t1", "--json"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const data = result.data as Record<string, unknown>;
      expect((data.completed as Record<string, unknown>).id).toBe("t1");
      expect(data.next).toBeNull();
    });
  });

  it("returns human-readable output with next task", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "human-proj");
      const result = await runCommand("done", ["human-proj", "t1"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.data as string;
      expect(output).toContain("✓ Done: Implement feature X");
      expect(output).toContain("Next: Write tests");
      expect(output).toContain("Run: arcs done human-proj t2");
    });
  });

  it("returns all-done message when no tasks remain", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "final-proj", {
        tasks: [
          {
            id: "last",
            normalizedId: "last",
            title: "Last task",
            status: "backlog",
            priority: "medium",
            createdAt: "2025-01-01T00:00:00Z",
            updatedAt: "2025-01-01T00:00:00Z",
          },
        ],
        plans: [],
      });
      const result = await runCommand("done", ["final-proj", "last"]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const output = result.data as string;
      expect(output).toContain("✓ Done: Last task");
      expect(output).toContain("All tasks complete");
    });
  });

  it("returns error for unknown task ID", async () => {
    await withTempDataDir(async (dir) => {
      seedProject(dir, "err-proj");
      const result = await runCommand("done", ["err-proj", "nonexistent-task", "--json"]);
      expect(result.ok).toBe(false);
    });
  });

  it("returns error for unknown project slug", async () => {
    await withTempDataDir(async () => {
      const result = await runCommand("done", ["no-such-proj", "t1", "--json"]);
      expect(result.ok).toBe(false);
    });
  });
});
