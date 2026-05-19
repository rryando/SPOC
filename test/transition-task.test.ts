import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearWriteProposals, createWriteProposal, disableWriteGateBypass, enableWriteGateBypass } from "../src/utils/write-gate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse((result as any).content.find((c: any) => c.type === "text").text);
}

describe("transition_project_task", () => {
  it("transitions task status and returns before/after diff", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Trans Project",
          description: "Test transitions",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "trans-project",
          title: "Build feature",
          status: "backlog",
        });

        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "trans-project",
            taskId: "build-feature",
            status: "in_progress",
          }),
        );

        expect(result.taskId).toBe("build-feature");
        expect(result.previousStatus).toBe("backlog");
        expect(result.newStatus).toBe("in_progress");
        expect(result.planUpdate).toBeNull();
        expect(result.diagramUpdate).toBeNull();
      } finally {
        await server.close();
      }
    });
  });

  it("auto-updates plan status to done when all tasks done", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Plan Done Project",
          description: "Test plan auto-done",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "plan-done-project",
          title: "My Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-done-project",
          title: "Task A",
          status: "done",
          planId: "my-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-done-project",
          title: "Task B",
          status: "in_progress",
          planId: "my-plan",
        });

        // Transition Task B to done — should auto-complete plan
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "plan-done-project",
            taskId: "task-b",
            status: "done",
          }),
        );

        expect(result.newStatus).toBe("done");
        expect(result.planUpdate).not.toBeNull();
        expect(result.planUpdate.planId).toBe("my-plan");
        expect(result.planUpdate.previousStatus).toBe("in_progress");
        expect(result.planUpdate.newStatus).toBe("done");
      } finally {
        await server.close();
      }
    });
  });

  it("does not auto-complete plan when tasks are cancelled (not done)", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Plan Cancel Project",
          description: "Test cancelled no auto-done",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "plan-cancel-project",
          title: "Cancel Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-cancel-project",
          title: "Task Done",
          status: "done",
          planId: "cancel-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-cancel-project",
          title: "Task Cancel",
          status: "in_progress",
          planId: "cancel-plan",
        });

        // Transition to cancelled — plan should NOT auto-complete
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "plan-cancel-project",
            taskId: "task-cancel",
            status: "cancelled",
          }),
        );

        expect(result.planUpdate).toBeNull();
      } finally {
        await server.close();
      }
    });
  });

  it("returns diagramUpdate note when diagramNodeId provided but no planId", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "No Plan Diagram",
          description: "Test diagram without plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "no-plan-diagram",
          title: "Orphan Task",
          status: "backlog",
        });

        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "no-plan-diagram",
            taskId: "orphan-task",
            status: "in_progress",
            diagramNodeId: "T001",
          }),
        );

        expect(result.diagramUpdate).not.toBeNull();
        expect(result.diagramUpdate.note).toContain("no planId context");
      } finally {
        await server.close();
      }
    });
  });

  it("does not auto-complete plan when tasks remain incomplete", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Plan Partial Project",
          description: "Test plan stays open",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "plan-partial-project",
          title: "Partial Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-partial-project",
          title: "Task X",
          status: "backlog",
          planId: "partial-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "plan-partial-project",
          title: "Task Y",
          status: "in_progress",
          planId: "partial-plan",
        });

        // Transition Task Y to done — Task X still backlog
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "plan-partial-project",
            taskId: "task-y",
            status: "done",
          }),
        );

        expect(result.planUpdate).toBeNull();
      } finally {
        await server.close();
      }
    });
  });

  it("updates diagram node status when diagramNodeId provided", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Diagram Project",
          description: "Test diagram update",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "diagram-project",
          title: "Diagram Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "diagram-project",
          title: "Diagram Task",
          status: "backlog",
          planId: "diagram-plan",
        });

        // Create a diagram file manually
        const plansDir = resolve(dataDir, "projects", "diagram-project", "plans");
        const diagramPath = resolve(plansDir, "diagram-plan.diagram.mmd");
        const diagramContent = `%% plan: diagram-plan
%% status: T001=backlog
%% ready: T001
%% blocked: none
%% next-action: Start T001

%% node: T001
%% skill: code-agent
%% status: backlog

flowchart TD
  T001[Diagram Task]:::backlog

classDef done fill:#a3e635
classDef inProgress fill:#60a5fa
classDef blocked fill:#f87171
classDef backlog fill:#d1d5db
`;
        writeFileSync(diagramPath, diagramContent);

        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "diagram-project",
            taskId: "diagram-task",
            status: "in_progress",
            planId: "diagram-plan",
            diagramNodeId: "T001",
          }),
        );

        expect(result.diagramUpdate).not.toBeNull();
        expect(result.diagramUpdate.nodeId).toBe("T001");
        expect(result.diagramUpdate.newStatus).toBe("inProgress");

        // Verify diagram file was updated
        const updatedDiagram = readFileSync(diagramPath, "utf-8");
        expect(updatedDiagram).toContain("T001[Diagram Task]:::inProgress");
        expect(updatedDiagram).not.toContain("T001[Diagram Task]:::backlog");
      } finally {
        await server.close();
      }
    });
  });

  it("returns error for invalid status transition target", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Invalid Trans Project",
          description: "Test invalid status",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "invalid-trans-project",
          title: "Some Task",
          status: "backlog",
        });

        await expect(
          invokeJsonTool(server, "transition_project_task", {
            slug: "invalid-trans-project",
            taskId: "some-task",
            status: "invalid_status",
          }),
        ).rejects.toThrow();
      } finally {
        await server.close();
      }
    });
  });

  it("returns ready nodes from diagram after transition", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Ready Nodes Project",
          description: "Test ready nodes",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "ready-nodes-project",
          title: "Ready Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "ready-nodes-project",
          title: "First Task",
          status: "in_progress",
          planId: "ready-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "ready-nodes-project",
          title: "Second Task",
          status: "backlog",
          planId: "ready-plan",
        });

        // Create diagram with T002 blocked by T001
        const plansDir = resolve(dataDir, "projects", "ready-nodes-project", "plans");
        const diagramPath = resolve(plansDir, "ready-plan.diagram.mmd");
        const diagramContent = `%% plan: ready-plan
%% status: T001=inProgress, T002=backlog
%% ready: none
%% blocked: none
%% next-action: No ready tasks

%% node: T001
%% status: inProgress

%% node: T002
%% status: backlog

flowchart TD
  T001[First Task]:::inProgress --> T002[Second Task]:::backlog

classDef done fill:#a3e635
classDef inProgress fill:#60a5fa
classDef blocked fill:#f87171
classDef backlog fill:#d1d5db
`;
        writeFileSync(diagramPath, diagramContent);

        // Complete T001 — T002 should become ready
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "ready-nodes-project",
            taskId: "first-task",
            status: "done",
            planId: "ready-plan",
            diagramNodeId: "T001",
          }),
        );

        expect(result.diagramUpdate).not.toBeNull();
        expect(result.diagramUpdate.readyNodes).toContain("T002");
      } finally {
        await server.close();
      }
    });
  });

  it("edge parsing handles nodes with :::class suffix correctly", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Edge Parse Project",
          description: "Test edge regex",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "edge-parse-project",
          title: "Edge Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "edge-parse-project",
          title: "Alpha",
          status: "in_progress",
          planId: "edge-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "edge-parse-project",
          title: "Beta",
          status: "backlog",
          planId: "edge-plan",
        });

        // Diagram where source node has :::class (the edge parsing bug scenario)
        const plansDir = resolve(dataDir, "projects", "edge-parse-project", "plans");
        const diagramPath = resolve(plansDir, "edge-plan.diagram.mmd");
        const diagramContent = `%% plan: edge-plan
%% status: T001=inProgress, T002=backlog
%% ready: none
%% blocked: none
%% next-action: No ready tasks

%% node: T001
%% status: inProgress

%% node: T002
%% status: backlog

flowchart TD
  T001[Alpha]:::inProgress --> T002[Beta]:::backlog

classDef done fill:#a3e635
classDef inProgress fill:#60a5fa
classDef blocked fill:#f87171
classDef backlog fill:#d1d5db
`;
        writeFileSync(diagramPath, diagramContent);

        // Transition T001 to done — T002 should be ready (proves edge was parsed)
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "edge-parse-project",
            taskId: "alpha",
            status: "done",
            planId: "edge-plan",
            diagramNodeId: "T001",
          }),
        );

        expect(result.diagramUpdate).not.toBeNull();
        expect(result.diagramUpdate.readyNodes).toContain("T002");
      } finally {
        await server.close();
      }
    });
  });

  it("inProgress predecessor does NOT make dependent node ready", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "InProg Dep Project",
          description: "Test inProgress predecessor",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "inprog-dep-project",
          title: "Dep Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "inprog-dep-project",
          title: "Predecessor",
          status: "backlog",
          planId: "dep-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "inprog-dep-project",
          title: "Dependent",
          status: "backlog",
          planId: "dep-plan",
        });

        // T001 inProgress, T002 backlog depends on T001
        const plansDir = resolve(dataDir, "projects", "inprog-dep-project", "plans");
        const diagramPath = resolve(plansDir, "dep-plan.diagram.mmd");
        const diagramContent = `%% plan: dep-plan
%% status: T001=backlog, T002=backlog
%% ready: T001
%% blocked: none
%% next-action: Start T001

%% node: T001
%% status: backlog

%% node: T002
%% status: backlog

flowchart TD
  T001[Predecessor]:::backlog --> T002[Dependent]:::backlog

classDef done fill:#a3e635
classDef inProgress fill:#60a5fa
classDef blocked fill:#f87171
classDef backlog fill:#d1d5db
`;
        writeFileSync(diagramPath, diagramContent);

        // Transition T001 to inProgress — T002 must NOT be ready
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "inprog-dep-project",
            taskId: "predecessor",
            status: "in_progress",
            planId: "dep-plan",
            diagramNodeId: "T001",
          }),
        );

        expect(result.diagramUpdate).not.toBeNull();
        // T002 not ready because T001 is inProgress, not done
        expect(result.diagramUpdate.readyNodes).not.toContain("T002");
        // T001 is no longer backlog so also not ready
        expect(result.diagramUpdate.readyNodes).not.toContain("T001");
      } finally {
        await server.close();
      }
    });
  });

  describe("write-gate integration", () => {
    afterEach(() => {
      clearWriteProposals();
      enableWriteGateBypass();
    });

    it("rejects without confirmationToken", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        try {
          await invokeJsonTool(server, "init_project", {
            name: "Gate Project",
            description: "Test write gate",
          });

          await invokeJsonTool(server, "create_project_task", {
            slug: "gate-project",
            title: "Gated Task",
            status: "backlog",
          });

          // Disable bypass AFTER setup
          disableWriteGateBypass();

          await expect(
            invokeJsonTool(server, "transition_project_task", {
              slug: "gate-project",
              taskId: "gated-task",
              status: "in_progress",
            }),
          ).rejects.toThrow(/write gate required/i);
        } finally {
          enableWriteGateBypass();
          await server.close();
        }
      });
    });

    it("accepts valid confirmationToken", async () => {
      await withTempDataDir(async () => {
        const server = createTestServer();
        try {
          await invokeJsonTool(server, "init_project", {
            name: "Gate Accept Project",
            description: "Test write gate accept",
          });

          await invokeJsonTool(server, "create_project_task", {
            slug: "gate-accept-project",
            title: "Gated Task",
            status: "backlog",
          });

          disableWriteGateBypass();

          const proposal = createWriteProposal({
            slug: "gate-accept-project",
            summary: "transition task",
            operations: ["tool:transition_project_task"],
            ttlMs: 60_000,
          });

          const result = parseResult(
            await invokeJsonTool(server, "transition_project_task", {
              slug: "gate-accept-project",
              taskId: "gated-task",
              status: "in_progress",
              confirmationToken: proposal.token,
            }),
          );

          expect(result.newStatus).toBe("in_progress");
        } finally {
          enableWriteGateBypass();
          await server.close();
        }
      });
    });
  });

  it("tool is registered on the MCP server", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        // Verify by successfully calling the tool (would throw if unregistered)
        await invokeJsonTool(server, "init_project", {
          name: "Reg Test Project",
          description: "Registration test",
        });
        await invokeJsonTool(server, "create_project_task", {
          slug: "reg-test-project",
          title: "Reg Task",
          status: "backlog",
        });
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "reg-test-project",
            taskId: "reg-task",
            status: "in_progress",
          }),
        );
        expect(result.newStatus).toBe("in_progress");
      } finally {
        await server.close();
      }
    });
  });
});
