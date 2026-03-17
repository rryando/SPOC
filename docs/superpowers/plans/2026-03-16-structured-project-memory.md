# Structured Project Memory Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add token-efficient structured plan and knowledge storage to each cc-dag project, while updating templates, MCP tools/resources, prompts, skills, and agent metadata to use the new model consistently.

**Architecture:** Keep the existing four core docs backward-compatible, but make them leaner and add two project-scoped indexed subresource families: `plans/` and `knowledge/`. Put the durable filesystem logic in shared utilities, keep MCP tools/resources thin, and add a minimal Vitest harness so implementation can follow TDD instead of manual spot checks.

**Tech Stack:** TypeScript, Node.js, MCP SDK, Zod, Vitest

---

## Chunk 1: Test Harness and Shared Filesystem Model

### Task 1: Add a real test harness before changing behavior

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `test/helpers/temp-data-dir.ts`
- Create: `test/helpers/test-server.ts`
- Create: `test/init-project.test.ts`

- [ ] **Step 1: Add failing test coverage for project initialization behavior**

```ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTestServer, invokeJsonTool } from "./helpers/test-server";
import { withTempDataDir } from "./helpers/temp-data-dir";

describe("init_project", () => {
  it("creates lean docs plus empty plans and knowledge indexes", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      await invokeJsonTool(server, "init_project", {
        name: "My Project",
        description: "A concise test project",
      });

      const projectDir = resolve(dataDir, "projects", "my-project");
      expect(JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))).toEqual({ plans: [] });
      expect(JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))).toEqual({ entries: [] });
      const overview = readFileSync(resolve(projectDir, "overview.md"), "utf-8");
      expect(overview).toContain("## Current Focus");
      expect(overview).not.toContain("**Repo:**");
    });
  });
});
```

- [ ] **Step 2: Run the new test file to verify the repo cannot pass it yet**

Run: `npm test -- test/init-project.test.ts`
Expected: FAIL because no `test` script / Vitest setup exists yet.

- [ ] **Step 3: Add the minimal test harness**

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^3.2.0"
  }
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
```

- [ ] **Step 4: Create reusable test helpers for temp data dirs and server setup**

```ts
// test/helpers/temp-data-dir.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function withTempDataDir(run: (dir: string) => Promise<void> | void): Promise<void> | void {
  const dir = mkdtempSync(join(tmpdir(), "cc-dag-test-"));
  const previous = process.env.CC_DAG_DATA_DIR;
  process.env.CC_DAG_DATA_DIR = dir;

  const finish = () => {
    if (previous == null) delete process.env.CC_DAG_DATA_DIR;
    else process.env.CC_DAG_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  };

  try {
    const result = run(dir);
    if (result instanceof Promise) return result.finally(finish);
    finish();
  } catch (error) {
    finish();
    throw error;
  }
}
```

```ts
// test/helpers/test-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ensureDataDir } from "../../src/utils/paths.js";
import { registerInitProject } from "../../src/tools/init-project.js";
import { registerUpdateDoc } from "../../src/tools/update-doc.js";
import { registerUpdateStatus } from "../../src/tools/update-status.js";
import { registerManageDependency } from "../../src/tools/manage-dependency.js";
import { registerListProjects } from "../../src/tools/list-projects.js";
import { registerGetProject } from "../../src/tools/get-project.js";

export function createTestServer(): McpServer {
  ensureDataDir();
  const server = new McpServer({ name: "cc-dag-test", version: "1.0.0" });
  registerInitProject(server);
  registerUpdateDoc(server);
  registerUpdateStatus(server);
  registerManageDependency(server);
  registerListProjects(server);
  registerGetProject(server);
  return server;
}

export async function invokeJsonTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const result = await server.callTool({ name, arguments: args });
  const first = result.content[0];
  if (first?.type !== "text") throw new Error(`Unexpected tool response for ${name}`);
  const text = first.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 5: Re-run the initialization test and verify the failure is now about missing implementation**

Run: `npm test -- test/init-project.test.ts`
Expected: FAIL because `init_project` does not yet create `plans/index.json`, `knowledge/index.json`, or lean template output.

- [ ] **Step 6: Commit the harness foundation**

```bash
git add package.json package-lock.json vitest.config.ts test/helpers/temp-data-dir.ts test/helpers/test-server.ts test/init-project.test.ts
git commit -m "test: add vitest harness for mcp server changes"
```

### Task 2: Centralize project docs and indexed subresource filesystem rules

**Files:**
- Create: `src/utils/project-documents.ts`
- Create: `src/utils/project-memory.ts`
- Modify: `src/utils/slug.ts`
- Modify: `src/utils/errors.ts`
- Create: `test/project-memory.test.ts`

- [ ] **Step 1: Write failing tests for normalization, index shape, and rebuild behavior**

