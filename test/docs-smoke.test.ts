import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/cli/spoc-orchestrate.js";

// Resolve relative to project root (one level up from test/)
const root = resolve(import.meta.dirname, "..");

const readme = readFileSync(resolve(root, "README.md"), "utf-8");
const openCodeManagedSpocSection = readme.slice(
  readme.indexOf("### OpenCode Managed SPOC Bundle"),
  readme.indexOf("## CLI Commands"),
);
const orchestrateSkill = readFileSync(resolve(root, "skills/orchestrate.md"), "utf-8");
const updateDocsSkill = readFileSync(resolve(root, "skills/update-docs.md"), "utf-8");
const initSkill = readFileSync(resolve(root, "skills/init-project.md"), "utf-8");
const exploreDagSkill = readFileSync(resolve(root, "skills/explore-dag.md"), "utf-8");
const orchestratePrompt = ORCHESTRATE_PROMPT_TEXT;

describe("docs and skills smoke tests", () => {
  it("README mentions plan create command", () => {
    expect(readme).toContain("spoc plan create");
  });

  it("update-docs skill mentions knowledge entries", () => {
    expect(updateDocsSkill).toContain("knowledge entries");
  });

  it("orchestrate skill mentions MULTI", () => {
    expect(orchestrateSkill).toContain("MULTI");
  });

  it("init skill mentions plans/", () => {
    expect(initSkill).toContain("plans/");
  });

  it("init skill mentions knowledge/", () => {
    expect(initSkill).toContain("knowledge/");
  });

  it("explore-dag skill mentions plan and knowledge indexes", () => {
    expect(exploreDagSkill).toContain("plan and knowledge indexes");
  });

  it("update-docs skill mentions structured plans for feature work", () => {
    expect(updateDocsSkill).toContain("structured plans for feature work");
  });

  it("update-docs skill mentions knowledge.md", () => {
    expect(updateDocsSkill).toContain("knowledge.md");
  });

  it("README mentions Queue / Plan / Memory", () => {
    expect(readme).toContain("Queue / Plan / Memory");
  });

  it("README mentions operating brief", () => {
    expect(readme).toContain("operating brief");
  });

  it("orchestrate prompt mentions queue / plan / memory", () => {
    expect(orchestratePrompt).toContain("queue / plan / memory");
    expect(orchestratePrompt).toContain("**queue** = immediate execution state in `tasks.md`");
    expect(orchestratePrompt).toContain("**plan** = durable multi-step change record");
    expect(orchestratePrompt).toContain("**memory** = durable reusable knowledge");
  });

  it("orchestrate prompt mentions recommended surface", () => {
    expect(orchestratePrompt).toContain("recommended surface");
  });

  it("orchestrate prompt mentions operating brief", () => {
    expect(orchestratePrompt).toContain("operating brief");
    expect(orchestratePrompt).toContain("queue / plan / memory");
  });

  it("orchestrate prompt mentions three-surface model", () => {
    expect(orchestratePrompt).toContain("queue");
    expect(orchestratePrompt).toContain("plan");
    expect(orchestratePrompt).toContain("memory");
  });

  it("README explains that OpenCode setup installs SPOC bundle", () => {
    expect(openCodeManagedSpocSection).toContain(
      "selecting OpenCode in `spoc init` installs",
    );
    expect(openCodeManagedSpocSection).toContain("manager of the active SPOC bundle");
    expect(openCodeManagedSpocSection).toContain(
      "generic SPOC Bundle installs may be replaced",
    );
    expect(openCodeManagedSpocSection).toContain("`spoc config` re-syncs");
    expect(openCodeManagedSpocSection).toContain("orchestrator agent is disabled");
  });

  it("README explains the curated OpenCode runtime bundle", () => {
    expect(openCodeManagedSpocSection).toContain("curated OpenCode runtime bundle");
    expect(openCodeManagedSpocSection).toContain("SPOC Bundle skills remain available");
    expect(openCodeManagedSpocSection).toContain("agent definitions are bundled");
    expect(openCodeManagedSpocSection).toContain("excluded to keep the package lean");
    expect(openCodeManagedSpocSection).toContain(
      "`opencode/spoc/bundle-runtime.json`",
    );
  });
});
