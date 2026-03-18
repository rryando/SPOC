import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

/** Helper to extract text from MCP tool result */
function resultText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }> };
  return r.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
}

describe("resolve_project_context", () => {
  it("resolves project context from matching workspace path", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My App",
          description: "A great application",
          workspacePaths: ["/Users/ryan/my-app"],
        });

        // Update overview with real content
        await invokeJsonTool(server, "update_project_doc", {
          slug: "my-app",
          doc: "overview",
          content:
            "# My App\n\n> A great application\n\n## Summary\n\nThis app does great things.\n\n## Goals\n\n- Be great\n\n## Current Focus\n\nShipping v1",
        });

        const result = await invokeJsonTool(
          server,
          "resolve_project_context",
          { workspacePath: "/Users/ryan/my-app/src" }
        );

        const text = resultText(result);
        expect(text).toContain("# Project Context: My App");
        expect(text).toContain("> A great application");
        expect(text).toContain("## Overview");
        expect(text).toContain("This app does great things.");
      } finally {
        await server.close();
      }
    });
  });

  it("returns no-match error when workspace path not registered", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Registered",
          description: "test",
          workspacePaths: ["/Users/ryan/registered"],
        });

        await expect(
          invokeJsonTool(server, "resolve_project_context", {
            workspacePath: "/Users/ryan/unregistered",
          })
        ).rejects.toThrow("NO_PROJECT_MATCH");
      } finally {
        await server.close();
      }
    });
  });

  it("returns ambiguous-match error for same-depth conflicts", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Project A",
          description: "first",
          workspacePaths: ["/same/path"],
        });
        await invokeJsonTool(server, "init_project", {
          name: "Project B",
          description: "second",
          workspacePaths: ["/same/path"],
        });

        await expect(
          invokeJsonTool(server, "resolve_project_context", {
            workspacePath: "/same/path/sub",
          })
        ).rejects.toThrow("AMBIGUOUS_PROJECT_MATCH");
      } finally {
        await server.close();
      }
    });
  });

  it("rejects relative paths", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await expect(
          invokeJsonTool(server, "resolve_project_context", {
            workspacePath: "relative/path",
          })
        ).rejects.toThrow("INVALID_WORKSPACE_PATH");
      } finally {
        await server.close();
      }
    });
  });

  it("uses the policy-selected task in Current Focus and Operating Brief", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Task App",
          description: "task test",
          workspacePaths: ["/Users/ryan/task-app"],
        });

        await invokeJsonTool(server, "update_project_doc", {
          slug: "task-app",
          doc: "tasks",
          content:
            "# Tasks\n\n## In Progress\n\n- [/] Build the API\n- [/] Write tests\n\n## Backlog\n\n- [ ] Deploy\n\n## Done\n\n- [x] Setup project",
        });

        const result = await invokeJsonTool(
          server,
          "resolve_project_context",
          { workspacePath: "/Users/ryan/task-app" }
        );

        const text = resultText(result);
        expect(text).toContain("## Operating Brief");
        expect(text).toContain("**Current Focus:** Build the API");
        expect(text).toContain("**Recommended Surface:** queue");
        expect(text).toContain("**Why:** This is best tracked as immediate execution state.");
        expect(text).toContain("**Next Action:** Continue the queue item \"Build the API\"");
        expect(text).toContain("## Current Focus");
        expect(text).toContain("- Build the API");
        expect(text).not.toContain("- Write tests");
        expect(text).not.toContain("- [ ] Deploy");
        expect(text).not.toContain("- [x] Setup project");
      } finally {
        await server.close();
      }
    });
  });

  it("omits sections with no meaningful content", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        // Create project with default template content (no real data)
        await invokeJsonTool(server, "init_project", {
          name: "Empty App",
          description: "An empty project",
          workspacePaths: ["/Users/ryan/empty-app"],
        });

        const result = await invokeJsonTool(
          server,
          "resolve_project_context",
          { workspacePath: "/Users/ryan/empty-app" }
        );

        const text = resultText(result);
        expect(text).toContain("# Project Context: Empty App");
        expect(text).toContain("> An empty project");
        // Should omit empty sections
        expect(text).not.toContain("## Overview");
        expect(text).not.toContain("## Current Focus");
        expect(text).not.toContain("## Key Knowledge");
        expect(text).not.toContain("## Active Plans");
      } finally {
        await server.close();
      }
    });
  });

  it("includes knowledge entries and active plans", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Full App",
          description: "Full context test",
          workspacePaths: ["/Users/ryan/full-app"],
        });

        // Create a knowledge entry
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "full-app",
          title: "API Architecture",
          kind: "architecture",
          summary: "REST API with Express and Zod validation",
        });

        // Create an active plan
        await invokeJsonTool(server, "create_project_plan", {
          slug: "full-app",
          title: "Auth System",
          summary: "Implement JWT-based authentication",
          status: "in_progress",
        });

        // Create a done plan (should not appear)
        await invokeJsonTool(server, "create_project_plan", {
          slug: "full-app",
          title: "Old Plan",
          summary: "Already completed",
          status: "done",
        });

        const result = await invokeJsonTool(
          server,
          "resolve_project_context",
          { workspacePath: "/Users/ryan/full-app" }
        );

        const text = resultText(result);
        expect(text).toContain("## Operating Brief");
        expect(text).toContain("**Current Focus:** Auth System");
        expect(text).toContain("**Recommended Surface:** memory");
        expect(text).toContain("**Why:** This should outlive the current task and be reusable later.");
        expect(text).toContain("**Next Action:**");
        expect(text).toContain("## Key Knowledge");
        expect(text).toContain("API Architecture");
        expect(text).toContain("REST API with Express and Zod validation");
        expect(text).toContain("## Active Plans");
        expect(text).toContain("Auth System");
        expect(text).toContain("Implement JWT-based authentication");
        expect(text).not.toContain("Old Plan");
      } finally {
        await server.close();
      }
    });
  });

  it("orders knowledge with valid timestamps ahead of invalid timestamps", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Knowledge Order",
          description: "Ordering test",
          workspacePaths: ["/Users/ryan/knowledge-order"],
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "knowledge-order",
          title: "First Note",
          kind: "reference",
          summary: "Has invalid updatedAt",
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "knowledge-order",
          title: "Second Note",
          kind: "reference",
          summary: "Has valid updatedAt",
        });

        const projectDir = resolve(dataDir, "projects", "knowledge-order");
        const knowledgeDir = resolve(projectDir, "knowledge");
        const indexPath = resolve(knowledgeDir, "index.json");

        const index = JSON.parse(readFileSync(indexPath, "utf-8")) as {
          entries: Array<{ id: string; updatedAt: string }>;
        };

        index.entries = index.entries.map((entry) => ({
          ...entry,
          updatedAt:
            entry.id === "first-note"
              ? "not-a-date"
              : "2026-03-18T00:00:00.000Z",
        }));
        writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf-8");

        for (const entry of index.entries) {
          const metaPath = resolve(knowledgeDir, `${entry.id}.meta.json`);
          const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as {
            updatedAt: string;
          };
          meta.updatedAt = entry.updatedAt;
          writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf-8");
        }

        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/Users/ryan/knowledge-order",
        });

        const text = resultText(result);
        expect(text.indexOf("Second Note")).toBeLessThan(text.indexOf("First Note"));
      } finally {
        await server.close();
      }
    });
  });

  it("handles projects without workspacePaths field (backward compat)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        // Create a project without workspacePaths (simulates old projects)
        // Then try to resolve — should get no match, not crash
        await invokeJsonTool(server, "init_project", {
          name: "Legacy Project",
          description: "No workspace paths",
        });

        await expect(
          invokeJsonTool(server, "resolve_project_context", {
            workspacePath: "/any/path",
          })
        ).rejects.toThrow("NO_PROJECT_MATCH");
      } finally {
        await server.close();
      }
    });
  });
});