```ts
it("rebuilds a missing plans index from per-plan meta files", () => {
  expect(rebuildPlanIndex(projectDir)).toEqual({
    plans: [
      expect.objectContaining({ id: "my-plan", title: "My Plan" }),
    ],
  });
});

it("rejects normalized plan id collisions", () => {
  createPlanRecord(projectDir, { title: "My Plan", body: "# My Plan\n" });
  expect(() => createPlanRecord(projectDir, { title: "my   plan", body: "# my plan\n" })).toThrow(/already exists/i);
});

it("accepts caller-supplied plan ids after normalization and validation", () => {
  const created = createPlanRecord(projectDir, {
    planId: "Feature Plan",
    title: "Feature Plan",
    body: "# Feature Plan\n",
  });
  expect(created.meta.id).toBe("feature-plan");
});

it("rejects normalized knowledge entry id collisions", () => {
  createKnowledgeRecord(projectDir, { title: "Auth Flow", kind: "module", body: "# Auth Flow\n" });
  expect(() => createKnowledgeRecord(projectDir, { title: "auth-flow", kind: "module", body: "# auth-flow\n" })).toThrow(/already exists/i);
});

it("accepts caller-supplied knowledge entry ids after normalization and validation", () => {
  const created = createKnowledgeRecord(projectDir, {
    entryId: "Module Note",
    title: "Module Note",
    kind: "module",
    body: "# Module Note\n",
  });
  expect(created.meta.id).toBe("module-note");
});

it("rejects invalid status, invalid kind, and malformed keyword input", () => {
  expect(() => createPlanRecord(projectDir, { title: "Bad Plan", status: "oops" as never, keywords: ["OK", "   "], body: "# Bad Plan\n" })).toThrow(/status|keyword/i);
  expect(() => createKnowledgeRecord(projectDir, { title: "Bad Entry", kind: "oops" as never, keywords: ["", "Auth"], body: "# Bad Entry\n" })).toThrow(/kind|keyword/i);
});

it("creates plan and knowledge bodies with a single title H1", () => {
  const plan = createPlanRecord(projectDir, { title: "Feature Plan", body: "Implementation details" });
  const entry = createKnowledgeRecord(projectDir, { title: "Module Note", kind: "module", body: "Important details" });
  expect(plan.body.startsWith("# Feature Plan\n")).toBe(true);
  expect(entry.body.startsWith("# Module Note\n")).toBe(true);
});

it("rewrites the leading H1 when plan title metadata changes", () => {
  const updated = updatePlanMeta(projectDir, "my-plan", { title: "New Plan Title" });
  expect(updated.title).toBe("New Plan Title");
  expect(readText(resolve(projectDir, "plans", "my-plan", "plan.md"))).toMatch(/^# New Plan Title/m);
  expect(readOrRebuildPlanIndex(projectDir).plans[0]?.title).toBe("New Plan Title");
});

it("keeps updatedAt in sync between plan meta and plan index on body writes", () => {
  const result = updatePlanBody(projectDir, "my-plan", "# My Plan\n\nUpdated body");
  const index = readOrRebuildPlanIndex(projectDir);
  expect(index.plans[0]?.updatedAt).toBe(result.meta.updatedAt);
});

it("rewrites the leading H1 when knowledge entry title metadata changes", () => {
  const updated = updateKnowledgeMeta(projectDir, "my-entry", { title: "New Entry Title" });
  expect(updated.title).toBe("New Entry Title");
  expect(readText(resolve(projectDir, "knowledge", "my-entry", "entry.md"))).toMatch(/^# New Entry Title/m);
  expect(readOrRebuildKnowledgeIndex(projectDir).entries[0]?.title).toBe("New Entry Title");
});

it("keeps updatedAt in sync between knowledge meta and knowledge index on body writes", () => {
  const result = updateKnowledgeBody(projectDir, "my-entry", "# My Entry\n\nUpdated body");
  const index = readOrRebuildKnowledgeIndex(projectDir);
  expect(index.entries[0]?.updatedAt).toBe(result.meta.updatedAt);
});

it("returns empty plan and knowledge indexes for legacy projects without creating directories on read", () => {
  expect(readOrRebuildPlanIndex(legacyProjectDir)).toEqual({ plans: [] });
  expect(readOrRebuildKnowledgeIndex(legacyProjectDir)).toEqual({ entries: [] });
  expect(existsSync(resolve(legacyProjectDir, "plans"))).toBe(false);
  expect(existsSync(resolve(legacyProjectDir, "knowledge"))).toBe(false);
});

it("rebuilds a missing plan index from per-plan metadata and writes it back", () => {
  rmSync(resolve(projectDir, "plans", "index.json"));
  expect(readOrRebuildPlanIndex(projectDir).plans[0]?.id).toBe("my-plan");
  expect(JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))).toEqual({
    plans: [expect.objectContaining({ id: "my-plan" })],
  });
});

it("rebuilds a corrupted plan index from per-plan metadata", () => {
  writeFileSync(resolve(projectDir, "plans", "index.json"), "not-json", "utf-8");
  expect(readOrRebuildPlanIndex(projectDir).plans[0]?.id).toBe("my-plan");
  expect(JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))).toEqual({
    plans: [expect.objectContaining({ id: "my-plan" })],
  });
});

it("rebuilds a stale plan index from per-plan metadata and writes it back", () => {
  writeFileSync(
    resolve(projectDir, "plans", "index.json"),
    JSON.stringify({ plans: [{ id: "my-plan", title: "Old Title" }] }, null, 2),
    "utf-8"
  );
  expect(readOrRebuildPlanIndex(projectDir).plans[0]?.title).toBe("My Plan");
  expect(JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))).toEqual({
    plans: [expect.objectContaining({ title: "My Plan" })],
  });
});

it("fails with a descriptive error when a corrupted plan index cannot be rebuilt", () => {
  writeFileSync(resolve(projectDir, "plans", "index.json"), "not-json", "utf-8");
  writeFileSync(resolve(projectDir, "plans", "my-plan", "meta.json"), "not-json", "utf-8");
  expect(() => readOrRebuildPlanIndex(projectDir)).toThrow(/plan/i);
});

it("rebuilds a corrupted knowledge index from per-entry metadata and writes it back", () => {
  writeFileSync(resolve(projectDir, "knowledge", "index.json"), "not-json", "utf-8");
  expect(readOrRebuildKnowledgeIndex(projectDir).entries[0]?.id).toBe("my-entry");
  expect(JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))).toEqual({
    entries: [expect.objectContaining({ id: "my-entry" })],
  });
});

it("rebuilds a stale knowledge index from per-entry metadata and writes it back", () => {
  writeFileSync(
    resolve(projectDir, "knowledge", "index.json"),
    JSON.stringify({ entries: [{ id: "my-entry", title: "Old Entry" }] }, null, 2),
    "utf-8"
  );
  expect(readOrRebuildKnowledgeIndex(projectDir).entries[0]?.title).toBe("My Entry");
  expect(JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))).toEqual({
    entries: [expect.objectContaining({ title: "My Entry" })],
  });
});

it("rebuilds a missing knowledge index from per-entry metadata and writes it back", () => {
  rmSync(resolve(projectDir, "knowledge", "index.json"));
  expect(readOrRebuildKnowledgeIndex(projectDir).entries[0]?.id).toBe("my-entry");
  expect(JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))).toEqual({
    entries: [expect.objectContaining({ id: "my-entry" })],
  });
});

it("fails with a descriptive error when a corrupted knowledge index cannot be rebuilt", () => {
  writeFileSync(resolve(projectDir, "knowledge", "index.json"), "not-json", "utf-8");
  writeFileSync(resolve(projectDir, "knowledge", "my-entry", "meta.json"), "not-json", "utf-8");
  expect(() => readOrRebuildKnowledgeIndex(projectDir)).toThrow(/knowledge/i);
});

it("creates plans and knowledge directories lazily on first write for legacy projects", () => {
  const legacyPlan = createPlanRecord(legacyProjectDir, {
    title: "Legacy Plan",
    body: "# Legacy Plan\n",
  });
  const legacyEntry = createKnowledgeRecord(legacyProjectDir, {
    title: "Legacy Entry",
    kind: "lesson",
    body: "# Legacy Entry\n",
  });

  expect(legacyPlan.meta.id).toBe("legacy-plan");
  expect(legacyEntry.meta.id).toBe("legacy-entry");
  expect(existsSync(resolve(legacyProjectDir, "plans", "index.json"))).toBe(true);
  expect(existsSync(resolve(legacyProjectDir, "knowledge", "index.json"))).toBe(true);
});
```

