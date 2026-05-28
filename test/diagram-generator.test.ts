import { describe, expect, it } from "vitest";
import { generateDiagramFromTasks } from "../src/utils/diagram-generator.js";
import type { TaskMeta } from "../src/utils/project-memory.js";

function makeTask(overrides: Partial<TaskMeta> & { id: string; title: string }): TaskMeta {
  return {
    normalizedId: overrides.id,
    status: "backlog",
    priority: "medium",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as TaskMeta;
}

describe("generateDiagramFromTasks — dependency edges", () => {
  it("no-deps case: produces no arrows and no blocked-by comments", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A" }),
      makeTask({ id: "task-b", title: "Task B" }),
    ];
    const { mmd, nodes } = generateDiagramFromTasks("plan-x", tasks);

    expect(nodes).toHaveLength(2);
    expect(mmd).not.toContain("-->");
    expect(mmd).not.toContain("blocked-by");
    // Both tasks should appear in ready list
    expect(mmd).toContain("%% ready: T001, T002");
    expect(mmd).not.toContain("%% blocked:");
  });

  it("simple chain A→B→C: emits two arrows", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A" }),
      makeTask({ id: "task-b", title: "Task B", dependsOn: ["task-a"] }),
      makeTask({ id: "task-c", title: "Task C", dependsOn: ["task-b"] }),
    ];
    const { mmd } = generateDiagramFromTasks("plan-chain", tasks);

    expect(mmd).toContain("    T001 --> T002");
    expect(mmd).toContain("    T002 --> T003");
    // blocked-by metadata
    expect(mmd).toContain("%% blocked-by: T001");
    expect(mmd).toContain("%% blocked-by: T002");
    // T001 should be ready (no deps), T002 and T003 blocked
    expect(mmd).toMatch(/%% ready: T001/);
    expect(mmd).toMatch(/%% blocked: T002, T003/);
  });

  it("diamond A→C, B→C: emits two arrows into C", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A" }),
      makeTask({ id: "task-b", title: "Task B" }),
      makeTask({ id: "task-c", title: "Task C", dependsOn: ["task-a", "task-b"] }),
    ];
    const { mmd } = generateDiagramFromTasks("plan-diamond", tasks);

    expect(mmd).toContain("    T001 --> T003");
    expect(mmd).toContain("    T002 --> T003");
    expect(mmd).toContain("%% blocked-by: T001, T002");
    expect(mmd).toMatch(/%% ready: T001, T002/);
    expect(mmd).toMatch(/%% blocked: T003/);
  });

  it("dep that is done: downstream task becomes ready", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A", status: "done" }),
      makeTask({ id: "task-b", title: "Task B", dependsOn: ["task-a"] }),
    ];
    const { mmd } = generateDiagramFromTasks("plan-done", tasks);

    // T001 is done, T002 depends on it — T002 should be ready
    expect(mmd).toMatch(/%% ready: T001, T002/);
    expect(mmd).not.toContain("%% blocked:");
    // Arrow still emitted
    expect(mmd).toContain("    T001 --> T002");
  });

  it("node declarations appear before edge declarations in flowchart body", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A" }),
      makeTask({ id: "task-b", title: "Task B", dependsOn: ["task-a"] }),
    ];
    const { mmd } = generateDiagramFromTasks("plan-order", tasks);

    const nodeDecl = mmd.indexOf('T001["Task A"]');
    const edgeDecl = mmd.indexOf("T001 --> T002");
    expect(nodeDecl).toBeGreaterThan(-1);
    expect(edgeDecl).toBeGreaterThan(-1);
    expect(nodeDecl).toBeLessThan(edgeDecl);
  });

  it("edges are sorted deterministically", () => {
    const tasks = [
      makeTask({ id: "task-a", title: "Task A" }),
      makeTask({ id: "task-b", title: "Task B" }),
      makeTask({ id: "task-c", title: "Task C", dependsOn: ["task-b", "task-a"] }),
    ];
    const { mmd } = generateDiagramFromTasks("plan-sort", tasks);

    const t1 = mmd.indexOf("    T001 --> T003");
    const t2 = mmd.indexOf("    T002 --> T003");
    expect(t1).toBeLessThan(t2);
  });
});
