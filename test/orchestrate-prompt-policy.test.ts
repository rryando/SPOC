import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/cli/spoc-orchestrate.js";
import { CAVEMAN_PREAMBLE, ORCHESTRATE_CAVEMAN_PROMPT_TEXT } from "../src/cli/spoc-orchestrate-caveman.js";

describe("orchestrate prompt policy — lifecycle commands", () => {
  const LIFECYCLE_COMMANDS = [
    "spoc write propose",
    "spoc write apply",
    "spoc validate",
    "spoc task transition",
    "spoc lint-bundle",
    "spoc deploy-superpowers",
  ];

  for (const cmd of LIFECYCLE_COMMANDS) {
    it(`references ${cmd}`, () => {
      expect(ORCHESTRATE_PROMPT_TEXT).toContain(cmd);
    });
  }

  it("SYNC workflow starts with spoc validate before explore sub-agent", () => {
    const syncSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow"),
      ORCHESTRATE_PROMPT_TEXT.indexOf("### EXPLORE Workflow"),
    );
    // spoc validate must appear before the spoc-docs sub-agent delegation
    const validateIdx = syncSection.indexOf("spoc validate");
    const delegateIdx = syncSection.indexOf("Delegate to spoc-docs");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(delegateIdx).toBeGreaterThan(-1);
    expect(validateIdx).toBeLessThan(delegateIdx);
  });

  it("EXECUTE workflow uses spoc task transition for status changes", () => {
    const executeSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow"),
      ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow"),
    );
    expect(executeSection).toContain("spoc task transition");
    // Should mention atomic transition
    expect(executeSection).toMatch(/atomically/i);
  });

  it("write-gates use spoc write propose in all workflows", () => {
    // All four workflow write-gates should reference the CLI write-gate flow
    const workflows = ["INIT Workflow", "BRAINSTORM Workflow", "EXECUTE Workflow", "SYNC Workflow"];
    for (const workflow of workflows) {
      const start = ORCHESTRATE_PROMPT_TEXT.indexOf(`### ${workflow}`);
      const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
      const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
      expect(section).toContain("spoc write propose");
      expect(section).toContain("--token");
    }
  });

  it("spoc write propose and --token both appear in each workflow", () => {
    const workflows = ["INIT Workflow", "BRAINSTORM Workflow", "EXECUTE Workflow", "SYNC Workflow"];
    for (const workflow of workflows) {
      const start = ORCHESTRATE_PROMPT_TEXT.indexOf(`### ${workflow}`);
      const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
      const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
      expect(section).toContain("spoc write propose");
      expect(section).toContain("--token");
    }
  });

  it("BRAINSTORM mentions silent to-diagram skill loading before write-gate", () => {
    const start = ORCHESTRATE_PROMPT_TEXT.indexOf("### BRAINSTORM Workflow");
    const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", start + 1);
    const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
    const diagramIdx = section.indexOf("to-diagram");
    const writeGateIdx = section.indexOf("spoc write propose");
    expect(diagramIdx).toBeGreaterThan(-1);
    expect(writeGateIdx).toBeGreaterThan(-1);
    expect(diagramIdx).toBeLessThan(writeGateIdx);
    // Should mention silent loading
    expect(section).toMatch(/[Ss]ilently.*load.*to-diagram/);
  });

  it("EXECUTE spoc task transition coordinates diagram updates for plan-id/diagram-node-id", () => {
    const start = ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow");
    const end = ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow");
    const section = ORCHESTRATE_PROMPT_TEXT.slice(start, end > start ? end : undefined);
    expect(section).toContain("spoc task transition");
    // Must clarify agents should not manually patch diagrams for status transitions
    expect(section).toMatch(/must NOT manually patch.*diagram|agents must NOT.*patch.*\.mmd/i);
  });

  it("expired write tokens require re-proposal", () => {
    // Token TTL and re-proposal guidance
    expect(ORCHESTRATE_PROMPT_TEXT).toMatch(/TTL|token.*expire|re-propose/i);
  });

  it("bundle release requires lint-bundle before deploy-superpowers", () => {
    const bundleSection = ORCHESTRATE_PROMPT_TEXT.slice(
      ORCHESTRATE_PROMPT_TEXT.indexOf("### Bundle and Release"),
    );
    const lintIdx = bundleSection.indexOf("spoc lint-bundle");
    const deployIdx = bundleSection.indexOf("spoc deploy-superpowers");
    expect(lintIdx).toBeGreaterThan(-1);
    expect(deployIdx).toBeGreaterThan(-1);
    expect(lintIdx).toBeLessThan(deployIdx);
  });
});

