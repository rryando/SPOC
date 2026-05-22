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

describe("resolve_project_context — task-scoped knowledge", () => {
  it("includes task-relevant knowledge entries when taskId is provided", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Scoped App",
          description: "test task-scoped retrieval",
          workspacePaths: ["/Users/test/scoped-app"],
        });

        // Create knowledge entries with distinct topics
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "scoped-app",
          title: "Database Migration Guide",
          summary: "How to run database migrations",
          keywords: ["database", "migration", "schema"],
          kind: "reference",
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "scoped-app",
          title: "API Authentication",
          summary: "JWT token flow for API auth",
          keywords: ["api", "auth", "jwt"],
          kind: "pattern",
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "scoped-app",
          title: "Frontend Routing",
          summary: "How client-side routing works",
          keywords: ["frontend", "routing", "react"],
          kind: "pattern",
        });

        // Create a task related to database work
        const taskResult = await invokeJsonTool(server, "create_project_task", {
          slug: "scoped-app",
          title: "Add database migration for user table schema",
          sourceFiles: [{ path: "src/db/migrations/001-users.ts" }],
        });
        const taskId = (taskResult as any).content[0].text.match(
          /normalizedId.*?["']([^"']+)["']/,
        )?.[1];

        // Resolve with taskId — database entry should be prioritized
        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/Users/test/scoped-app",
          taskId: taskId ?? "add-database-migration-for-user-table-schema",
        });

        const text = resultText(result);
        expect(text).toContain("## Key Knowledge");
        expect(text).toContain("Database Migration Guide");
      } finally {
        await server.close();
      }
    });
  });

  it("falls back to default behavior when taskId is not found", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Fallback App",
          description: "test fallback",
          workspacePaths: ["/Users/test/fallback-app"],
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "fallback-app",
          title: "Some Knowledge",
          summary: "Important info",
          keywords: ["test"],
          kind: "reference",
        });

        // Use invalid taskId — should not error, should still show knowledge
        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/Users/test/fallback-app",
          taskId: "nonexistent-task-id",
        });

        const text = resultText(result);
        expect(text).toContain("## Key Knowledge");
        expect(text).toContain("Some Knowledge");
      } finally {
        await server.close();
      }
    });
  });

  it("returns same output without taskId as before (backward compat)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Compat App",
          description: "backward compat test",
          workspacePaths: ["/Users/test/compat-app"],
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "compat-app",
          title: "Entry One",
          summary: "First entry",
          keywords: ["one"],
          kind: "reference",
        });

        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "compat-app",
          title: "Entry Two",
          summary: "Second entry",
          keywords: ["two"],
          kind: "reference",
        });

        // Without taskId
        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/Users/test/compat-app",
        });

        const text = resultText(result);
        expect(text).toContain("## Key Knowledge");
        expect(text).toContain("Entry One");
        expect(text).toContain("Entry Two");
      } finally {
        await server.close();
      }
    });
  });

  it("deduplicates entries when task-relevant overlaps with recency", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Dedup App",
          description: "dedup test",
          workspacePaths: ["/Users/test/dedup-app"],
        });

        // Create a single entry
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "dedup-app",
          title: "Auth Pattern",
          summary: "Authentication pattern details",
          keywords: ["auth", "pattern"],
          kind: "pattern",
        });

        // Create task matching that entry
        await invokeJsonTool(server, "create_project_task", {
          slug: "dedup-app",
          title: "Implement auth pattern for new endpoint",
        });

        const result = await invokeJsonTool(server, "resolve_project_context", {
          workspacePath: "/Users/test/dedup-app",
          taskId: "implement-auth-pattern-for-new-endpoint",
        });

        const text = resultText(result);
        // Should only appear once
        const count = (text.match(/Auth Pattern/g) || []).length;
        expect(count).toBe(1);
      } finally {
        await server.close();
      }
    });
  });
});
