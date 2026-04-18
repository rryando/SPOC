import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("project-tasks tools", () => {
  it("full task lifecycle: create, list, get, update, delete, verify tasks.md", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        // Setup: create a project
        await invokeJsonTool(server, "init_project", {
          name: "Task Project",
          description: "Test project for tasks",
        });

        // -- create with defaults --
        const create1 = parseResult(
          await invokeJsonTool(server, "create_project_task", {
            slug: "task-project",
            title: "Fix login bug",
          }),
        );
        expect(create1.meta.id).toBe("fix-login-bug");
        expect(create1.meta.status).toBe("backlog");
        expect(create1.meta.priority).toBe("medium");

        // -- create with explicit values --
        const create2 = parseResult(
          await invokeJsonTool(server, "create_project_task", {
            slug: "task-project",
            title: "Add dark mode",
            status: "in_progress",
            priority: "high",
          }),
        );
        expect(create2.meta.id).toBe("add-dark-mode");
        expect(create2.meta.status).toBe("in_progress");
        expect(create2.meta.priority).toBe("high");

        // -- list all --
        const listAll = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "task-project",
          }),
        );
        expect(listAll.tasks).toHaveLength(2);

        // -- list by status --
        const listByStatus = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "task-project",
            status: "in_progress",
          }),
        );
        expect(listByStatus.tasks).toHaveLength(1);
        expect(listByStatus.tasks[0].title).toBe("Add dark mode");

        // -- list by priority --
        const listByPriority = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "task-project",
            priority: "medium",
          }),
        );
        expect(listByPriority.tasks).toHaveLength(1);
        expect(listByPriority.tasks[0].title).toBe("Fix login bug");

        // -- get --
        const got = parseResult(
          await invokeJsonTool(server, "get_project_task", {
            slug: "task-project",
            taskId: "fix-login-bug",
          }),
        );
        expect(got.meta.title).toBe("Fix login bug");

        // -- update --
        const updated = parseResult(
          await invokeJsonTool(server, "update_project_task", {
            slug: "task-project",
            taskId: "fix-login-bug",
            title: "Fix login bug (urgent)",
            status: "done",
            priority: "high",
          }),
        );
        expect(updated.meta.title).toBe("Fix login bug (urgent)");
        expect(updated.meta.status).toBe("done");
        expect(updated.meta.priority).toBe("high");

        // -- verify tasks.md rendered --
        const projectDir = resolve(dataDir, "projects", "task-project");
        const tasksMd = readFileSync(resolve(projectDir, "tasks.md"), "utf-8");
        expect(tasksMd).toContain("# Tasks — Task Project");
        expect(tasksMd).toContain("Add dark mode");
        expect(tasksMd).toContain("Fix login bug (urgent)");

        // -- delete --
        await invokeJsonTool(server, "delete_project_task", {
          slug: "task-project",
          taskId: "add-dark-mode",
        });

        // verify deleted
        const listAfterDelete = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "task-project",
          }),
        );
        expect(listAfterDelete.tasks).toHaveLength(1);
        expect(listAfterDelete.tasks[0].id).toBe("fix-login-bug");
      } finally {
        await server.close();
      }
    });
  });

  it("returns empty list for new project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Empty Project",
          description: "No tasks",
        });
        const result = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "empty-project",
          }),
        );
        expect(result.tasks).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });

  it("duplicate title collision", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Dup Project",
          description: "Test dups",
        });
        await invokeJsonTool(server, "create_project_task", {
          slug: "dup-project",
          title: "Same Task",
        });
        await expect(
          invokeJsonTool(server, "create_project_task", {
            slug: "dup-project",
            title: "Same Task",
          }),
        ).rejects.toThrow("NORMALIZED_ID_COLLISION");
      } finally {
        await server.close();
      }
    });
  });

  it("task not found error", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "NotFound Project",
          description: "Test not found",
        });
        await expect(
          invokeJsonTool(server, "get_project_task", {
            slug: "notfound-project",
            taskId: "nonexistent",
          }),
        ).rejects.toThrow("ITEM_NOT_FOUND");
      } finally {
        await server.close();
      }
    });
  });

  it("creates task with sourceFiles and returns them", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Task Ref Test",
          description: "Test sourceFiles on tasks",
        });

        const result = await invokeJsonTool(server, "create_project_task", {
          slug: "task-ref-test",
          title: "Fix auth bug",
          sourceFiles: [{ path: "src/auth.ts", anchor: "validateToken" }],
        });
        const parsed = parseResult(result);
        expect(parsed.meta.sourceFiles).toEqual([{ path: "src/auth.ts", anchor: "validateToken" }]);

        // List returns sourceFiles
        const listResult = await invokeJsonTool(server, "list_project_tasks", {
          slug: "task-ref-test",
        });
        const listParsed = parseResult(listResult);
        expect(listParsed.tasks[0].sourceFiles).toEqual([
          { path: "src/auth.ts", anchor: "validateToken" },
        ]);

        // Update replaces sourceFiles
        const taskId = parsed.meta.id;
        const updateResult = await invokeJsonTool(server, "update_project_task", {
          slug: "task-ref-test",
          taskId,
          sourceFiles: [{ path: "src/new-auth.ts" }],
        });
        const updateParsed = parseResult(updateResult);
        expect(updateParsed.meta.sourceFiles).toEqual([{ path: "src/new-auth.ts" }]);

        // Update with empty array clears sourceFiles
        const clearResult = await invokeJsonTool(server, "update_project_task", {
          slug: "task-ref-test",
          taskId,
          sourceFiles: [],
        });
        const clearParsed = parseResult(clearResult);
        expect(clearParsed.meta.sourceFiles).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });

  it("create task with valid planId links to plan", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Plan Link Project",
          description: "Test planId on tasks",
        });

        // Create a plan first
        await invokeJsonTool(server, "create_project_plan", {
          slug: "plan-link-project",
          title: "My Plan",
          summary: "A test plan",
        });

        // Create task linked to the plan
        const result = parseResult(
          await invokeJsonTool(server, "create_project_task", {
            slug: "plan-link-project",
            title: "Linked Task",
            planId: "my-plan",
          }),
        );
        expect(result.meta.planId).toBe("my-plan");
      } finally {
        await server.close();
      }
    });
  });

  it("create task with invalid planId returns PLAN_NOT_FOUND", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Bad Plan Project",
          description: "Test invalid planId",
        });

        await expect(
          invokeJsonTool(server, "create_project_task", {
            slug: "bad-plan-project",
            title: "Bad Link Task",
            planId: "nonexistent-plan",
          }),
        ).rejects.toThrow("PLAN_NOT_FOUND");
      } finally {
        await server.close();
      }
    });
  });

  it("update task to set planId", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Update Plan Project",
          description: "Test update planId",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "update-plan-project",
          title: "Target Plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "update-plan-project",
          title: "Task To Link",
        });

        const result = parseResult(
          await invokeJsonTool(server, "update_project_task", {
            slug: "update-plan-project",
            taskId: "task-to-link",
            planId: "target-plan",
          }),
        );
        expect(result.meta.planId).toBe("target-plan");

        // Unset planId with null
        const unsetResult = parseResult(
          await invokeJsonTool(server, "update_project_task", {
            slug: "update-plan-project",
            taskId: "task-to-link",
            planId: null,
          }),
        );
        expect(unsetResult.meta.planId).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });

  it("legacy task without planId loads cleanly", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Legacy Project",
          description: "Test backward compat",
        });

        // Create task without planId (legacy behavior)
        const result = parseResult(
          await invokeJsonTool(server, "create_project_task", {
            slug: "legacy-project",
            title: "Old Task",
          }),
        );
        expect(result.meta.planId).toBeUndefined();
        expect(result.meta.title).toBe("Old Task");

        // Listing also works
        const listResult = parseResult(
          await invokeJsonTool(server, "list_project_tasks", {
            slug: "legacy-project",
          }),
        );
        expect(listResult.tasks).toHaveLength(1);
        expect(listResult.tasks[0].planId).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });

  it("resolve_project_context shows plan title for linked tasks", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Context Project",
          description: "Test context assembly",
          workspacePaths: ["/tmp/test-context-project"],
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "context-project",
          title: "Main Plan",
          summary: "The main plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "context-project",
          title: "Linked Task",
          status: "in_progress",
          planId: "main-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "context-project",
          title: "Unlinked Task",
          status: "backlog",
        });

        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/tmp/test-context-project",
        });
        const text = (result as any).content[0].text;
        expect(text).toContain("Linked Task");
        expect(text).toContain("→ plan: Main Plan");
        expect(text).toContain("Unlinked Task");
        // Unlinked task should NOT have a plan sub-line
        const lines = text.split("\n");
        const unlinkedIdx = lines.findIndex((l: string) => l.includes("Unlinked Task"));
        expect(unlinkedIdx).toBeGreaterThan(-1);
        // Next line after unlinked task should not be a plan line
        if (unlinkedIdx + 1 < lines.length) {
          expect(lines[unlinkedIdx + 1]).not.toContain("→ plan:");
         }
      } finally {
        await server.close();
      }
    });
  });

  it("rejects whitespace-only planId on create", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "PlanId Validation",
          description: "Test planId validation",
        });

        await expect(
          invokeJsonTool(server, "create_project_task", {
            slug: "planid-validation",
            title: "Bad PlanId Task",
            planId: "   ",
          }),
        ).rejects.toThrow();
      } finally {
        await server.close();
      }
    });
  });

  it("rejects empty string planId on create", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "PlanId Empty",
          description: "Test empty planId",
        });

        await expect(
          invokeJsonTool(server, "create_project_task", {
            slug: "planid-empty",
            title: "Empty PlanId Task",
            planId: "",
          }),
        ).rejects.toThrow();
      } finally {
        await server.close();
      }
    });
  });

  it("normalizes planId before lookup on create", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Normalize PlanId",
          description: "Test planId normalization",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "normalize-planid",
          title: "My Plan",
        });

        // Pass unnormalized planId — should still match
        const result = parseResult(
          await invokeJsonTool(server, "create_project_task", {
            slug: "normalize-planid",
            title: "Normalized Task",
            planId: "My Plan",
          }),
        );
        expect(result.meta.planId).toBe("my-plan");
      } finally {
        await server.close();
      }
    });
  });
});
