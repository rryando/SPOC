import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("search_project_knowledge", () => {
  async function seedProject(server: ReturnType<typeof createTestServer>) {
    await invokeJsonTool(server, "init_project", {
      name: "Search Test",
      description: "Test project",
    });

    await invokeJsonTool(server, "create_project_knowledge_entry", {
      slug: "search-test",
      title: "Database Migration Guide",
      summary: "How to run database migrations safely",
      kind: "reference",
      keywords: ["database", "migration"],
    });

    await invokeJsonTool(server, "create_project_knowledge_entry", {
      slug: "search-test",
      title: "API Authentication",
      summary: "Token-based auth for the REST API",
      kind: "pattern",
      keywords: ["auth", "api", "token"],
    });

    await invokeJsonTool(server, "create_project_knowledge_entry", {
      slug: "search-test",
      title: "Deployment Checklist",
      summary: "Steps before deploying to production",
      kind: "reference",
      keywords: ["deploy", "production"],
    });
  }

  it("title hit weighted higher than summary hit", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "database",
      });
      const data = parseResult(result);

      expect(data.results.length).toBe(1);
      // "database" appears in title (×3) + keyword (×2) + summary (×1) = 6
      expect(data.results[0].entryId).toBe("database-migration-guide");
      expect(data.results[0].score).toBe(6);
    });
  });

  it("keyword match contributes to score", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "token",
      });
      const data = parseResult(result);

      // "token" in keywords (×2) + summary (×1) = 3
      expect(data.results.length).toBe(1);
      expect(data.results[0].entryId).toBe("api-authentication");
      expect(data.results[0].score).toBe(3);
    });
  });

  it("kind filter narrows results", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      // "production" matches Deployment Checklist (reference) only
      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "production",
        kind: "pattern",
      });
      const data = parseResult(result);

      // Filtered to kind=pattern, so deployment checklist (reference) excluded
      expect(data.results).toHaveLength(0);
    });
  });

  it("limit truncates results", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      // Query that matches multiple entries
      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "the",
        limit: 1,
      });
      const data = parseResult(result);

      expect(data.results.length).toBeLessThanOrEqual(1);
    });
  });

  it("empty query returns empty results", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "",
      });
      const data = parseResult(result);

      expect(data.results).toHaveLength(0);
      expect(data.totalScanned).toBe(0);
    });
  });

  it("returns error for missing project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();

      await expect(
        invokeJsonTool(server, "search_project_knowledge", {
          slug: "nonexistent",
          query: "test",
        }),
      ).rejects.toThrow("does not exist");
    });
  });

  it("totalScanned reflects entry count before scoring", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await seedProject(server);

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "search-test",
        query: "database",
      });
      const data = parseResult(result);

      expect(data.totalScanned).toBe(3);
    });
  });

  it("unicode: café matches Café Module", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "Unicode Test",
        description: "Test unicode search",
      });
      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "unicode-test",
        title: "Café Module",
        summary: "Module for café features",
        kind: "module",
        keywords: ["café"],
      });

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "unicode-test",
        query: "café",
      });
      const data = parseResult(result);
      expect(data.results.length).toBe(1);
      expect(data.results[0].title).toBe("Café Module");
    });
  });

  it("unicode: CJK query matches CJK title", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await invokeJsonTool(server, "init_project", {
        name: "CJK Test",
        description: "Test CJK search",
      });
      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "cjk-test",
        title: "日本語ガイド",
        summary: "Guide in Japanese 日本語",
        kind: "reference",
        keywords: ["japanese", "guide"],
      });

      const result = await invokeJsonTool(server, "search_project_knowledge", {
        slug: "cjk-test",
        query: "日本語",
      });
      const data = parseResult(result);
      expect(data.results.length).toBe(1);
      expect(data.results[0].title).toBe("日本語ガイド");
    });
  });
});