- [ ] **Step 2: Run only the filesystem tests and verify they fail**

Run: `npm test -- test/project-memory.test.ts`
Expected: FAIL with missing module / missing exported helpers.

- [ ] **Step 3: Create a small shared document map utility**

```ts
export const PROJECT_DOC_FILES = {
  overview: "overview.md",
  tasks: "tasks.md",
  dependencies: "dependencies.md",
  knowledge: "knowledge.md",
} as const;
```

- [ ] **Step 4: Create shared filesystem helpers for plans and knowledge**

```ts
export interface PlanMeta {
  id: string;
  title: string;
  status: PlanStatus;
  keywords: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMeta {
  id: string;
  title: string;
  kind: KnowledgeKind;
  keywords: string[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export const PLAN_STATUSES = [
  "proposed",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "archived",
] as const;

export const KNOWLEDGE_KINDS = [
  "lesson",
  "gotcha",
  "pattern",
  "architecture",
  "module",
  "feature",
  "reference",
] as const;

export function emptyPlanIndex() {
  return { plans: [] };
}

export function emptyKnowledgeIndex() {
  return { entries: [] };
}

export function normalizeKeywords(input: string[]): string[] { /* lowercase, trim, dedupe, reject empty or malformed values */ }
export function rewriteLeadingH1(markdown: string, title: string): string { /* ensure first line is `# ${title}` */ }
export function readOrRebuildPlanIndex(projectDir: string): { plans: PlanMeta[] } { /* ... */ }
export function readOrRebuildKnowledgeIndex(projectDir: string): { entries: KnowledgeMeta[] } { /* ... */ }
export function createPlanRecord(projectDir: string, input: CreatePlanInput): { meta: PlanMeta; body: string } { /* ... */ }
export function createKnowledgeRecord(projectDir: string, input: CreateKnowledgeInput): { meta: KnowledgeMeta; body: string } { /* ... */ }
export function updatePlanMeta(projectDir: string, planId: string, patch: UpdatePlanMetaInput): PlanMeta { /* ... */ }
export function updatePlanBody(projectDir: string, planId: string, body: string): { meta: PlanMeta; body: string } { /* ... */ }
export function updateKnowledgeMeta(projectDir: string, entryId: string, patch: UpdateKnowledgeMetaInput): KnowledgeMeta { /* ... */ }
export function updateKnowledgeBody(projectDir: string, entryId: string, body: string): { meta: KnowledgeMeta; body: string } { /* ... */ }
export function ensurePlansDir(projectDir: string): string { /* create lazily on write only */ }
export function ensureKnowledgeDir(projectDir: string): string { /* create lazily on write only */ }
```

- [ ] **Step 5: Extend slug normalization for plan IDs and knowledge entry IDs**

```ts
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function requireSlug(value: string, label: string): string {
  const slug = slugify(value);
  if (!slug) throw new DagError("INVALID_SLUG", `${label} cannot be empty after normalization.`);
  return slug;
}
```

- [ ] **Step 6: Add explicit error helpers for duplicate IDs, missing items, invalid enum values, and rebuild failure**

```ts
export function planNotFound(slug: string, planId: string): DagError { /* ... */ }
export function knowledgeEntryNotFound(slug: string, entryId: string): DagError { /* ... */ }
export function invalidPlanStatus(status: string): DagError { /* ... */ }
export function invalidKnowledgeKind(kind: string): DagError { /* ... */ }
export function duplicatePlanId(slug: string, planId: string): DagError { /* ... */ }
export function duplicateKnowledgeEntryId(slug: string, entryId: string): DagError { /* ... */ }
export function corruptedProjectMemoryIndex(kind: "plans" | "knowledge", slug: string): DagError { /* ... */ }
export function invalidKeywords(label: string): DagError { /* ... */ }
export function invalidPlanId(label: string): DagError { /* ... */ }
export function invalidKnowledgeEntryId(label: string): DagError { /* ... */ }
```

- [ ] **Step 7: Re-run the shared utility tests and verify they pass**

Run: `npm test -- test/project-memory.test.ts`
Expected: PASS

- [ ] **Step 8: Commit the shared model layer**

```bash
git add src/utils/project-documents.ts src/utils/project-memory.ts src/utils/slug.ts src/utils/errors.ts test/project-memory.test.ts
git commit -m "feat: add shared filesystem model for project memory"
```

### Task 3: Make project initialization create lean docs and empty indexes

**Files:**
- Modify: `src/tools/init-project.ts`
- Modify: `templates/project.md.tmpl`
- Modify: `templates/task.md.tmpl`
- Modify: `templates/dependency.md.tmpl`
- Modify: `templates/knowledge.md.tmpl`
- Modify: `templates/project-meta.json.tmpl`
- Modify: `test/init-project.test.ts`

- [ ] **Step 1: Expand the failing init test to assert the final file layout and canonical empty indexes**

```ts
expect(readJson("projects/my-project/plans/index.json")).toEqual({ plans: [] });
expect(readJson("projects/my-project/knowledge/index.json")).toEqual({ entries: [] });
expect(readText("projects/my-project/overview.md")).toContain("## Current Focus");
expect(readText("projects/my-project/overview.md")).not.toContain("<!--");
expect(readText("projects/my-project/overview.md")).not.toContain("**Repo:**");
expect(readText("projects/my-project/tasks.md")).toContain("## Backlog");
expect(readText("projects/my-project/tasks.md")).not.toContain("<!--");
expect(readText("projects/my-project/dependencies.md")).toContain("## Upstream");
expect(readText("projects/my-project/dependencies.md")).not.toContain("| Project | Status | Notes |");
expect(readText("projects/my-project/dependencies.md")).toContain("- None");
expect(readText("projects/my-project/knowledge.md")).toContain("# Knowledge");
expect(readText("projects/my-project/knowledge.md")).not.toContain("<!--");
```

- [ ] **Step 2: Run the initialization test and verify it fails on current behavior**

Run: `npm test -- test/init-project.test.ts`
Expected: FAIL because `init_project` still writes only the old docs.

- [ ] **Step 3: Update initialization to create `plans/` and `knowledge/` directories plus canonical empty indexes**

```ts
mkdirSync(resolve(projectDir, "plans"), { recursive: true });
mkdirSync(resolve(projectDir, "knowledge"), { recursive: true });
writeFileSync(resolve(projectDir, "plans", "index.json"), JSON.stringify({ plans: [] }, null, 2), "utf-8");
writeFileSync(resolve(projectDir, "knowledge", "index.json"), JSON.stringify({ entries: [] }, null, 2), "utf-8");
```

- [ ] **Step 4: Replace verbose templates with lean scaffolds**

```md
# templates/project.md.tmpl
# {{name}}

