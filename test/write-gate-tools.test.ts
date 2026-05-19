import { afterEach, describe, expect, it } from "vitest";
import { clearWriteProposals } from "../src/utils/write-gate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

function getTextContent(result: unknown): string {
  return (result as any).content.find((c: any) => c.type === "text").text;
}

describe("write-gate MCP tools", () => {
  afterEach(() => {
    clearWriteProposals();
  });

  describe("propose_dag_write", () => {
    it("creates a proposal and returns token with metadata", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        // Need a project to propose against
        await invokeJsonTool(server, "init_project", {
          name: "Gate Test",
          description: "For write gate testing",
        });

        const result = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "gate-test",
            summary: "Update overview",
            operations: ["update_project_doc:overview"],
          }),
        );

        expect(result.token).toMatch(/^wp_/);
        expect(result.slug).toBe("gate-test");
        expect(result.summary).toBe("Update overview");
        expect(result.operations).toEqual(["update_project_doc:overview"]);
        expect(result.expiresAt).toBeDefined();
        expect(result.consumedAt).toBeNull();
      });
    });

    it("accepts custom ttlMs", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        await invokeJsonTool(server, "init_project", {
          name: "Gate Test",
          description: "For write gate testing",
        });

        const result = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "gate-test",
            summary: "Quick op",
            operations: ["create_project_task"],
            ttlMs: 5000,
          }),
        );

        const created = new Date(result.createdAt).getTime();
        const expires = new Date(result.expiresAt).getTime();
        expect(expires - created).toBe(5000);
      });
    });

    it("rejects proposal for non-existent project", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();

        await expect(
          invokeJsonTool(server, "propose_dag_write", {
            slug: "no-such-project",
            summary: "Will fail",
            operations: ["update_project_doc:overview"],
          }),
        ).rejects.toThrow(/not found/i);
      });
    });
  });

  describe("apply_dag_write", () => {
    it("consumes a valid token and returns authorized operations", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        await invokeJsonTool(server, "init_project", {
          name: "Gate Test",
          description: "For write gate testing",
        });

        const proposal = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "gate-test",
            summary: "Update overview",
            operations: ["update_project_doc:overview"],
          }),
        );

        const applied = parseResult(
          await invokeJsonTool(server, "apply_dag_write", {
            token: proposal.token,
            slug: "gate-test",
          }),
        );

        expect(applied.consumed).toBe(true);
        expect(applied.operations).toEqual(["update_project_doc:overview"]);
        expect(applied.consumedAt).toBeDefined();
      });
    });

    it("rejects already-consumed token", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        await invokeJsonTool(server, "init_project", {
          name: "Gate Test",
          description: "For write gate testing",
        });

        const proposal = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "gate-test",
            summary: "Update overview",
            operations: ["update_project_doc:overview"],
          }),
        );

        await invokeJsonTool(server, "apply_dag_write", {
          token: proposal.token,
          slug: "gate-test",
        });

        await expect(
          invokeJsonTool(server, "apply_dag_write", {
            token: proposal.token,
            slug: "gate-test",
          }),
        ).rejects.toThrow(/already consumed/i);
      });
    });

    it("rejects unknown token", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        await invokeJsonTool(server, "init_project", {
          name: "Gate Test",
          description: "For write gate testing",
        });

        await expect(
          invokeJsonTool(server, "apply_dag_write", {
            token: "wp_nonexistent",
            slug: "gate-test",
          }),
        ).rejects.toThrow(/not found/i);
      });
    });

    it("rejects token with mismatched slug", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        await invokeJsonTool(server, "init_project", {
          name: "Project A",
          description: "First",
        });
        await invokeJsonTool(server, "init_project", {
          name: "Project B",
          description: "Second",
        });

        const proposal = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "project-a",
            summary: "For A",
            operations: ["update_project_doc:overview"],
          }),
        );

        await expect(
          invokeJsonTool(server, "apply_dag_write", {
            token: proposal.token,
            slug: "project-b",
          }),
        ).rejects.toThrow(/scope mismatch/i);
      });
    });
  });
});
