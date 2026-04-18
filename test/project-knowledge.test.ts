import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/prompts/spoc-orchestrate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("project-knowledge tools", () => {
  it("full knowledge lifecycle: create, list, get, update meta, update body", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        // create_project_knowledge_entry
        const createResult = await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "my-project",
          title: "Auth flow module",
          kind: "module",
          summary: "Explains auth boundaries and state transitions.",
          entryId: "Auth Flow Module",
          keywords: ["auth", "session"],
          body: "# Auth flow module\n",
        });
        const created = JSON.parse(
          (createResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(created.meta.kind).toBe("module");
        expect(created.meta.id).toBe("auth-flow-module");
        expect(created.meta.summary).toBe("Explains auth boundaries and state transitions.");
        expect(created.body).toContain("# Auth flow module");

        // list_project_knowledge_entries with kind and keyword filter
        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", {
          slug: "my-project",
          kind: "module",
          keywords: ["auth", "missing"],
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed.entries).toHaveLength(1);
        expect(listed.entries[0].kind).toBe("module");

        // get_project_knowledge_entry (meta only)
        const getMetaResult = await invokeJsonTool(server, "get_project_knowledge_entry", {
          slug: "my-project",
          entryId: "auth-flow-module",
        });
        const gotMeta = JSON.parse(
          (getMetaResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(gotMeta.meta.id).toBe("auth-flow-module");
        expect(gotMeta.body).toBeUndefined();

        // get_project_knowledge_entry (with body)
        const getFullResult = await invokeJsonTool(server, "get_project_knowledge_entry", {
          slug: "my-project",
          entryId: "auth-flow-module",
          includeBody: true,
        });
        const gotFull = JSON.parse(
          (getFullResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(gotFull.meta.id).toBe("auth-flow-module");
        expect(gotFull.body).toContain("# Auth flow module");

        // update_project_knowledge_meta
        const updateMetaResult = await invokeJsonTool(server, "update_project_knowledge_meta", {
          slug: "my-project",
          entryId: "auth-flow-module",
          title: "Authentication flow module",
          kind: "feature",
          summary: "Updated summary",
          keywords: ["auth", "feature"],
        });
        const updatedMeta = JSON.parse(
          (updateMetaResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updatedMeta.meta.title).toBe("Authentication flow module");
        expect(updatedMeta.meta.kind).toBe("feature");
        expect(updatedMeta.meta.summary).toBe("Updated summary");
        expect(updatedMeta.meta.keywords).toEqual(["auth", "feature"]);

        // update_project_knowledge_body
        const updateBodyResult = await invokeJsonTool(server, "update_project_knowledge_body", {
          slug: "my-project",
          entryId: "auth-flow-module",
          body: "# Authentication flow module\n\nUpdated body",
        });
        const updatedBody = JSON.parse(
          (updateBodyResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updatedBody.meta.id).toBe("auth-flow-module");
        expect(updatedBody.body).toContain("Updated body");

        // Verify disk
        const projectDir = resolve(dataDir, "projects", "my-project");
        const bodyOnDisk = readFileSync(
          resolve(projectDir, "knowledge", "auth-flow-module.md"),
          "utf-8",
        );
        expect(bodyOnDisk).toContain("Updated body");
      } finally {
        await server.close();
      }
    });
  });

  it("returns empty list for legacy projects with no knowledge entries", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Legacy Project",
          description: "Old project",
        });
        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", {
          slug: "legacy-project",
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed).toEqual({ entries: [] });
      } finally {
        await server.close();
      }
    });
  });

  it("keeps update_project_doc limited to the four legacy docs", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "My Project", description: "Test" });
        const result = await invokeJsonTool(server, "update_project_doc", {
          slug: "my-project",
          doc: "knowledge",
          content: "# Knowledge - My Project\n",
        });
        const text = (result as any).content.find((c: any) => c.type === "text").text;
        expect(text).toContain("Updated knowledge");
      } finally {
        await server.close();
      }
    });
  });

  it("update_project_doc dryRun returns envelope without writing", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Dry Doc", description: "Test" });
        const docPath = resolve(dataDir, "projects", "dry-doc", "overview.md");
        const contentBefore = readFileSync(docPath, "utf-8");

        const result = await invokeJsonTool(server, "update_project_doc", {
          slug: "dry-doc",
          doc: "overview",
          content: "# New overview\nWith details.",
          dryRun: true,
        });
        const parsed = JSON.parse(
          (result as any).content.find((c: any) => c.type === "text").text,
        );
        expect(parsed.dryRun).toBe(true);
        expect(parsed.wouldWrite.path).toContain("overview.md");
        expect(parsed.wouldWrite.bytes).toBeGreaterThan(0);
        expect(parsed.wouldWrite.preview).toContain("# New overview");

        // File should be unchanged
        const contentAfter = readFileSync(docPath, "utf-8");
        expect(contentAfter).toBe(contentBefore);
      } finally {
        await server.close();
      }
    });
  });

  it("update_project_doc dryRun=false still writes (regression)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Write Doc", description: "T" });
        const result = await invokeJsonTool(server, "update_project_doc", {
          slug: "write-doc",
          doc: "overview",
          content: "# Updated overview\n",
          dryRun: false,
        });
        const text = (result as any).content.find((c: any) => c.type === "text").text;
        expect(text).toContain("Updated overview");
      } finally {
        await server.close();
      }
    });
  });

  it("rebuilds missing or corrupted knowledge indexes before list/get responses", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "My Project", description: "Test" });
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "my-project",
          title: "Auth flow module",
          kind: "module",
          entryId: "auth-flow-module",
          keywords: ["auth"],
          body: "# Auth flow module\n",
        });
        // Delete index to simulate corruption
        const indexPath = resolve(dataDir, "projects", "my-project", "knowledge", "index.json");
        unlinkSync(indexPath);

        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", {
          slug: "my-project",
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed.entries[0]?.id).toBe("auth-flow-module");

        const getResult = await invokeJsonTool(server, "get_project_knowledge_entry", {
          slug: "my-project",
          entryId: "auth-flow-module",
          includeBody: true,
        });
        const got = JSON.parse((getResult as any).content.find((c: any) => c.type === "text").text);
        expect(got.body).toContain("# Auth flow module");
      } finally {
        await server.close();
      }
    });
  });

  it("delete_project_knowledge_entry removes meta, body, and index entry", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        // Create a knowledge entry
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "my-project",
          title: "Entry to delete",
          kind: "reference",
          entryId: "entry-to-delete",
          keywords: ["cleanup"],
          body: "# Entry to delete\n\nSome content.",
        });

        const projectDir = resolve(dataDir, "projects", "my-project");
        // Verify files exist before delete
        expect(existsSync(resolve(projectDir, "knowledge", "entry-to-delete.meta.json"))).toBe(
          true,
        );
        expect(existsSync(resolve(projectDir, "knowledge", "entry-to-delete.md"))).toBe(true);

        // Delete the entry
        await invokeJsonTool(server, "delete_project_knowledge_entry", {
          slug: "my-project",
          entryId: "entry-to-delete",
        });

        // Verify files are removed
        expect(existsSync(resolve(projectDir, "knowledge", "entry-to-delete.meta.json"))).toBe(
          false,
        );
        expect(existsSync(resolve(projectDir, "knowledge", "entry-to-delete.md"))).toBe(false);

        // Verify index is updated (empty)
        const index = JSON.parse(
          readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"),
        );
        expect(index.entries).toHaveLength(0);
      } finally {
        await server.close();
      }
    });
  });

  it("delete_project_knowledge_entry returns ITEM_NOT_FOUND for non-existent entry", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        await expect(
          invokeJsonTool(server, "delete_project_knowledge_entry", {
            slug: "my-project",
            entryId: "non-existent",
          }),
        ).rejects.toThrow("ITEM_NOT_FOUND");
      } finally {
        await server.close();
      }
    });
  });

  it("update_project_knowledge_body dryRun returns envelope without writing", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Dry Project", description: "Test" });
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "dry-project",
          title: "Dry entry",
          kind: "reference",
          entryId: "dry-entry",
          body: "# Original body\n",
        });

        const bodyPath = resolve(dataDir, "projects", "dry-project", "knowledge", "dry-entry.md");
        const contentBefore = readFileSync(bodyPath, "utf-8");

        const result = await invokeJsonTool(server, "update_project_knowledge_body", {
          slug: "dry-project",
          entryId: "dry-entry",
          body: "# New body content\nWith more text.",
          dryRun: true,
        });
        const parsed = JSON.parse(
          (result as any).content.find((c: any) => c.type === "text").text,
        );
        expect(parsed.dryRun).toBe(true);
        expect(parsed.wouldWrite.path).toContain("dry-entry.md");
        expect(parsed.wouldWrite.bytes).toBeGreaterThan(0);
        expect(parsed.wouldWrite.preview).toContain("# New body content");

        // File should be unchanged
        const contentAfter = readFileSync(bodyPath, "utf-8");
        expect(contentAfter).toBe(contentBefore);
      } finally {
        await server.close();
      }
    });
  });

  it("update_project_knowledge_body dryRun=false still writes (regression)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Write Project", description: "T" });
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "write-project",
          title: "Write entry",
          kind: "reference",
          entryId: "write-entry",
          body: "# Old\n",
        });

        const result = await invokeJsonTool(server, "update_project_knowledge_body", {
          slug: "write-project",
          entryId: "write-entry",
          body: "# Updated body\n",
          dryRun: false,
        });
        const parsed = JSON.parse(
          (result as any).content.find((c: any) => c.type === "text").text,
        );
        expect(parsed.body).toBe("# Updated body\n");
        expect(parsed.meta.updatedAt).toBeDefined();
      } finally {
        await server.close();
      }
    });
  });

  it("creates knowledge entry with sourceFiles and returns them", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "KE Ref Test",
          description: "Test sourceFiles on knowledge",
        });

        const result = await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "ke-ref-test",
          title: "Auth pattern",
          kind: "pattern",
          sourceFiles: [{ path: "src/auth.ts", anchor: "AuthService" }],
        });
        const parsed = JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
        expect(parsed.meta.sourceFiles).toEqual([{ path: "src/auth.ts", anchor: "AuthService" }]);

        // List returns sourceFiles
        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", {
          slug: "ke-ref-test",
        });
        const listParsed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listParsed.entries[0].sourceFiles).toEqual([
          { path: "src/auth.ts", anchor: "AuthService" },
        ]);

        // Update replaces sourceFiles
        const updateResult = await invokeJsonTool(server, "update_project_knowledge_meta", {
          slug: "ke-ref-test",
          entryId: "auth-pattern",
          sourceFiles: [{ path: "src/new-auth.ts" }],
        });
        const updateParsed = JSON.parse(
          (updateResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updateParsed.meta.sourceFiles).toEqual([{ path: "src/new-auth.ts" }]);

        // Update with empty array clears sourceFiles
        const clearResult = await invokeJsonTool(server, "update_project_knowledge_meta", {
          slug: "ke-ref-test",
          entryId: "auth-pattern",
          sourceFiles: [],
        });
        const clearParsed = JSON.parse(
          (clearResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(clearParsed.meta.sourceFiles).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });
});

describe("prompt and agent text — knowledge-specific checks", () => {
  it("orchestrate prompt references knowledge entry tools", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("list_project_knowledge_entries");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("get_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("update_project_knowledge_meta");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("update_project_knowledge_body");
  });

  it("orchestrate prompt references structured knowledge entries for durable discoveries", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("structured knowledge entries");
  });

  it("orchestrate prompt references knowledge tools and workflows", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("knowledge");
  });
});