> {{description}}

{{statusBlock}}{{repoBlock}}

## Summary

## Goals

## Current Focus

# templates/task.md.tmpl
# Tasks - {{name}}

## Backlog

## In Progress

## Done

- [x] Project initialized ({{createdAt}})

# templates/dependency.md.tmpl
# Dependencies - {{name}}

## Upstream

{{upstreamBlock}}

## Downstream

- None yet

# templates/knowledge.md.tmpl
# Knowledge - {{name}}

## Stack

## Architecture

## Active Patterns

## Key Files And Entries
```

Use template variables so `overview.md` includes:

- `**Status:** {{status}}` only when a status line is desired
- `**Repo:** {{repoUrl}}` only when `repoUrl` is non-empty
- no blank placeholder line when repo URL is absent

Use `upstreamBlock` so:

- it renders `- None` when the project has no upstream dependencies
- it renders one short bullet per dependency slug when dependencies exist

- [ ] **Step 5: Re-run the initialization test and verify it passes**

Run: `npm test -- test/init-project.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the initialization and template changes**

```bash
git add src/tools/init-project.ts templates/project.md.tmpl templates/task.md.tmpl templates/dependency.md.tmpl templates/knowledge.md.tmpl templates/project-meta.json.tmpl test/init-project.test.ts
git commit -m "feat: initialize projects with lean docs and memory indexes"
```

