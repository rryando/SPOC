import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("get_project_diff", () => {
  it("rejects invalid sinceIso", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Diff Test",
        description: "test",
      });

      await expect(
        invokeJsonTool(server, "get_project_diff", {
          slug: "diff-test",
          sinceIso: "not-a-date",
        }),
      ).rejects.toThrow("Invalid sinceIso");
    });
  });

  it("returns error for missing project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await expect(
        invokeJsonTool(server, "get_project_diff", {
          slug: "nonexistent",
          sinceIso: "2020-01-01T00:00:00Z",
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  it("returns empty results when nothing matches", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Empty Diff",
        description: "test",
      });

      // Create entries, then query with a future cutoff
      await invokeJsonTool(server, "create_project_plan", {
        slug: "empty-diff",
        title: "Old Plan",
      });

      const result = await invokeJsonTool(server, "get_project_diff", {
        slug: "empty-diff",
        sinceIso: "2099-01-01T00:00:00Z",
      });
      const data = parseResult(result);

      expect(data.plans).toHaveLength(0);
      expect(data.knowledge).toHaveLength(0);
      expect(data.tasks).toHaveLength(0);
      expect(data.counts.total).toBe(0);
    });
  });

  it("includes entries after cutoff across all 3 surfaces", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Diff Surfaces",
        description: "test",
      });

      // Create one of each
      await invokeJsonTool(server, "create_project_plan", {
        slug: "diff-surfaces",
        title: "Recent Plan",
      });
      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "diff-surfaces",
        title: "Recent Entry",
      });
      await invokeJsonTool(server, "create_project_task", {
        slug: "diff-surfaces",
        title: "Recent Task",
      });

      // Use a past cutoff to include everything
      const result = await invokeJsonTool(server, "get_project_diff", {
        slug: "diff-surfaces",
        sinceIso: "2000-01-01T00:00:00Z",
      });
      const data = parseResult(result);

      expect(data.since).toBe("2000-01-01T00:00:00Z");
      expect(data.plans).toHaveLength(1);
      expect(data.plans[0].planId).toBe("recent-plan");
      expect(data.plans[0].title).toBe("Recent Plan");
      expect(data.plans[0].status).toBe("proposed");
      expect(data.knowledge).toHaveLength(1);
      expect(data.knowledge[0].entryId).toBe("recent-entry");
      expect(data.knowledge[0].kind).toBe("reference");
      expect(data.tasks).toHaveLength(1);
      expect(data.tasks[0].taskId).toBe("recent-task");
      expect(data.counts).toEqual({ plans: 1, knowledge: 1, tasks: 1, total: 3 });
    });
  });

  it("excludes entries before cutoff", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Cutoff Test",
        description: "test",
      });

      // Create entries (they get current timestamps)
      await invokeJsonTool(server, "create_project_plan", {
        slug: "cutoff-test",
        title: "Plan A",
      });

      // Query with future cutoff - should exclude everything
      const result = await invokeJsonTool(server, "get_project_diff", {
        slug: "cutoff-test",
        sinceIso: "2099-12-31T23:59:59Z",
      });
      const data = parseResult(result);

      expect(data.plans).toHaveLength(0);
      expect(data.counts.total).toBe(0);
    });
  });

  it("sorts results by updatedAt descending", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Sort Test",
        description: "test",
      });

      // Create two plans, then update the first one so it has a later updatedAt
      await invokeJsonTool(server, "create_project_plan", {
        slug: "sort-test",
        title: "Plan Alpha",
      });
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 50));
      await invokeJsonTool(server, "create_project_plan", {
        slug: "sort-test",
        title: "Plan Beta",
      });
      await new Promise((r) => setTimeout(r, 50));
      // Update Alpha so it gets the newest updatedAt
      await invokeJsonTool(server, "update_project_plan_meta", {
        slug: "sort-test",
        planId: "plan-alpha",
        summary: "updated",
      });

      const result = await invokeJsonTool(server, "get_project_diff", {
        slug: "sort-test",
        sinceIso: "2000-01-01T00:00:00Z",
      });
      const data = parseResult(result);

      expect(data.plans).toHaveLength(2);
      // Alpha should be first (most recently updated)
      expect(data.plans[0].planId).toBe("plan-alpha");
      expect(data.plans[1].planId).toBe("plan-beta");
      // Verify descending order
      expect(new Date(data.plans[0].updatedAt).getTime()).toBeGreaterThan(
        new Date(data.plans[1].updatedAt).getTime(),
      );
    });
  });
});
