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
});