## Chunk 2: MCP Tools and Resource Surfaces for Plans and Knowledge

### Task 4: Add structured plan MCP tools on top of the shared memory layer

**Files:**
- Create: `src/tools/project-plans.ts`
- Modify: `src/index.ts`
- Create: `test/project-plans.test.ts`

- [ ] **Step 1: Write failing integration tests for plan create/list/get/update behavior**

```ts
it("creates a plan and returns metadata plus body", async () => {
  const result = await invokeTool("create_project_plan", {
    slug: "my-project",
    title: "Reduce token cost",
    summary: "Trim template overhead and add indexed project memory.",
    status: "planned",
    planId: "Reduce Token Cost",
    keywords: ["templates", "tokens"],
    body: "# Reduce token cost\n",
  });

  expect(result.meta.id).toBe("reduce-token-cost");
  expect(result.meta.status).toBe("planned");
  expect(result.body).toContain("# Reduce token cost");
});

it("lists plans with status and any-match keyword filtering", async () => {
  const result = await invokeTool("list_project_plans", {
    slug: "my-project",
    status: "planned",
    keywords: ["templates", "missing"],
  });
  expect(result.plans).toEqual([expect.objectContaining({ status: "planned" })]);
});

it("returns only metadata by default from get_project_plan", async () => {
  const result = await invokeTool("get_project_plan", { slug: "my-project", planId: "reduce-token-cost" });
  expect(result.meta.id).toBe("reduce-token-cost");
  expect(result.body).toBeUndefined();
});

it("returns metadata plus body when includeBody=true for plans", async () => {
  const result = await invokeTool("get_project_plan", {
    slug: "my-project",
    planId: "reduce-token-cost",
    includeBody: true,
  });
  expect(result).toEqual({
    meta: expect.objectContaining({ id: "reduce-token-cost" }),
    body: expect.stringContaining("# Reduce token cost"),
  });
});

it("updates plan metadata and body with the exact return shapes", async () => {
  const metaResult = await invokeTool("update_project_plan_meta", {
    slug: "my-project",
    planId: "reduce-token-cost",
    title: "Reduce template token cost",
    summary: "Updated summary",
    status: "in_progress",
    keywords: ["templates", "token-efficiency"],
  });
  expect(metaResult).toEqual({
    meta: expect.objectContaining({
      title: "Reduce template token cost",
      summary: "Updated summary",
      status: "in_progress",
      keywords: ["templates", "token-efficiency"],
    }),
  });

  const bodyResult = await invokeTool("update_project_plan_body", {
    slug: "my-project",
    planId: "reduce-token-cost",
    body: "# Reduce template token cost\n\nUpdated body",
  });
  expect(bodyResult).toEqual({
    meta: expect.objectContaining({ id: "reduce-token-cost" }),
    body: expect.stringContaining("Updated body"),
  });
});

it("returns an empty list for legacy projects with no plans directory", async () => {
  const result = await invokeTool("list_project_plans", { slug: "legacy-project" });
  expect(result).toEqual({ plans: [] });
});

it("keeps get_project limited to the four legacy docs", async () => {
  const meta = await invokeTool("get_project", { slug: "my-project" });
  const knowledge = await invokeTool("get_project", { slug: "my-project", doc: "knowledge" });
  expect(typeof meta).toBeTypeOf("string");
  expect(knowledge).toContain("# Knowledge");
});

it("rebuilds missing or corrupted plan indexes before list/get responses", async () => {
  const listed = await invokeTool("list_project_plans", { slug: "my-project" });
  const gotten = await invokeTool("get_project_plan", {
    slug: "my-project",
    planId: "reduce-token-cost",
    includeBody: true,
  });

  expect(listed.plans[0]?.id).toBe("reduce-token-cost");
  expect(gotten.body).toContain("# Reduce token cost");
});
```

- [ ] **Step 2: Run the plan tool tests and verify they fail**

Run: `npm test -- test/project-plans.test.ts`
Expected: FAIL with unknown tool / missing registration.

- [ ] **Step 3: Register the five plan tools in one focused module**

```ts
export function registerProjectPlanTools(server: McpServer) {
  server.tool("create_project_plan", "Create a structured plan for a project.", CreateProjectPlanSchema, async (params) => { /* ... */ });
  server.tool("list_project_plans", "List structured plans for a project.", ListProjectPlansSchema, async (params) => { /* ... */ });
  server.tool("get_project_plan", "Get a plan's metadata or full body.", GetProjectPlanSchema, async (params) => { /* ... */ });
  server.tool("update_project_plan_meta", "Update plan metadata.", UpdateProjectPlanMetaSchema, async (params) => { /* ... */ });
  server.tool("update_project_plan_body", "Update plan body.", UpdateProjectPlanBodySchema, async (params) => { /* ... */ });
}
```

- [ ] **Step 4: Ensure list/get operations rebuild missing or corrupted indexes from per-item metadata before returning**

```ts
const index = readOrRebuildPlanIndex(projectDir);
return { content: [{ type: "text", text: JSON.stringify({ plans: index.plans }, null, 2) }] };
```

- [ ] **Step 4a: Make the plan tool contracts exact, not permissive**

```ts
// list_project_plans -> { plans }
// get_project_plan(includeBody=false) -> { meta }
// get_project_plan(includeBody=true) -> { meta, body }
// create_project_plan -> { meta, body }
// update_project_plan_meta -> { meta }
// update_project_plan_body -> { meta, body }
// keywords filter uses any-match semantics after normalization
// create_project_plan accepts slug, title, summary?, status?, keywords?, body?, planId?
```

