import { describe, expect, it } from "vitest";
import { type InspectOutput, renderDiagramTree } from "../src/cli/diagram-renderer.js";

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape detection
const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

describe("renderDiagramTree", () => {
  it("renders a linear chain with correct status markers", () => {
    const input: InspectOutput = {
      planId: "test-plan",
      nodes: [
        { id: "T001", label: "First task", status: "done" },
        { id: "T002", label: "Second task", status: "backlog" },
        { id: "T003", label: "Third task", status: "backlog" },
      ],
      edges: [
        { from: "T001", to: "T002" },
        { from: "T002", to: "T003" },
      ],
      ready: ["T002"],
    };

    const output = stripAnsi(renderDiagramTree(input));
    expect(output).toContain("T001");
    expect(output).toContain("T002");
    expect(output).toContain("T003");
    expect(output).toContain("✓");
    expect(output).toContain("READY");
    expect(output).toContain("1/3");
  });

  it("renders a branching DAG with fork and merge connectors", () => {
    const input: InspectOutput = {
      planId: "branch-plan",
      nodes: [
        { id: "T001", label: "Root", status: "done" },
        { id: "T002", label: "Left branch", status: "backlog" },
        { id: "T003", label: "Right branch", status: "backlog" },
        { id: "T004", label: "Merge point", status: "backlog" },
      ],
      edges: [
        { from: "T001", to: "T002" },
        { from: "T001", to: "T003" },
        { from: "T002", to: "T004" },
        { from: "T003", to: "T004" },
      ],
      ready: ["T002", "T003"],
    };

    const output = stripAnsi(renderDiagramTree(input));
    expect(output).toContain("T002");
    expect(output).toContain("T003");
    expect(output).toContain("├─→");
    expect(output).toContain("└─→");
  });

  it("renders all-done with no READY markers and full progress", () => {
    const input: InspectOutput = {
      planId: "done-plan",
      nodes: [
        { id: "T001", label: "A", status: "done" },
        { id: "T002", label: "B", status: "done" },
        { id: "T003", label: "C", status: "done" },
      ],
      edges: [
        { from: "T001", to: "T002" },
        { from: "T002", to: "T003" },
      ],
      ready: [],
    };

    const output = stripAnsi(renderDiagramTree(input));
    expect(output).not.toContain("READY");
    expect(output).toContain("3/3");
  });

  it("renders a single node without crashing", () => {
    const input: InspectOutput = {
      planId: "single",
      nodes: [{ id: "T001", label: "Only node", status: "backlog" }],
      edges: [],
      ready: ["T001"],
    };

    const output = stripAnsi(renderDiagramTree(input));
    expect(output).toContain("T001");
    expect(output).toContain("Only node");
  });

  it("renders empty diagram gracefully", () => {
    const input: InspectOutput = {
      planId: "empty",
      nodes: [],
      edges: [],
      ready: [],
    };

    const output = renderDiagramTree(input);
    expect(output).toBeDefined();
    expect(output).toContain("empty");
  });
});