describe("orchestrate prompt policy — caveman sub-agent propagation", () => {
  it("caveman preamble contains Sub-Agent Propagation section", () => {
    expect(CAVEMAN_PREAMBLE).toContain("## Sub-Agent Propagation");
  });

  it("propagation block contains exact inheritance header for task tool prompts", () => {
    expect(CAVEMAN_PREAMBLE).toContain("# Caveman Mode (INHERITED from SPOC Caveman orchestrator)");
  });

  it("propagation section references the host task tool", () => {
    expect(CAVEMAN_PREAMBLE).toMatch(/`task`\s*tool/);
  });

  it("caveman carve-outs preserve DAG content as full prose", () => {
    expect(CAVEMAN_PREAMBLE).toMatch(
      /plans.*knowledge.*overviews.*tasks|SPOC DAG.*full prose/i,
    );
  });

  it("caveman carve-outs preserve .mmd diagram files", () => {
    expect(CAVEMAN_PREAMBLE).toContain(".mmd");
  });

  it("combined caveman prompt includes full orchestrate prompt after preamble", () => {
    expect(ORCHESTRATE_CAVEMAN_PROMPT_TEXT).toContain(ORCHESTRATE_PROMPT_TEXT);
    // Preamble comes first
    const preambleIdx = ORCHESTRATE_CAVEMAN_PROMPT_TEXT.indexOf("# Caveman Mode");
    const orchestrateIdx = ORCHESTRATE_CAVEMAN_PROMPT_TEXT.indexOf("You are the orchestration agent");
    expect(preambleIdx).toBeLessThan(orchestrateIdx);
  });
});

describe("orchestrate prompt policy — diagram drift types enumeration", () => {
  it("SYNC workflow lists diagram drift audit in surfaces", () => {
    const syncStart = ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow");
    const syncEnd = ORCHESTRATE_PROMPT_TEXT.indexOf("### ", syncStart + 1);
    const syncSection = ORCHESTRATE_PROMPT_TEXT.slice(syncStart, syncEnd > syncStart ? syncEnd : undefined);

    // SYNC delegates to spoc-docs but still lists audit surfaces including diagrams
    expect(syncSection.toLowerCase()).toContain("diagram");
    expect(syncSection.toLowerCase()).toContain("drift");
    expect(syncSection.toLowerCase()).toContain("spoc-docs");
  });

  it("EXECUTE diagram section references manage-diagram.mjs for regeneration", () => {
    const execStart = ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow");
    const execEnd = ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow");
    const execSection = ORCHESTRATE_PROMPT_TEXT.slice(execStart, execEnd);
    expect(execSection).toContain("manage-diagram.mjs");
  });

  it("EXECUTE references spoc diagram ready for task selection", () => {
    const execStart = ORCHESTRATE_PROMPT_TEXT.indexOf("### EXECUTE Workflow");
    const execEnd = ORCHESTRATE_PROMPT_TEXT.indexOf("### SYNC Workflow");
    const execSection = ORCHESTRATE_PROMPT_TEXT.slice(execStart, execEnd);
    expect(execSection).toContain("spoc diagram ready");
  });
});

describe("orchestrate prompt policy — skill routing coverage", () => {
  const root = resolve(import.meta.dirname, "..");
  const skillsDir = resolve(root, "opencode/spoc/skills");
  const allSkills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  // Skills that are work-mode or support skills routed in the orchestrator
  const ROUTED_SKILLS = [
    "quick-dev",
    "code-agent",
    "test-driven-development",
    "brainstorming",
    "systematic-debugging",
    "requesting-code-review",
    "receiving-code-review",
    "auditing-a-feature",
    "writing-plans",
    "verification-before-completion",
    "finishing-a-development-branch",
    "dispatching-parallel-agents",
    "subagent-driven-development",
    "to-diagram",
    "loop",
  ];

  // Skills that are host-specific, formatting-only, or special-purpose (not routed by orchestrator)
  const NON_ROUTED_EXCEPTIONS = [
    "caveman-commit",    // formatting skill for commit messages
    "caveman-review",    // formatting skill for code review comments
    "aesthetic",         // layering skill loaded by sub-agents for UI work
    "executing-plans",   // session-management skill loaded by sub-agents
    "writing-skills",    // meta-skill for skill authoring
    "using-superpowers", // meta-skill for skill discovery
    "spoc-dashboard",    // optional UI tool
    "architecture-review",   // agent-loaded skill for system-architect
    "knowledge-curation",    // agent-loaded skill for spoc-docs
    "performance-diagnosis", // agent-loaded skill for code-doctor
    "deep-pr-review",        // host-specific skill invoked directly by user PR-review trigger
    "customize-opencode",    // host-specific meta-skill for editing opencode's own config
  ];

  it("every skill on disk is either routed or listed as non-routed exception", () => {
    const allAccounted = [...ROUTED_SKILLS, ...NON_ROUTED_EXCEPTIONS].sort();
    const unaccounted = allSkills.filter((s) => !allAccounted.includes(s));
    expect(unaccounted).toEqual([]);
  });

  it("routed work-mode skills appear in orchestrator prompt", () => {
    const workModeSkills = ["quick-dev", "code-agent", "test-driven-development", "brainstorming"];
    for (const skill of workModeSkills) {
      expect(ORCHESTRATE_PROMPT_TEXT).toContain(skill);
    }
  });

  it("routed support skills appear in orchestrator prompt", () => {
    const supportSkills = [
      "systematic-debugging",
      "requesting-code-review",
      "receiving-code-review",
      "auditing-a-feature",
      "writing-plans",
      "verification-before-completion",
      "finishing-a-development-branch",
      "dispatching-parallel-agents",
      "subagent-driven-development",
    ];
    for (const skill of supportSkills) {
      expect(ORCHESTRATE_PROMPT_TEXT).toContain(skill);
    }
  });
});
