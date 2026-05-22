import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("validate_project_state", () => {
  it("returns no issues for a healthy project", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const wsDir = resolve(dataDir, "workspace");
      mkdirSync(resolve(wsDir, "src"), { recursive: true });
      writeFileSync(resolve(wsDir, "src/app.ts"), "", "utf-8");
      writeFileSync(resolve(wsDir, "AGENTS.md"), "# AGENTS.md", "utf-8");

      await invokeJsonTool(server, "init_project", {
        name: "Healthy Project",
        description: "Test",
        workspacePaths: [wsDir],
      });

      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "healthy-project",
        title: "Entry One",
        sourceFiles: [{ path: "src/app.ts" }],
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "healthy-project",
      });
      const data = parseResult(result);

      expect(data.issues).toHaveLength(0);
      expect(data.summary.totalChecks).toBeGreaterThan(0);
      expect(data.summary.issueCount).toBe(0);
    });
  });

  it("detects stale knowledge sourceFiles", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const wsDir = resolve(dataDir, "workspace");
      mkdirSync(wsDir, { recursive: true });

      await invokeJsonTool(server, "init_project", {
        name: "Stale Sources",
        description: "Test",
        workspacePaths: [wsDir],
      });

      await invokeJsonTool(server, "create_project_knowledge_entry", {
        slug: "stale-sources",
        title: "Bad Entry",
        sourceFiles: [{ path: "does/not/exist.ts" }],
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "stale-sources",
      });
      const data = parseResult(result);

      const issue = data.issues.find((i: any) => i.kind === "stale_knowledge_source");
      expect(issue).toBeDefined();
      expect(issue.severity).toBe("warning");
      expect(issue.file).toBe("does/not/exist.ts");
      expect(issue.safeToAutoRepair).toBe(false);
    });
  });

  it("detects missing AGENTS.md in workspace paths", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const wsDir = resolve(dataDir, "workspace");
      mkdirSync(wsDir, { recursive: true });
      // No AGENTS.md created

      await invokeJsonTool(server, "init_project", {
        name: "No Agents",
        description: "Test",
        workspacePaths: [wsDir],
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "no-agents",
      });
      const data = parseResult(result);

      const issue = data.issues.find((i: any) => i.kind === "missing_agents_md");
      expect(issue).toBeDefined();
      expect(issue.severity).toBe("info");
      expect(issue.safeToAutoRepair).toBe(true);
    });
  });

  it("detects missing diagram file for plan referencing .diagram.mmd", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      await invokeJsonTool(server, "init_project", {
        name: "Missing Diagram",
        description: "Test",
      });

      // Create a plan — the validator checks if plans/<id>.diagram.mmd exists
      await invokeJsonTool(server, "create_project_plan", {
        slug: "missing-diagram",
        title: "Some Plan",
        status: "in_progress",
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "missing-diagram",
      });
      const data = parseResult(result);

      // Plans in active states (in_progress, planned) should flag missing diagrams
      const issue = data.issues.find((i: any) => i.kind === "missing_plan_diagram");
      expect(issue).toBeDefined();
      expect(issue.severity).toBe("info");
      expect(issue.safeToAutoRepair).toBe(false);
    });
  });

  it("detects invalid diagram file via basic validation", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const projectSlug = "bad-diagram";
      await invokeJsonTool(server, "init_project", {
        name: "Bad Diagram",
        description: "Test",
      });

      await invokeJsonTool(server, "create_project_plan", {
        slug: projectSlug,
        title: "Diagrammed Plan",
        status: "in_progress",
      });

      // Write an invalid diagram file directly
      const plansDir = resolve(dataDir, "projects", projectSlug, "plans");
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(
        resolve(plansDir, "diagrammed-plan.diagram.mmd"),
        "this is not valid mermaid",
        "utf-8",
      );

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: projectSlug,
      });
      const data = parseResult(result);

      const issue = data.issues.find((i: any) => i.kind === "invalid_diagram");
      expect(issue).toBeDefined();
      expect(issue.severity).toBe("warning");
    });
  });

  it("detects plan status inconsistency (all tasks done but plan not done)", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      await invokeJsonTool(server, "init_project", {
        name: "Stale Plan Status",
        description: "Test",
      });

      await invokeJsonTool(server, "create_project_plan", {
        slug: "stale-plan-status",
        title: "Active Plan",
        status: "in_progress",
        planId: "active-plan",
      });

      await invokeJsonTool(server, "create_project_task", {
        slug: "stale-plan-status",
        title: "Task A",
        status: "done",
        planId: "active-plan",
      });

      await invokeJsonTool(server, "create_project_task", {
        slug: "stale-plan-status",
        title: "Task B",
        status: "done",
        planId: "active-plan",
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "stale-plan-status",
      });
      const data = parseResult(result);

      const issue = data.issues.find((i: any) => i.kind === "plan_status_drift");
      expect(issue).toBeDefined();
      expect(issue.severity).toBe("warning");
      expect(issue.repair).toContain("done");
      expect(issue.safeToAutoRepair).toBe(false);
    });
  });

  it("does NOT report plan_status_drift when tasks are done+cancelled (not all done)", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      await invokeJsonTool(server, "init_project", {
        name: "Mixed Terminal",
        description: "Test",
      });

      await invokeJsonTool(server, "create_project_plan", {
        slug: "mixed-terminal",
        title: "Active Plan",
        status: "in_progress",
        planId: "active-plan",
      });

      await invokeJsonTool(server, "create_project_task", {
        slug: "mixed-terminal",
        title: "Task A",
        status: "done",
        planId: "active-plan",
      });

      await invokeJsonTool(server, "create_project_task", {
        slug: "mixed-terminal",
        title: "Task B",
        status: "cancelled",
        planId: "active-plan",
      });

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: "mixed-terminal",
      });
      const data = parseResult(result);

      const issue = data.issues.find((i: any) => i.kind === "plan_status_drift");
      expect(issue).toBeUndefined();
    });
  });

  it("returns error for missing project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      await expect(
        invokeJsonTool(server, "validate_project_state", { slug: "nonexistent" }),
      ).rejects.toThrow("does not exist");
    });
  });

  it("accepts diagram nodes with fewer than 3 digits (T1, T01)", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      const projectSlug = "short-node-ids";
      await invokeJsonTool(server, "init_project", {
        name: "Short Node IDs",
        description: "Test",
      });

      await invokeJsonTool(server, "create_project_plan", {
        slug: projectSlug,
        title: "Short Nodes Plan",
        status: "in_progress",
      });

      // Write a valid diagram with short node IDs (T1, T2)
      const plansDir = resolve(dataDir, "projects", projectSlug, "plans");
      mkdirSync(plansDir, { recursive: true });
      writeFileSync(
        resolve(plansDir, "short-nodes-plan.diagram.mmd"),
        "flowchart TD\n  T1[First task] --> T2[Second task]\n",
        "utf-8",
      );

      const result = await invokeJsonTool(server, "validate_project_state", {
        slug: projectSlug,
      });
      const data = parseResult(result);

      // Should NOT report invalid_diagram for short node IDs
      const diagramIssue = data.issues.find((i: any) => i.kind === "invalid_diagram");
      expect(diagramIssue).toBeUndefined();
    });
  });

  it("is registered in production server (src/index.ts imports)", async () => {
    // Verify the tool is exported and can be registered without error
    const { registerValidateProjectState } = await import(
      "../src/tools/validate-project-state.js"
    );
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const server = new McpServer({ name: "test", version: "0.0.0" });
    expect(() => registerValidateProjectState(server)).not.toThrow();
  });
});
