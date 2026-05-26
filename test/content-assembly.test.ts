import { describe, expect, it } from "vitest";
import {
  extractBacklogTasks,
  extractDependenciesContent,
  extractInProgressTasks,
  extractOverviewContent,
  stripTaskCheckbox,
} from "../src/utils/content-assembly.js";
import { getTemplatePath, renderTemplate } from "../src/utils/template.js";

/**
 * Guardrail tests for audit finding 10.5.
 *
 * The extractors in content-assembly.ts are structurally coupled to the
 * mustache templates under templates/ — they assume H1 first, then blockquote,
 * then status/repo blocks, then section headers. If the templates
 * drift, the extractors will silently misclassify unpopulated projects as
 * populated (or vice versa).
 *
 * These tests render the real templates with init-project's variable set and
 * assert:
 *   - unmodified rendered template → extractor returns null
 *   - template with real content added → extractor returns that content
 *
 * Any template edit that breaks this pact fails here loudly.
 */

const INIT_VARIABLES = {
  name: "test-project",
  description: "A test project for extractor regression coverage",
  repoUrl: "",
  createdAt: "2026-04-17T00:00:00.000Z",
  dependsOnList: "—",
  statusBlock: "**Status:** draft\n",
  repoBlock: "",
  upstreamBlock: "- None",
};

const INIT_VARIABLES_WITH_REPO = {
  ...INIT_VARIABLES,
  repoUrl: "https://example.com/repo",
  repoBlock: "**Repo:** https://example.com/repo\n",
};

const INIT_VARIABLES_WITH_UPSTREAM = {
  ...INIT_VARIABLES,
  upstreamBlock: "- other-project",
  dependsOnList: "other-project",
};

describe("extractOverviewContent — template coupling guardrail", () => {
  it("returns null for an unmodified rendered project.md template", () => {
    const rendered = renderTemplate(getTemplatePath("project.md.tmpl"), INIT_VARIABLES);

    expect(extractOverviewContent(rendered)).toBeNull();
  });

  it("returns null when the template includes a repo block but no real content", () => {
    const rendered = renderTemplate(getTemplatePath("project.md.tmpl"), INIT_VARIABLES_WITH_REPO);

    expect(extractOverviewContent(rendered)).toBeNull();
  });

  it("returns the meaningful content when a user fills in the Summary section", () => {
    const rendered = renderTemplate(getTemplatePath("project.md.tmpl"), INIT_VARIABLES);
    const populated = rendered.replace(
      "## Summary\n",
      "## Summary\n\nWe ship a DAG-backed project memory server.\n",
    );

    const extracted = extractOverviewContent(populated);

    expect(extracted).not.toBeNull();
    expect(extracted).toContain("We ship a DAG-backed project memory server.");
    // Extractor must strip H1, blockquote, and status/repo blocks
    expect(extracted).not.toContain("# test-project");
    expect(extracted).not.toContain("**Status:**");
  });
});

describe("extractDependenciesContent — template coupling guardrail", () => {
  it("returns null for an unmodified rendered dependency.md template (no upstream)", () => {
    const rendered = renderTemplate(getTemplatePath("dependency.md.tmpl"), INIT_VARIABLES);

    expect(extractDependenciesContent(rendered)).toBeNull();
  });

  it("returns null when upstream is '- None' sentinel", () => {
    const rendered = renderTemplate(getTemplatePath("dependency.md.tmpl"), {
      ...INIT_VARIABLES,
      upstreamBlock: "- None yet",
    });

    expect(extractDependenciesContent(rendered)).toBeNull();
  });

  it("returns content when the project has real upstream deps, with headers downgraded", () => {
    const rendered = renderTemplate(
      getTemplatePath("dependency.md.tmpl"),
      INIT_VARIABLES_WITH_UPSTREAM,
    );

    const extracted = extractDependenciesContent(rendered);

    expect(extracted).not.toBeNull();
    expect(extracted).toContain("- other-project");
    // H1 stripped
    expect(extracted).not.toContain("# Dependencies");
    // ## downgraded to ### so it nests under a parent ## Dependencies header
    expect(extracted).toContain("### Upstream");
    expect(extracted).toContain("### Downstream");
    expect(extracted).not.toMatch(/^## Upstream$/m);
  });
});

describe("extractInProgressTasks / extractBacklogTasks / stripTaskCheckbox", () => {
  const sample = [
    "# Tasks",
    "",
    "## In progress",
    "- [/] Wire up the resolver",
    "- [ ] Backlog item 1",
    "- [x] Completed item",
    "  - [/] Not a top-level in-progress (indented)",
    "- [ ] Backlog item 2",
  ].join("\n");

  it("extracts only `- [/]` lines for in-progress tasks", () => {
    expect(extractInProgressTasks(sample)).toEqual([
      "- [/] Wire up the resolver",
      "  - [/] Not a top-level in-progress (indented)",
    ]);
  });

  it("extracts only `- [ ]` lines for backlog tasks", () => {
    expect(extractBacklogTasks(sample)).toEqual(["- [ ] Backlog item 1", "- [ ] Backlog item 2"]);
  });

  it("strips the checkbox prefix from any status", () => {
    expect(stripTaskCheckbox("- [/] Wire up the resolver")).toBe("Wire up the resolver");
    expect(stripTaskCheckbox("- [ ] Backlog item")).toBe("Backlog item");
    expect(stripTaskCheckbox("- [x] Done item")).toBe("Done item");
  });
});
