import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/prompts/cc-dag-orchestrate.js";
import { EXECUTE_PROMPT_TEXT } from "../src/prompts/cc-dag-execute.js";
import { AGENT_DEFINITIONS } from "../src/agents/definitions.js";

describe("project-knowledge tools", () => {
  it("full knowledge lifecycle: create, list, get, update meta, update body", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "My Project", description: "Test project" });

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
        const created = JSON.parse((createResult as any).content.find((c: any) => c.type === "text").text);
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
        const listed = JSON.parse((listResult as any).content.find((c: any) => c.type === "text").text);
        expect(listed.entries).toHaveLength(1);
        expect(listed.entries[0].kind).toBe("module");

        // get_project_knowledge_entry (meta only)
        const getMetaResult = await invokeJsonTool(server, "get_project_knowledge_entry", {
          slug: "my-project",
          entryId: "auth-flow-module",
        });
        const gotMeta = JSON.parse((getMetaResult as any).content.find((c: any) => c.type === "text").text);
        expect(gotMeta.meta.id).toBe("auth-flow-module");
        expect(gotMeta.body).toBeUndefined();

        // get_project_knowledge_entry (with body)
        const getFullResult = await invokeJsonTool(server, "get_project_knowledge_entry", {
          slug: "my-project",
          entryId: "auth-flow-module",
          includeBody: true,
        });
        const gotFull = JSON.parse((getFullResult as any).content.find((c: any) => c.type === "text").text);
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
        const updatedMeta = JSON.parse((updateMetaResult as any).content.find((c: any) => c.type === "text").text);
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
        const updatedBody = JSON.parse((updateBodyResult as any).content.find((c: any) => c.type === "text").text);
        expect(updatedBody.meta.id).toBe("auth-flow-module");
        expect(updatedBody.body).toContain("Updated body");

        // Verify disk
        const projectDir = resolve(dataDir, "projects", "my-project");
        const bodyOnDisk = readFileSync(resolve(projectDir, "knowledge", "auth-flow-module.md"), "utf-8");
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
        await invokeJsonTool(server, "init_project", { name: "Legacy Project", description: "Old project" });
        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", { slug: "legacy-project" });
        const listed = JSON.parse((listResult as any).content.find((c: any) => c.type === "text").text);
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

        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", { slug: "my-project" });
        const listed = JSON.parse((listResult as any).content.find((c: any) => c.type === "text").text);
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
});

describe("prompt and agent text — knowledge-specific checks", () => {
  it("orchestrate prompt references knowledge entry tools", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("list_project_knowledge_entries");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("get_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("update_project_knowledge_meta");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("update_project_knowledge_body");
  });

  it("execute prompt references structured knowledge entries for durable discoveries", () => {
    expect(EXECUTE_PROMPT_TEXT("my-project")).toContain("structured knowledge entries");
  });

  it("agent definitions sync-knowledge hint references knowledge", () => {
    expect(AGENT_DEFINITIONS["sync-knowledge"].hint).toContain("knowledge");
  });
});
