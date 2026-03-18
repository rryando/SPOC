import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_DEFINITIONS } from "../src/agents/definitions.js";
import { BRAINSTORM_PROMPT_TEXT } from "../src/prompts/spoc-brainstorm.js";
import { EXECUTE_PROMPT_TEXT } from "../src/prompts/spoc-execute.js";
import { INIT_PROMPT_TEXT } from "../src/prompts/spoc-init.js";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/prompts/spoc-orchestrate.js";
import { SYNC_PROMPT_TEXT } from "../src/prompts/spoc-sync.js";

// Resolve relative to project root (one level up from test/)
const root = resolve(import.meta.dirname, "..");

const readme = readFileSync(resolve(root, "README.md"), "utf-8");
const orchestrateSkill = readFileSync(resolve(root, "skills/orchestrate.md"), "utf-8");
const updateDocsSkill = readFileSync(resolve(root, "skills/update-docs.md"), "utf-8");
const initSkill = readFileSync(resolve(root, "skills/init-project.md"), "utf-8");
const exploreDagSkill = readFileSync(resolve(root, "skills/explore-dag.md"), "utf-8");
const brainstormPrompt = BRAINSTORM_PROMPT_TEXT("my-project");
const executePrompt = EXECUTE_PROMPT_TEXT("my-project");
const syncPrompt = SYNC_PROMPT_TEXT("my-project");
const initPrompt = INIT_PROMPT_TEXT;
const orchestratePrompt = ORCHESTRATE_PROMPT_TEXT;
const agentDefinitions = JSON.stringify(AGENT_DEFINITIONS);

describe("docs and skills smoke tests", () => {
  it("README mentions create_project_plan tool", () => {
    expect(readme).toContain("create_project_plan");
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

  it("execute prompt mentions recommended surface", () => {
    expect(executePrompt).toContain("recommended surface");
    expect(executePrompt).toContain("tasks.md is the queue surface");
    expect(executePrompt).toContain("structured plans are the plan surface");
    expect(executePrompt).toContain("this is the memory surface");
  });

  it("brainstorm prompt mentions queue items vs multi-step plans", () => {
    expect(brainstormPrompt).toContain("queue items vs multi-step plans");
    expect(brainstormPrompt).toContain("durable memory vs summary-only doc updates");
  });

  it("sync prompt mentions operating brief", () => {
    expect(syncPrompt).toContain("operating brief");
    expect(syncPrompt).toContain("queue / plan / memory");
    expect(syncPrompt).toContain("queue = immediate execution state in tasks.md");
    expect(syncPrompt).toContain("plan = durable multi-step change records");
    expect(syncPrompt).toContain("memory = durable reusable discoveries");
  });

  it("init prompt mentions three-surface model", () => {
    expect(initPrompt).toContain("three-surface model");
    expect(initPrompt).toContain("queue = immediate execution state in `tasks.md`");
    expect(initPrompt).toContain("plan = multi-step work in structured plans");
    expect(initPrompt).toContain("memory = durable reusable knowledge in structured knowledge entries");
  });

  it("agent definitions mention queue, plan, and memory", () => {
    expect(agentDefinitions).toContain("queue, plan, and memory");
  });
});
