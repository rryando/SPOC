import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool, readResourceText } from "./helpers/test-server.js";

describe("project-resources", () => {
  it("serves project-scoped plan and knowledge resources", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        // Setup: create a project with a plan and a knowledge entry
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test",
        });
        await invokeJsonTool(server, "create_project_plan", {
          slug: "my-project",
          title: "Reduce token cost",
          status: "planned",
          planId: "reduce-token-cost",
          keywords: ["templates"],
          body: "# Reduce token cost\n",
        });
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "my-project",
          title: "Auth flow module",
          kind: "module",
          entryId: "auth-flow-module",
          keywords: ["auth"],
          body: "# Auth flow module\n",
        });

        // Plans index
        const plans = await readResourceText(server, "spoc://projects/my-project/plans");
        const plansData = JSON.parse(plans);
        expect(plansData).toHaveProperty("plans");
        expect(plansData.plans).toHaveLength(1);
        expect(plansData.plans[0].id).toBe("reduce-token-cost");

        // Knowledge index
        const knowledge = await readResourceText(server, "spoc://projects/my-project/knowledge");
        const knowledgeData = JSON.parse(knowledge);
        expect(knowledgeData).toHaveProperty("entries");
        expect(knowledgeData.entries).toHaveLength(1);
        expect(knowledgeData.entries[0].id).toBe("auth-flow-module");

        // Plan body
        const planBody = await readResourceText(
          server,
          "spoc://projects/my-project/plans/reduce-token-cost",
        );
        expect(planBody).toContain("# Reduce token cost");

        // Plan meta
        const planMeta = await readResourceText(
          server,
          "spoc://projects/my-project/plans/reduce-token-cost/meta",
        );
        const planMetaData = JSON.parse(planMeta);
        expect(planMetaData.id).toBe("reduce-token-cost");
        expect(planMetaData.status).toBe("planned");

        // Knowledge body
        const knowledgeBody = await readResourceText(
          server,
          "spoc://projects/my-project/knowledge/auth-flow-module",
        );
        expect(knowledgeBody).toContain("# Auth flow module");

        // Knowledge meta
        const knowledgeMeta = await readResourceText(
          server,
          "spoc://projects/my-project/knowledge/auth-flow-module/meta",
        );
        const knowledgeMetaData = JSON.parse(knowledgeMeta);
        expect(knowledgeMetaData.id).toBe("auth-flow-module");
        expect(knowledgeMetaData.kind).toBe("module");
      } finally {
        await server.close();
      }
    });
  });

  it("existing doc resources still work after reordering", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test",
        });

        // overview falls through to the generic {slug}/{doc} template
        const overview = await readResourceText(server, "spoc://projects/my-project/overview");
        expect(overview).toContain("# My Project");

        // tasks also falls through
        const tasks = await readResourceText(server, "spoc://projects/my-project/tasks");
        expect(tasks).toContain("# Tasks");

        // dependencies also falls through
        const deps = await readResourceText(server, "spoc://projects/my-project/dependencies");
        expect(deps).toContain("# Dependencies");

        // project meta (static resource)
        const meta = await readResourceText(server, "spoc://projects/my-project");
        const metaData = JSON.parse(meta);
        expect(metaData.name).toBe("My Project");
      } finally {
        await server.close();
      }
    });
  });

  it("returns empty index for project with no plans or knowledge", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Empty Project",
          description: "No plans or knowledge",
        });

        const plans = await readResourceText(server, "spoc://projects/empty-project/plans");
        const plansData = JSON.parse(plans);
        expect(plansData.plans).toEqual([]);

        const knowledge = await readResourceText(server, "spoc://projects/empty-project/knowledge");
        const knowledgeData = JSON.parse(knowledge);
        expect(knowledgeData.entries).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });
});