- [ ] **Step 5: Re-run the plan tool tests and verify they pass**

Run: `npm test -- test/project-plans.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the plan tool surface**

```bash
git add src/tools/project-plans.ts src/index.ts test/project-plans.test.ts
git commit -m "feat: add structured project plan tools"
```

### Task 5: Add structured knowledge MCP tools with the same indexed model

**Files:**
- Create: `src/tools/project-knowledge.ts`
- Modify: `src/index.ts`
- Create: `test/project-knowledge.test.ts`

- [ ] **Step 1: Write failing integration tests for knowledge create/list/get/update behavior**

```ts
it("stores durable project knowledge entries", async () => {
  const result = await invokeTool("create_project_knowledge_entry", {
    slug: "my-project",
    title: "Auth flow module",
    kind: "module",
    summary: "Explains auth boundaries and state transitions.",
    entryId: "Auth Flow Module",
    keywords: ["auth", "session"],
    body: "# Auth flow module\n",
  });

  expect(result.meta.kind).toBe("module");
  expect(result.meta.id).toBe("auth-flow-module");
  expect(result.body).toContain("# Auth flow module");
});

it("lists knowledge entries with kind and any-match keyword filtering", async () => {
  const result = await invokeTool("list_project_knowledge_entries", {
    slug: "my-project",
    kind: "module",
    keywords: ["auth", "missing"],
  });
  expect(result.entries).toEqual([expect.objectContaining({ kind: "module" })]);
});

it("returns only metadata by default from get_project_knowledge_entry", async () => {
  const result = await invokeTool("get_project_knowledge_entry", {
    slug: "my-project",
    entryId: "auth-flow-module",
  });
  expect(result.meta.id).toBe("auth-flow-module");
  expect(result.body).toBeUndefined();
});

it("returns metadata plus body when includeBody=true for knowledge entries", async () => {
  const result = await invokeTool("get_project_knowledge_entry", {
    slug: "my-project",
    entryId: "auth-flow-module",
    includeBody: true,
  });
  expect(result).toEqual({
    meta: expect.objectContaining({ id: "auth-flow-module" }),
    body: expect.stringContaining("# Auth flow module"),
  });
});

it("updates knowledge metadata and body with the exact return shapes", async () => {
  const metaResult = await invokeTool("update_project_knowledge_meta", {
    slug: "my-project",
    entryId: "auth-flow-module",
    title: "Authentication flow module",
    kind: "feature",
    summary: "Updated summary",
    keywords: ["auth", "feature"],
  });
  expect(metaResult).toEqual({
    meta: expect.objectContaining({
      title: "Authentication flow module",
      kind: "feature",
      summary: "Updated summary",
      keywords: ["auth", "feature"],
    }),
  });

  const bodyResult = await invokeTool("update_project_knowledge_body", {
    slug: "my-project",
    entryId: "auth-flow-module",
    body: "# Authentication flow module\n\nUpdated body",
  });
  expect(bodyResult).toEqual({
    meta: expect.objectContaining({ id: "auth-flow-module" }),
    body: expect.stringContaining("Updated body"),
  });
});

it("returns an empty list for legacy projects with no knowledge directory", async () => {
  const result = await invokeTool("list_project_knowledge_entries", { slug: "legacy-project" });
  expect(result).toEqual({ entries: [] });
});

it("keeps update_project_doc limited to the four legacy docs", async () => {
  const result = await invokeTool("update_project_doc", {
    slug: "my-project",
    doc: "knowledge",
    content: "# Knowledge - My Project\n",
  });
  expect(result).toContain("Updated knowledge");
});

it("rebuilds missing or corrupted knowledge indexes before list/get responses", async () => {
  const listed = await invokeTool("list_project_knowledge_entries", { slug: "my-project" });
  const gotten = await invokeTool("get_project_knowledge_entry", {
    slug: "my-project",
    entryId: "auth-flow-module",
    includeBody: true,
  });

  expect(listed.entries[0]?.id).toBe("auth-flow-module");
  expect(gotten.body).toContain("# Auth flow module");
});
```

- [ ] **Step 2: Run the knowledge tool tests and verify they fail**

Run: `npm test -- test/project-knowledge.test.ts`
Expected: FAIL with unknown tool / missing registration.

- [ ] **Step 3: Implement the five knowledge tools with exact enum, keyword, and includeBody behavior**

```ts
export function registerProjectKnowledgeTools(server: McpServer) {
  server.tool("create_project_knowledge_entry", "Create a structured knowledge entry for a project.", CreateProjectKnowledgeEntrySchema, async (params) => { /* ... */ });
  // ...list/get/update meta/update body
}
```

- [ ] **Step 3a: Make the knowledge tool contracts exact, not permissive**

```ts
// list_project_knowledge_entries -> { entries }
// get_project_knowledge_entry(includeBody=false) -> { meta }
// get_project_knowledge_entry(includeBody=true) -> { meta, body }
// create_project_knowledge_entry -> { meta, body }
// update_project_knowledge_meta -> { meta }
// update_project_knowledge_body -> { meta, body }
// keywords filter uses any-match semantics after normalization
// create_project_knowledge_entry accepts slug, title, kind, summary?, keywords?, body?, entryId?
```

- [ ] **Step 4: Make knowledge body writes keep `entry.md`, `meta.json`, and `knowledge/index.json` in sync**

```ts
const updated = updateKnowledgeEntryBody(projectDir, params.entryId, params.body);
return { content: [{ type: "text", text: JSON.stringify({ meta: updated.meta, body: updated.body }, null, 2) }] };
```

- [ ] **Step 5: Re-run the knowledge tool tests and verify they pass**

Run: `npm test -- test/project-knowledge.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the knowledge tool surface**

