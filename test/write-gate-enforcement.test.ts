import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearWriteProposals, createWriteProposal, disableWriteGateBypass, enableWriteGateBypass } from "../src/utils/write-gate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("write-gate enforcement on DAG tools", () => {
  beforeEach(() => {
    disableWriteGateBypass();
  });

  afterEach(() => {
    clearWriteProposals();
    enableWriteGateBypass();
  });

  // Helper: set up project, return server
  async function setupProject() {
    const server = createTestServer();
    await invokeJsonTool(server, "init_project", {
      name: "Gate Target",
      description: "Project for gating tests",
    });
    return server;
  }

  // Helper: get a valid token
  function getToken(slug: string, operation: string): string {
    const proposal = createWriteProposal({
      slug,
      summary: "test",
      operations: [operation],
      ttlMs: 60_000,
    });
    return proposal.token;
  }

  const GATED_TOOLS: Array<{
    tool: string;
    operation: string;
    args: (token?: string) => Record<string, unknown>;
    setup?: (server: any) => Promise<void>;
  }> = [
    {
      tool: "update_project_doc",
      operation: "tool:update_project_doc",
      args: (token) => ({
        slug: "gate-target",
        doc: "overview",
        content: "# Updated",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "update_project_status",
      operation: "tool:update_project_status",
      args: (token) => ({
        slug: "gate-target",
        status: "active",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "delete_project",
      operation: "tool:delete_project",
      args: (token) => ({
        slug: "gate-target",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "manage_dependency",
      operation: "tool:manage_dependency",
      args: (token) => ({
        slug: "gate-target",
        action: "add",
        targetSlug: "dep-target",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        await invokeJsonTool(server, "init_project", {
          name: "Dep Target",
          description: "dependency target",
        });
      },
    },
    {
      tool: "create_project_plan",
      operation: "tool:create_project_plan",
      args: (token) => ({
        slug: "gate-target",
        title: "Test Plan",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "update_project_plan_meta",
      operation: "tool:update_project_plan_meta",
      args: (token) => ({
        slug: "gate-target",
        planId: "test-plan",
        title: "Updated Plan",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_plan");
        await invokeJsonTool(server, "create_project_plan", {
          slug: "gate-target",
          title: "Test Plan",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "update_project_plan_body",
      operation: "tool:update_project_plan_body",
      args: (token) => ({
        slug: "gate-target",
        planId: "test-plan",
        body: "# New body",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_plan");
        await invokeJsonTool(server, "create_project_plan", {
          slug: "gate-target",
          title: "Test Plan",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "delete_project_plan",
      operation: "tool:delete_project_plan",
      args: (token) => ({
        slug: "gate-target",
        planId: "test-plan",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_plan");
        await invokeJsonTool(server, "create_project_plan", {
          slug: "gate-target",
          title: "Test Plan",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "create_project_knowledge_entry",
      operation: "tool:create_project_knowledge_entry",
      args: (token) => ({
        slug: "gate-target",
        title: "Test Entry",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "update_project_knowledge_meta",
      operation: "tool:update_project_knowledge_meta",
      args: (token) => ({
        slug: "gate-target",
        entryId: "test-entry",
        title: "Updated Entry",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_knowledge_entry");
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "gate-target",
          title: "Test Entry",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "update_project_knowledge_body",
      operation: "tool:update_project_knowledge_body",
      args: (token) => ({
        slug: "gate-target",
        entryId: "test-entry",
        body: "# New body",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_knowledge_entry");
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "gate-target",
          title: "Test Entry",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "delete_project_knowledge_entry",
      operation: "tool:delete_project_knowledge_entry",
      args: (token) => ({
        slug: "gate-target",
        entryId: "test-entry",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_knowledge_entry");
        await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "gate-target",
          title: "Test Entry",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "create_project_task",
      operation: "tool:create_project_task",
      args: (token) => ({
        slug: "gate-target",
        title: "Test Task",
        ...(token && { confirmationToken: token }),
      }),
    },
    {
      tool: "update_project_task",
      operation: "tool:update_project_task",
      args: (token) => ({
        slug: "gate-target",
        taskId: "test-task",
        title: "Updated Task",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_task");
        await invokeJsonTool(server, "create_project_task", {
          slug: "gate-target",
          title: "Test Task",
          confirmationToken: t,
        });
      },
    },
    {
      tool: "delete_project_task",
      operation: "tool:delete_project_task",
      args: (token) => ({
        slug: "gate-target",
        taskId: "test-task",
        ...(token && { confirmationToken: token }),
      }),
      setup: async (server) => {
        const t = getToken("gate-target", "tool:create_project_task");
        await invokeJsonTool(server, "create_project_task", {
          slug: "gate-target",
          title: "Test Task",
          confirmationToken: t,
        });
      },
    },
  ];

  describe("rejects ungated writes", () => {
    for (const { tool, args } of GATED_TOOLS) {
      it(`${tool} rejects without confirmationToken`, async () => {
        await withTempDataDir(async () => {
          const server = await setupProject();
          await expect(invokeJsonTool(server, tool, args())).rejects.toThrow(/write gate required/i);
        });
      });
    }
  });

  describe("accepts valid confirmation tokens", () => {
    for (const { tool, operation, args, setup } of GATED_TOOLS) {
      it(`${tool} succeeds with valid token`, async () => {
        await withTempDataDir(async () => {
          const server = await setupProject();
          if (setup) await setup(server);
          const token = getToken("gate-target", operation);
          // Should not throw
          await invokeJsonTool(server, tool, args(token));
        });
      });
    }
  });

  describe("operation mismatch rejection", () => {
    it("rejects token authorized for wrong operation", async () => {
      await withTempDataDir(async () => {
        const server = await setupProject();
        const token = getToken("gate-target", "tool:delete_project");
        await expect(
          invokeJsonTool(server, "update_project_doc", {
            slug: "gate-target",
            doc: "overview",
            content: "# Hacked",
            confirmationToken: token,
          }),
        ).rejects.toThrow(/operation mismatch/i);
      });
    });
  });

  describe("slug scope rejection", () => {
    it("rejects token scoped to different project", async () => {
      await withTempDataDir(async () => {
        const server = await setupProject();
        await invokeJsonTool(server, "init_project", {
          name: "Other Project",
          description: "Other",
        });
        const token = getToken("other-project", "tool:update_project_doc");
        await expect(
          invokeJsonTool(server, "update_project_doc", {
            slug: "gate-target",
            doc: "overview",
            content: "# Hacked",
            confirmationToken: token,
          }),
        ).rejects.toThrow(/scope mismatch/i);
      });
    });
  });

  describe("single-use enforcement", () => {
    it("rejects reused token", async () => {
      await withTempDataDir(async () => {
        const server = await setupProject();
        const token = getToken("gate-target", "tool:update_project_doc");
        await invokeJsonTool(server, "update_project_doc", {
          slug: "gate-target",
          doc: "overview",
          content: "# First",
          confirmationToken: token,
        });
        await expect(
          invokeJsonTool(server, "update_project_doc", {
            slug: "gate-target",
            doc: "overview",
            content: "# Second",
            confirmationToken: token,
          }),
        ).rejects.toThrow(/already consumed/i);
      });
    });
  });
});
