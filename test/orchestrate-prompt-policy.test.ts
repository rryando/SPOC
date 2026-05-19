import { describe, expect, it } from "vitest";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/prompts/spoc-orchestrate.js";

describe("orchestrate prompt policy — lifecycle tools", () => {
  const LIFECYCLE_TOOLS = [
    "propose_dag_write",
    "apply_dag_write",
    "validate_project_state",
    "transition_project_task",
    "lint_bundle",
    "deploy_opencode_superpowers",
  ];

  for (const tool of LIFECYCLE_TOOLS) {
    it(`references ${tool}`, () => {
      expect(ORCHESTRATE_PROMPT_TEXT).toContain(tool);
    });
  }

  it("SYNC workflow starts with validate_project_state", () => {
    const syncSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow"),
      ORCHESTRATE_PROMPT_TEXT.indexOf("### EXPLORE Workflow"),
    );
    // validate_project_state must appear before the explore sub-agent dispatch
    const validateIdx = syncSection.indexOf("validate_project_state");
    const exploreSubAgentIdx = syncSection.indexOf("Dispatch an explore sub-agent");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(exploreSubAgentIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(exploreSubAgentIdx);
  });

  it("EXECUTE workflow uses transition_project_task for status changes", () => {
    const executeSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow"),
      ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow"),
    );
    expect(executeSection).toContain("transition_project_task");
    // Should mention atomic transition
    expect(executeSection).toMatch(/atomically/i);
  });

  it("write-gates use propose_dag_write and apply_dag_write", () => {
    // All four workflow write-gates should reference the tool-backed flow
    const workflows = ["INIT Workflow", "BRAINSTORM Workflow", "EXECUTE Workflow", "SYNC Workflow"];
    for (const workflow of workflows) {
      const start = ORCHESTRATE_PROMPT_TEXT.indexOf(`### ${workflow}`);
      const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
      const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
      expect(section).toContain("propose_dag_write");
      expect(section).toContain("apply_dag_write");
    }
  });

  it("propose_dag_write appears before apply_dag_write in each workflow", () => {
    const workflows = ["INIT Workflow", "BRAINSTORM Workflow", "EXECUTE Workflow", "SYNC Workflow"];
    for (const workflow of workflows) {
      const start = ORCHESTRATE_PROMPT_TEXT.indexOf(`### ${workflow}`);
      const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
      const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
      const proposeIdx = section.indexOf("propose_dag_write");
      const applyIdx = section.indexOf("apply_dag_write");
      expect(proposeIdx).toBeLessThan(applyIdx);
    }
  });

  it("BRAINSTORM mentions silent to-diagram skill loading before write-gate", () => {
    const start = ORCHESTRATE_PROMPT_TEXT.indexOf("### BRAINSTORM Workflow");
    const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
    const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
    const diagramIdx = section.indexOf("to-diagram");
    const writeGateIdx = section.indexOf("propose_dag_write");
    expect(diagramIdx).toBeGreaterThan(-1);
    expect(writeGateIdx).toBeGreaterThan(-1);
    expect(diagramIdx).toBeLessThan(writeGateIdx);
    // Should mention silent loading
    expect(section).toMatch(/[Ss]ilently.*load.*to-diagram/);
  });

  it("EXECUTE transition_project_task coordinates diagram updates for planId/diagramNodeId", () => {
    const start = ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow");
    const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow");
    const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
    expect(section).toContain("transition_project_task");
    // Must clarify agents should not manually patch diagrams for status transitions
    expect(section).toMatch(/must NOT manually patch.*diagram|agents must NOT.*patch.*\.mmd/i);
  });

  it("expired write tokens require re-proposal, not bypass", () => {
    expect(ORCHESTRATE_PROMPT_TEXT).toMatch(/expired.*re-propose|TTL exceeded.*re-propose/i);
  });

  it("bundle release requires lint_bundle before deploy_opencode_superpowers", () => {
    const bundleSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### Bundle and Release"),
    );
    const lintIdx = bundleSection.indexOf("lint_bundle");
    const deployIdx = bundleSection.indexOf("deploy_opencode_superpowers");
    expect(lintIdx).toBeGreaterThan(-1);
    expect(deployIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(deployIdx);
  });
});