```bash
git add src/tools/project-knowledge.ts src/index.ts test/project-knowledge.test.ts
git commit -m "feat: add structured project knowledge tools"
```

### Task 6: Extend project resources to expose plan and knowledge indexes and bodies

**Files:**
- Modify: `src/resources/projects.ts`
- Create: `test/project-resources.test.ts`

- [ ] **Step 1: Write failing resource tests for the new plan and knowledge routes**

```ts
it("serves project-scoped plan and knowledge resources", async () => {
  const plans = await readResource("cc-dag://projects/my-project/plans");
  const knowledge = await readResource("cc-dag://projects/my-project/knowledge");
  const planBody = await readResource("cc-dag://projects/my-project/plans/reduce-token-cost");
  const planMeta = await readResource("cc-dag://projects/my-project/plans/reduce-token-cost/meta");
  const knowledgeBody = await readResource("cc-dag://projects/my-project/knowledge/auth-flow-module");
  const knowledgeMeta = await readResource("cc-dag://projects/my-project/knowledge/auth-flow-module/meta");

  expect(plans).toContain('"plans"');
  expect(knowledge).toContain('"entries"');
  expect(planBody).toContain("# Reduce token cost");
  expect(planMeta).toContain('"id": "reduce-token-cost"');
  expect(knowledgeBody).toContain("# Auth flow module");
  expect(knowledgeMeta).toContain('"id": "auth-flow-module"');
});
```

- [ ] **Step 2: Run the resource tests and verify they fail**

Run: `npm test -- test/project-resources.test.ts`
Expected: FAIL because the resource routes do not exist yet.

- [ ] **Step 3: Add project-scoped resources for plan index/body/meta and knowledge index/body/meta**

```ts
new ResourceTemplate("cc-dag://projects/{slug}/plans", { list: undefined })
new ResourceTemplate("cc-dag://projects/{slug}/plans/{planId}", { list: undefined })
new ResourceTemplate("cc-dag://projects/{slug}/plans/{planId}/meta", { list: undefined })
new ResourceTemplate("cc-dag://projects/{slug}/knowledge", { list: undefined })
new ResourceTemplate("cc-dag://projects/{slug}/knowledge/{entryId}", { list: undefined })
new ResourceTemplate("cc-dag://projects/{slug}/knowledge/{entryId}/meta", { list: undefined })
```

- [ ] **Step 4: Route resource reads through the shared rebuild-aware helpers instead of duplicating filesystem logic**

```ts
const index = readOrRebuildKnowledgeIndex(projectDir);
return {
  contents: [{ uri: uri.href, text: JSON.stringify({ entries: index.entries }, null, 2), mimeType: "application/json" }],
};
```

- [ ] **Step 5: Re-run the resource tests and verify they pass**

