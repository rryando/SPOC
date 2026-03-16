import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve relative to project root (one level up from test/)
const root = resolve(import.meta.dirname, "..");

const readme = readFileSync(resolve(root, "README.md"), "utf-8");
const orchestrateSkill = readFileSync(resolve(root, "skills/orchestrate.md"), "utf-8");
const updateDocsSkill = readFileSync(resolve(root, "skills/update-docs.md"), "utf-8");
const initSkill = readFileSync(resolve(root, "skills/init-project.md"), "utf-8");
const exploreDagSkill = readFileSync(resolve(root, "skills/explore-dag.md"), "utf-8");

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
});
