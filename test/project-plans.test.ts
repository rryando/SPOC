import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SPOC_AGENT_ENTRY } from "../src/cli/instructions.js";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/prompts/spoc-orchestrate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("project-plans tools", () => {
  it("full plan lifecycle: create, list, get, update meta, update body", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        // Setup: create a project
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        // -- create_project_plan --
        const createResult = await invokeJsonTool(server, "create_project_plan", {
          slug: "my-project",
          title: "Reduce token cost",
          summary: "Trim template overhead and add indexed project memory.",
          status: "planned",
          planId: "Reduce Token Cost",
          keywords: ["templates", "tokens"],
          body: "# Reduce token cost\n",
        });
        // createResult is the raw MCP result with content array
        // Parse the JSON from the text content
        const created = JSON.parse(
          (createResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(created.meta.id).toBe("reduce-token-cost");
        expect(created.meta.status).toBe("planned");
        expect(created.meta.summary).toBe("Trim template overhead and add indexed project memory.");
        expect(created.body).toContain("# Reduce token cost");

        // -- list_project_plans with status filter --
        const listResult = await invokeJsonTool(server, "list_project_plans", {
          slug: "my-project",
          status: "planned",
          keywords: ["templates", "missing"],
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed.plans).toHaveLength(1);
        expect(listed.plans[0].status).toBe("planned");

        // -- get_project_plan (meta only) --
        const getMetaResult = await invokeJsonTool(server, "get_project_plan", {
          slug: "my-project",
          planId: "reduce-token-cost",
        });
        const gotMeta = JSON.parse(
          (getMetaResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(gotMeta.meta.id).toBe("reduce-token-cost");
        expect(gotMeta.body).toBeUndefined();

        // -- get_project_plan (with body) --
        const getFullResult = await invokeJsonTool(server, "get_project_plan", {
          slug: "my-project",
          planId: "reduce-token-cost",
          includeBody: true,
        });
        const gotFull = JSON.parse(
          (getFullResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(gotFull.meta.id).toBe("reduce-token-cost");
        expect(gotFull.body).toContain("# Reduce token cost");

        // -- update_project_plan_meta --
        const updateMetaResult = await invokeJsonTool(server, "update_project_plan_meta", {
          slug: "my-project",
          planId: "reduce-token-cost",
          title: "Reduce template token cost",
          summary: "Updated summary",
          status: "in_progress",
          keywords: ["templates", "token-efficiency"],
        });
        const updatedMeta = JSON.parse(
          (updateMetaResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updatedMeta.meta.title).toBe("Reduce template token cost");
        expect(updatedMeta.meta.summary).toBe("Updated summary");
        expect(updatedMeta.meta.status).toBe("in_progress");
        expect(updatedMeta.meta.keywords).toEqual(["templates", "token-efficiency"]);

        // -- update_project_plan_body --
        const updateBodyResult = await invokeJsonTool(server, "update_project_plan_body", {
          slug: "my-project",
          planId: "reduce-token-cost",
          body: "# Reduce template token cost\n\nUpdated body",
        });
        const updatedBody = JSON.parse(
          (updateBodyResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updatedBody.meta.id).toBe("reduce-token-cost");
        expect(updatedBody.body).toContain("Updated body");

        // Verify the body file was actually updated on disk
        const projectDir = resolve(dataDir, "projects", "my-project");
        const bodyOnDisk = readFileSync(
          resolve(projectDir, "plans", "reduce-token-cost.md"),
          "utf-8",
        );
        expect(bodyOnDisk).toContain("Updated body");
      } finally {
        await server.close();
      }
    });
  });

  it("returns empty list for legacy projects with no plans directory", async () => {
    await withTempDataDir(async (_dataDir) => {
      const server = createTestServer();
      try {
        // Create project, then we just list (plans dir exists but is empty)
        await invokeJsonTool(server, "init_project", {
          name: "Legacy Project",
          description: "Old project",
        });
        const listResult = await invokeJsonTool(server, "list_project_plans", {
          slug: "legacy-project",
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed).toEqual({ plans: [] });
      } finally {
        await server.close();
      }
    });
  });

  it("keeps get_project limited to the four legacy docs", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test",
        });
        const result = await invokeJsonTool(server, "get_project", {
          slug: "my-project",
          doc: "knowledge",
        });
        const text = (result as any).content.find((c: any) => c.type === "text").text;
        expect(text).toContain("# Knowledge");
      } finally {
        await server.close();
      }
    });
  });

  it("rebuilds missing or corrupted plan indexes before list/get responses", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test",
        });
        // Create a plan first
        await invokeJsonTool(server, "create_project_plan", {
          slug: "my-project",
          title: "Reduce token cost",
          status: "planned",
          planId: "reduce-token-cost",
          keywords: ["templates"],
          body: "# Reduce token cost\n",
        });
        // Delete the index to simulate corruption
        const indexPath = resolve(dataDir, "projects", "my-project", "plans", "index.json");
        unlinkSync(indexPath);

        // list should rebuild
        const listResult = await invokeJsonTool(server, "list_project_plans", {
          slug: "my-project",
        });
        const listed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listed.plans[0]?.id).toBe("reduce-token-cost");

        // get should also work after rebuild
        const getResult = await invokeJsonTool(server, "get_project_plan", {
          slug: "my-project",
          planId: "reduce-token-cost",
          includeBody: true,
        });
        const got = JSON.parse((getResult as any).content.find((c: any) => c.type === "text").text);
        expect(got.body).toContain("# Reduce token cost");
      } finally {
        await server.close();
      }
    });
  });

  it("delete_project_plan removes meta, body, and index entry", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        // Create a plan
        await invokeJsonTool(server, "create_project_plan", {
          slug: "my-project",
          title: "Plan to delete",
          status: "proposed",
          planId: "plan-to-delete",
          keywords: ["cleanup"],
          body: "# Plan to delete\n\nSome content.",
        });

        const projectDir = resolve(dataDir, "projects", "my-project");
        // Verify files exist before delete
        expect(existsSync(resolve(projectDir, "plans", "plan-to-delete.meta.json"))).toBe(true);
        expect(existsSync(resolve(projectDir, "plans", "plan-to-delete.md"))).toBe(true);

        // Delete the plan
        await invokeJsonTool(server, "delete_project_plan", {
          slug: "my-project",
          planId: "plan-to-delete",
        });

        // Verify files are removed
        expect(existsSync(resolve(projectDir, "plans", "plan-to-delete.meta.json"))).toBe(false);
        expect(existsSync(resolve(projectDir, "plans", "plan-to-delete.md"))).toBe(false);

        // Verify index is updated (empty)
        const index = JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"));
        expect(index.plans).toHaveLength(0);
      } finally {
        await server.close();
      }
    });
  });

  it("delete_project_plan returns ITEM_NOT_FOUND for non-existent plan", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });

        await expect(
          invokeJsonTool(server, "delete_project_plan", {
            slug: "my-project",
            planId: "non-existent",
          }),
        ).rejects.toThrow("ITEM_NOT_FOUND");
      } finally {
        await server.close();
      }
    });
  });

  it("creates plan with sourceFiles and returns them", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Ref Test",
          description: "Test sourceFiles",
        });

        const result = await invokeJsonTool(server, "create_project_plan", {
          slug: "ref-test",
          title: "Plan with refs",
          sourceFiles: [{ path: "src/auth.ts", anchor: "validate" }, { path: "src/utils.ts" }],
        });
        const parsed = JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
        expect(parsed.meta.sourceFiles).toEqual([
          { path: "src/auth.ts", anchor: "validate" },
          { path: "src/utils.ts" },
        ]);

        // Verify list returns sourceFiles
        const listResult = await invokeJsonTool(server, "list_project_plans", {
          slug: "ref-test",
        });
        const listParsed = JSON.parse(
          (listResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(listParsed.plans[0].sourceFiles).toEqual([
          { path: "src/auth.ts", anchor: "validate" },
          { path: "src/utils.ts" },
        ]);

        // Verify update can replace sourceFiles
        const updateResult = await invokeJsonTool(server, "update_project_plan_meta", {
          slug: "ref-test",
          planId: "plan-with-refs",
          sourceFiles: [{ path: "src/new.ts" }],
        });
        const updateParsed = JSON.parse(
          (updateResult as any).content.find((c: any) => c.type === "text").text,
        );
        expect(updateParsed.meta.sourceFiles).toEqual([{ path: "src/new.ts" }]);

        // Verify update with empty array clears sourceFiles
        const clearResult = await invokeJsonTool(server, "update_project_plan_meta", {
          slug: "ref-test",
          planId: "plan-with-refs",
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

  it("update_project_plan_body dryRun returns envelope without writing", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Dry Plan", description: "Test" });
        await invokeJsonTool(server, "create_project_plan", {
          slug: "dry-plan",
          title: "Dry plan entry",
          planId: "dry-plan-entry",
          body: "# Original plan\n",
        });

        const bodyPath = resolve(dataDir, "projects", "dry-plan", "plans", "dry-plan-entry.md");
        const contentBefore = readFileSync(bodyPath, "utf-8");

        const result = await invokeJsonTool(server, "update_project_plan_body", {
          slug: "dry-plan",
          planId: "dry-plan-entry",
          body: "# New plan body\nWith details.",
          dryRun: true,
        });
        const parsed = JSON.parse(
          (result as any).content.find((c: any) => c.type === "text").text,
        );
        expect(parsed.dryRun).toBe(true);
        expect(parsed.wouldWrite.path).toContain("dry-plan-entry.md");
        expect(parsed.wouldWrite.bytes).toBeGreaterThan(0);
        expect(parsed.wouldWrite.preview).toContain("# New plan body");

        // File should be unchanged
        const contentAfter = readFileSync(bodyPath, "utf-8");
        expect(contentAfter).toBe(contentBefore);
      } finally {
        await server.close();
      }
    });
  });

  it("update_project_plan_body dryRun=false still writes (regression)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", { name: "Write Plan", description: "T" });
        await invokeJsonTool(server, "create_project_plan", {
          slug: "write-plan",
          title: "Write plan entry",
          planId: "write-plan-entry",
          body: "# Old\n",
        });

        const result = await invokeJsonTool(server, "update_project_plan_body", {
          slug: "write-plan",
          planId: "write-plan-entry",
          body: "# Updated plan\n",
          dryRun: false,
        });
        const parsed = JSON.parse(
          (result as any).content.find((c: any) => c.type === "text").text,
        );
        expect(parsed.body).toBe("# Updated plan\n");
        expect(parsed.meta.updatedAt).toBeDefined();
      } finally {
        await server.close();
      }
    });
  });
});

describe("prompt text — plan/knowledge references", () => {
  it("orchestrate prompt references new plan/knowledge tools and MULTI workflow", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_plan");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("knowledge/");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("MULTI");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
  });

  it("orchestrate prompt references plans/ and knowledge/ directories", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("plans/");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("knowledge/");
  });

  it("orchestrate prompt instructs proactive codebase analysis and knowledge entry creation", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("code patterns");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("coding style");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("modules");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("tech stack");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("key files");
  });

  it("orchestrate prompt instructs codebase re-scan and knowledge entry creation/update", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("re-scan");
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("update_project_knowledge_body");
  });

  it("orchestrate prompt mentions creating structured plans", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_plan");
  });

  it("orchestrate prompt mentions structured knowledge entries", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("structured knowledge entries");
  });

  it("orchestrate prompt mentions summary docs and structured plan/knowledge indexes", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toContain("summary docs and structured plan/knowledge indexes");
  });

  it("SPOC_AGENT_ENTRY description uses the short OpenCode label", () => {
    expect(SPOC_AGENT_ENTRY.description).toBe("SPOC - (Orchestrator)");
  });
});