Run: `npm test -- test/project-resources.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the resource surface**

```bash
git add src/resources/projects.ts test/project-resources.test.ts
git commit -m "feat: expose structured project memory resources"
```

## Chunk 3: Prompt, Skill, Agent, and Documentation Alignment

### Task 7: Update prompt text and CLI agent surfaces to reflect structured memory

**Files:**
- Modify: `src/prompts/cc-dag-orchestrate.ts`
- Modify: `src/prompts/cc-dag-brainstorm.ts`
- Modify: `src/prompts/cc-dag-execute.ts`
- Modify: `src/prompts/cc-dag-sync.ts`
- Modify: `src/prompts/cc-dag-init.ts`
- Modify: `src/agents/definitions.ts`
- Modify: `src/cli/config.ts`
- Modify: `src/cli/setup.ts`
- Modify: `src/cli/instructions.ts`
- Modify: `test/project-plans.test.ts`
- Modify: `test/project-knowledge.test.ts`

- [ ] **Step 1: Add failing tests that inspect prompt text for the new workflows and terminology**

```ts
expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_plan");
expect(ORCHESTRATE_PROMPT_TEXT).toContain("knowledge/");
expect(ORCHESTRATE_PROMPT_TEXT).toContain("MULTI");
expect(ORCHESTRATE_PROMPT_TEXT).toContain("create_project_knowledge_entry");
expect(INIT_PROMPT_TEXT).toContain("plans/");
expect(INIT_PROMPT_TEXT).toContain("knowledge/");
expect(BRAINSTORM_PROMPT_TEXT("my-project")).toContain("create or update structured plans");
expect(EXECUTE_PROMPT_TEXT("my-project")).toContain("structured knowledge entries");
expect(SYNC_PROMPT_TEXT("my-project")).toContain("summary docs and structured plan/knowledge indexes");
expect(AGENT_DEFINITIONS["sync-knowledge"].hint).toContain("plans");
expect(defaultConfig().agents["sync-knowledge"].enabled).toBe(true);
```

- [ ] **Step 2: Run the relevant tests and verify they fail on the old prompt language**

Run: `npm test -- test/project-plans.test.ts test/project-knowledge.test.ts`
Expected: FAIL because the prompt and agent metadata still describe only four docs / monolithic knowledge.

- [ ] **Step 3: Update prompt contracts and agent hints to use the new plan-vs-tasks and knowledge-vs-summary rules**

```ts
- planning-oriented agents should prefer structured plan records for feature work
- execution-oriented agents should update tasks for workflow state and knowledge entries for durable discoveries
- init-oriented flows should teach that new projects start with empty `plans/` and `knowledge/` indexes
- orchestrate `MULTI` flows should be able to chain plan and knowledge operations across phases
- brainstorm flows should create or update structured plans for multi-step feature work
- sync flows should audit both `knowledge.md` summaries and indexed plan/knowledge stores
```

- [ ] **Step 4: Update CLI-facing descriptions so setup and OpenCode agent registration advertise the richer workflows accurately**

```ts
description: "CC-DAG project orchestrator — routes init, planning, execution, sync, and structured project memory workflows"
```

- [ ] **Step 4a: Add direct assertions for agent and CLI metadata surfaces**

```ts
expect(AGENT_DEFINITIONS.execute.hint).toContain("structured");
expect(AGENT_DEFINITIONS["sync-knowledge"].hint).toContain("knowledge");
expect(CC_DAG_AGENT_ENTRY.description).toContain("structured project memory");
```

- [ ] **Step 5: Re-run the prompt/agent tests and verify they pass**

Run: `npm test -- test/project-plans.test.ts test/project-knowledge.test.ts`
Expected: PASS

- [ ] **Step 6: Commit the prompt and agent alignment**

```bash
git add src/prompts/cc-dag-orchestrate.ts src/prompts/cc-dag-brainstorm.ts src/prompts/cc-dag-execute.ts src/prompts/cc-dag-sync.ts src/prompts/cc-dag-init.ts src/agents/definitions.ts src/cli/config.ts src/cli/setup.ts src/cli/instructions.ts test/project-plans.test.ts test/project-knowledge.test.ts
git commit -m "feat: align prompts and agents with structured project memory"
```

### Task 8: Update local skill guides and public docs for the new model

**Files:**
- Modify: `skills/orchestrate.md`
- Modify: `skills/update-docs.md`
- Modify: `skills/explore-dag.md`
- Modify: `skills/init-project.md`
- Modify: `README.md`
- Create: `test/docs-smoke.test.ts`

- [ ] **Step 1: Write a failing docs smoke test for key public strings**

```ts
expect(readme).toContain("create_project_plan");
expect(updateDocsSkill).toContain("knowledge entries");
expect(orchestrateSkill).toContain("MULTI");
expect(initSkill).toContain("plans/");
expect(initSkill).toContain("knowledge/");
expect(exploreDagSkill).toContain("plan and knowledge indexes");
expect(updateDocsSkill).toContain("structured plans for feature work");
expect(updateDocsSkill).toContain("knowledge.md");
```

- [ ] **Step 2: Run the docs smoke test and verify it fails**

Run: `npm test -- test/docs-smoke.test.ts`
Expected: FAIL because the docs still describe only the old model.

- [ ] **Step 3: Update skills and README to describe lean docs, structured plans, and structured knowledge entries**

```md
- `knowledge.md` is the summary landing page
- use structured knowledge entries for durable project memory
- use structured plans for feature work that spans multiple tasks or decisions
- use `tasks.md` for execution queue state, not full feature planning narratives
- use `skills/explore-dag.md` to inspect plan and knowledge indexes in addition to the four core docs
- update `knowledge.md` only for high-level project context and pointers; create or update a structured knowledge entry for durable lessons, gotchas, patterns, architecture, modules, and feature notes
```

- [ ] **Step 4: Re-run the docs smoke test and verify it passes**

Run: `npm test -- test/docs-smoke.test.ts`
Expected: PASS

- [ ] **Step 5: Commit the documentation updates**

```bash
git add skills/orchestrate.md skills/update-docs.md skills/explore-dag.md skills/init-project.md README.md test/docs-smoke.test.ts
git commit -m "docs: describe structured plans and knowledge entries"
```

### Task 9: Run the full suite and final verification

**Files:**
- Verify: `package.json`
- Verify: `src/index.ts`
- Verify: `src/resources/projects.ts`
- Verify: `src/tools/project-plans.ts`
- Verify: `src/tools/project-knowledge.ts`
- Verify: `docs/superpowers/specs/2026-03-16-template-efficiency-and-project-plans-design.md`

- [ ] **Step 1: Run the entire automated test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Smoke-check the built server entrypoint**

Run: `node dist/index.js --help`
Expected: Either a harmless startup message or the existing CLI/MCP behavior without TypeScript/runtime errors.

- [ ] **Step 4: Review git diff and confirm all touched surfaces match the spec**

Run: `git diff --stat`
Expected: Changes in tools, resources, prompts, templates, skills, tests, docs, agent metadata, and CLI setup/instruction files only.

- [ ] **Step 4a: Spot-check the public-facing text surfaces changed by the spec**

Run: `npm test -- test/docs-smoke.test.ts test/project-resources.test.ts test/project-plans.test.ts test/project-knowledge.test.ts`
Expected: PASS, confirming MCP contracts and prompt/skill/docs alignment before the final commit.

- [ ] **Step 5: Commit the final integrated implementation**

```bash
git add .
git commit -m "feat: add structured project memory to cc-dag"
```
