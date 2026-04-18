import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("audit_project_knowledge", () => {
  it("returns empty staleEntries when all sourceFiles exist", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      // Create a workspace dir with a real file
      const wsDir = resolve(dataDir, "workspace");
      mkdirSync(resolve(wsDir, "src"), { recursive: true });
      writeFileSync(resolve(wsDir, "src/app.ts"), "", "utf-8");

      // Init project and set workspace path
      await invokeJsonTool(server, "init_project", {
        name: "Fresh Project",
        description: "Test",
        workspacePaths: [wsDir],
      });

      // Create knowledge entry with a sourceFile that exists
      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "fresh-project",
        title: "Entry One",
        sourceFiles: [{ path: "src/app.ts" }],
      });

      const result = await invokeJsonTool(server, "audit_project_knowledge", {
        slug: "fresh-project",
      });
      const data = parseResult(result);

      expect(data.staleEntries).toHaveLength(0);
      expect(data.counts.totalEntries).toBe(1);
      expect(data.counts.totalSourceFiles).toBe(1);
      expect(data.counts.staleCount).toBe(0);
    });
  });

  it("detects stale sourceFile paths", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const wsDir = resolve(dataDir, "workspace");
      mkdirSync(wsDir, { recursive: true });

      await invokeJsonTool(server, "init_project", {
        name: "Stale Project",
        description: "Test",
        workspacePaths: [wsDir],
      });

      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "stale-project",
        title: "Entry Stale",
        sourceFiles: [
          { path: "does/not/exist.ts" },
          { path: "also/missing.ts", anchor: "myFunc" },
        ],
      });

      const result = await invokeJsonTool(server, "audit_project_knowledge", {
        slug: "stale-project",
      });
      const data = parseResult(result);

      expect(data.staleEntries).toHaveLength(1);
      expect(data.staleEntries[0].entryId).toBe("entry-stale");
      expect(data.staleEntries[0].staleFiles).toHaveLength(2);
      expect(data.staleEntries[0].staleFiles[1].anchor).toBe("myFunc");
      expect(data.counts.totalSourceFiles).toBe(2);
      expect(data.counts.staleCount).toBe(2);
    });
  });

  it("returns error for missing project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();

      await expect(
        invokeJsonTool(server, "audit_project_knowledge", { slug: "nonexistent" }),
      ).rejects.toThrow("does not exist");
    });
  });

  it("handles entries with no sourceFiles gracefully", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();

      await invokeJsonTool(server, "init_project", {
        name: "No Sources",
        description: "Test",
      });

      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "no-sources",
        title: "Plain Entry",
        body: "No source files here",
      });

      const result = await invokeJsonTool(server, "audit_project_knowledge", {
        slug: "no-sources",
      });
      const data = parseResult(result);

      expect(data.staleEntries).toHaveLength(0);
      expect(data.counts.totalEntries).toBe(1);
      expect(data.counts.totalSourceFiles).toBe(0);
      expect(data.counts.staleCount).toBe(0);
    });
  });
});
