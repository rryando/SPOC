import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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
          (createResult as any).content.find((c: any) => c.type === "text").text
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
          (listResult as any).content.find((c: any) => c.type === "text").text
        );
        expect(listed.plans).toHaveLength(1);
        expect(listed.plans[0].status).toBe("planned");

        // -- get_project_plan (meta only) --
        const getMetaResult = await invokeJsonTool(server, "get_project_plan", {
          slug: "my-project",
          planId: "reduce-token-cost",
        });
        const gotMeta = JSON.parse(
          (getMetaResult as any).content.find((c: any) => c.type === "text").text
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
          (getFullResult as any).content.find((c: any) => c.type === "text").text
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
          (updateMetaResult as any).content.find((c: any) => c.type === "text").text
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
          (updateBodyResult as any).content.find((c: any) => c.type === "text").text
        );
        expect(updatedBody.meta.id).toBe("reduce-token-cost");
        expect(updatedBody.body).toContain("Updated body");

        // Verify the body file was actually updated on disk
        const projectDir = resolve(dataDir, "projects", "my-project");
        const bodyOnDisk = readFileSync(resolve(projectDir, "plans", "reduce-token-cost.md"), "utf-8");
        expect(bodyOnDisk).toContain("Updated body");
      } finally {
        await server.close();
      }
    });
  });

  it("returns empty list for legacy projects with no plans directory", async () => {
    await withTempDataDir(async (dataDir) => {
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
          (listResult as any).content.find((c: any) => c.type === "text").text
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
          (listResult as any).content.find((c: any) => c.type === "text").text
        );
        expect(listed.plans[0]?.id).toBe("reduce-token-cost");

        // get should also work after rebuild
        const getResult = await invokeJsonTool(server, "get_project_plan", {
          slug: "my-project",
          planId: "reduce-token-cost",
          includeBody: true,
        });
        const got = JSON.parse(
          (getResult as any).content.find((c: any) => c.type === "text").text
        );
        expect(got.body).toContain("# Reduce token cost");
      } finally {
        await server.close();
      }
    });
  });
});
