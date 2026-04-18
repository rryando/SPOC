# SPOC Repository Reconnaissance Report
**Date:** April 18, 2026  
**Repository:** /home/rryando/Work/SPOC  
**Investigation Scope:** Read-only pattern discovery for 6 units of implementation work

---

## UNIT 1: Orchestrator Prompt Q&A Format

### File Location
- `/home/rryando/Work/SPOC/src/prompts/spoc-orchestrate.ts` — Full file (333 lines)

### BRAINSTORM Workflow Block
**Lines 207–221** — Full definition including "Thinking norms"

```
### BRAINSTORM Workflow
**Context:** T0 (already have overview, focus, plans). Escalate to T1 for tasks/overview only if T0 is stale or missing.
1. Identify the target project slug.
2. Use T0 context to orient. If needed, call `get_project` for specific docs (overview, tasks). Call `list_project_plans` (T2) to review existing plans. Do NOT read all 4 docs upfront.
3. Collaboratively produce concrete plans, trade-offs, dependencies, and actionable next tasks.
4. For multi-step feature work, create or update structured plans via `create_project_plan` / `update_project_plan_meta` / `update_project_plan_body`.
5. Summarize conclusions and ask the user to confirm before writing.
6. Write confirmed outputs using `update_project_doc`.

**Thinking norms:**
- Ask clarifying questions rather than making assumptions
- Surface trade-offs explicitly
- Keep tasks concrete and actionable (not vague goals)
- Flag blockers or missing information
- Summarize conclusions and ask the user to confirm before writing
```

### Key Patterns
- Q&A format uses Markdown headings (`###`) for workflow sections
- **Thinking norms** are prefixed with `**Thinking norms:**` and rendered as bullet list
- Each workflow section has **Context** (T0-T4 tier explanation) followed by numbered steps
- Context loading tiers (T0–T4) are defined at lines 50–62 and referenced throughout

---

## UNIT 2: A3 — audit_project_knowledge Tool

### Tool Files Structure

All tools in `/home/rryando/Work/SPOC/src/tools/` follow this pattern:

| Tool File | Purpose |
|-----------|---------|
| `project-knowledge.ts` | 5 knowledge entry operations (CRUD + list) |
| `project-plans.ts` | 5 plan operations (CRUD + list) |
| `project-tasks.ts` | 5 task operations (CRUD + list) |
| `update-doc.ts` | Update project summary docs (overview/tasks/dependencies/knowledge) |
| `resolve-context.ts` | Resolve project context from workspace path |
| `sync-agents-md.ts` | Sync project docs with codebase state |
| `list-projects.ts` | List all projects with dependency graph |
| `get-project.ts` | Read project metadata and documents |
| `init-project.ts` | Create new project |
| `manage-dependency.ts` | Add/remove project dependencies |
| `delete-project.ts` | Delete a project |
| `update-status.ts` | Update project lifecycle status |
| `update-paths.ts` | Manage workspace paths for a project |

### Representative Tool Pattern: `project-knowledge.ts`

**Tool Registration Shape:**
```typescript
export function registerProjectKnowledgeTools(server: McpServer) {
  server.tool(
    "create_project_knowledge_entry",
    "Create a new structured knowledge entry within a project.",
    {
      slug: z.string().describe("Project slug"),
      title: z.string().describe("Entry title"),
      summary: z.string().optional().describe("One-line summary"),
      kind: z.enum(KNOWLEDGE_KINDS).optional().default("reference"),
      entryId: z.string().optional().describe("Entry identifier (derived from title if omitted)"),
      keywords: z.array(z.string()).optional().default([]),
      body: z.string().optional().describe("Markdown body content"),
      sourceFiles: z.array(fileRefSchema).optional(),
    },
    async (params) => {
      try {
        const projectDir = getProjectDir(params.slug);
        if (!existsSync(projectDir)) {
          return formatError(projectNotFound(params.slug));
        }
        
        const meta = await createKnowledgeEntry(projectDir, {
          id: params.entryId ?? params.title,
          title: params.title,
          kind: params.kind,
          keywords: params.keywords,
          summary: params.summary,
          content: params.body,
          sourceFiles: params.sourceFiles,
        });
        
        const bodyContent = await readFile(resolve(projectDir, meta.file), "utf-8");
        return jsonResult({ meta, body: bodyContent });
      } catch (err) {
        if (err instanceof DagError) return formatError(err);
        return errorResult(err);
      }
    },
  );
}
```

**Response Pattern:**
- **Success:** `jsonResult({ meta, body: bodyContent })` — returns JSON object wrapped in MCP text content
- **DagError:** `formatError(err)` — known project/validation errors
- **Unknown error:** `errorResult(err)` — fallback for unexpected exceptions

### KnowledgeMeta Type (from project-memory.ts lines 119–130)

```typescript
export interface KnowledgeMeta {
  id: string;
  normalizedId: string;
  title: string;
  kind: KnowledgeKind;
  keywords: string[];
  summary: string;
  sourceFiles?: FileRef[];  // Key field for audit_project_knowledge
  file: string;             // Relative path to .md body
  createdAt: string;        // ISO timestamp
  updatedAt: string;        // ISO timestamp
}
```

### sourceFiles Field Details

**Location:** `/home/rryando/Work/SPOC/src/utils/project-memory.ts` lines 59–100

**Definition:**
```typescript
export interface FileRef {
  path: string;    // Relative from workspace root, no leading /, no ..
  anchor?: string; // Optional stable identifier (function/class/export name)
}
```

**Validation:** `sanitizeFileRefs()` function validates:
- Paths: no leading `/`, no `..`, no `#`, `,`, `:`
- Anchors: no `#` or `,`
- Returns normalized paths (Windows backslashes → forward slashes)

**Stored in:**
- Knowledge entries: `KnowledgeMeta.sourceFiles?: FileRef[]`
- Plans: `PlanMeta.sourceFiles?: FileRef[]`
- Tasks: `TaskMeta.sourceFiles?: FileRef[]`

### Workspace Path Resolution Utilities

**Location:** `/home/rryando/Work/SPOC/src/utils/workspace-match.ts` (73 lines)

**Key Functions:**
```typescript
export function matchWorkspace(queryPath: string, storedPath: string): boolean
  // Path-segment-aware comparison: queryPath is inside (or equal to) storedPath
  // Prevents "/Users/ryan" matching "/Users/ryan.ryn"

export type FindMatchResult =
  | { kind: "match"; slug: string; matchedPath: string }
  | { kind: "none" }
  | { kind: "ambiguous"; slugs: string[] };

export function findBestMatch(queryPath: string, projects: WorkspaceProject[]): FindMatchResult
  // Returns project with longest matching workspace path (most specific)
```

**Location:** `/home/rryando/Work/SPOC/src/utils/paths.ts` (75 lines)

**Key Functions:**
```typescript
export function getProjectDir(slug: string): string
  // Returns: resolve(getDataDir(), "projects", slug)

export function getDataDir(): string
  // Priority: SPOC_DATA_DIR env var > ~/.spoc
```

**Existence Check:** Use `existsSync(path)` from Node.js `fs` module (standard pattern in all tools)

---

## UNIT 3: A2 — search_project_knowledge Tool

### Knowledge Index Reading

**Function Signature:**
```typescript
// Location: src/utils/project-memory.ts lines 678–697
export async function readKnowledgeIndex(projectDir: string): Promise<KnowledgeIndex> {
  const knowledgeDir = join(projectDir, "knowledge");
  
  if (!(await fileExists(knowledgeDir))) {
    return { entries: [] };
  }
  
  const indexPath = join(knowledgeDir, "index.json");
  const index = await readJsonSafe<KnowledgeIndex>(indexPath);
  
  if (!index || !Array.isArray(index.entries)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }
  
  if (await isKnowledgeIndexStale(knowledgeDir, index)) {
    return rebuildKnowledgeIndex(knowledgeDir);
  }
  
  return index;
}
```

**Index Structure:**
```typescript
interface KnowledgeIndex {
  entries: KnowledgeMeta[];
}
```

### Search-Available Fields on KnowledgeMeta

| Field | Type | Usage |
|-------|------|-------|
| `title` | string | Full-text search by entry name |
| `summary` | string | One-line description of entry |
| `keywords` | string[] | Array of lowercase, alpha-numeric-or-dash keywords |
| `kind` | KnowledgeKind | Filter by category (lesson, gotcha, pattern, architecture, module, feature, reference) |
| `sourceFiles` | FileRef[] (optional) | File references for codebase context |
| `createdAt` | string | ISO timestamp, can sort by recency |
| `updatedAt` | string | ISO timestamp, can sort by recency |

### Current Search Tool Pattern (from project-knowledge.ts lines 73–111)

```typescript
server.tool(
  "list_project_knowledge_entries",
  "List knowledge entries for a project, optionally filtered by kind and/or keywords.",
  {
    slug: z.string().describe("Project slug"),
    kind: z.enum(KNOWLEDGE_KINDS).optional().describe("Filter by kind"),
    keywords: z.array(z.string()).optional().describe("Filter by keywords (any-match semantics)"),
  },
  async (params) => {
    const index = await readKnowledgeIndex(projectDir);
    let entries = index.entries;
    
    // Filter by kind
    if (params.kind) {
      entries = entries.filter((e) => e.kind === params.kind);
    }
    
    // Filter by keywords (any-match: include if intersection is non-empty)
    if (params.keywords && params.keywords.length > 0) {
      const filterKeywords = new Set(params.keywords.map((k) => k.trim().toLowerCase()));
      entries = entries.filter((e) =>
        e.keywords.some((k) => filterKeywords.has(k.trim().toLowerCase())),
      );
    }
    
    return jsonResult({ entries });
  },
);
```

**Key Pattern:** Any-match semantics on keywords (union, not intersection)

---

## UNIT 4: B4 — get_project_diff Tool

### Timestamp Availability

**Plan/Knowledge .meta.json files:**
- **Available:** `createdAt` and `updatedAt` (ISO 8601 timestamps)
- **Example:** `plans/my-plan.meta.json` contains:
  ```json
  {
    "id": "my-plan",
    "normalizedId": "my-plan",
    "title": "My Plan",
    "status": "in_progress",
    "updatedAt": "2026-04-18T15:30:45.123Z",
    "createdAt": "2026-04-17T10:00:00.000Z"
  }
  ```

**Task meta:**
- **Available:** `createdAt` and `updatedAt` in `tasks/index.json`
- **Structure:** TaskMeta entries are stored in-memory in `tasks/index.json`, not individual files
  ```typescript
  interface TaskIndex {
    tasks: TaskMeta[];  // Each TaskMeta has createdAt, updatedAt
  }
  ```

**Summary docs (.md files):**
- **NOT available** — no metadata on `overview.md`, `tasks.md`, `dependencies.md`, `knowledge.md`
- Use filesystem `mtime` (via Node.js `stat()`) to detect changes

### Walking All Mutation Timestamps

**Recommended approach:**

```typescript
// Location: src/utils/project-memory.ts

// 1. Read plan index (all plans with updatedAt)
const planIndex = await readPlanIndex(projectDir);
const planTimestamps = planIndex.plans.map(p => ({
  type: 'plan',
  id: p.id,
  updatedAt: p.updatedAt,
  file: p.file
}));

// 2. Read knowledge index (all entries with updatedAt)
const knowledgeIndex = await readKnowledgeIndex(projectDir);
const knowledgeTimestamps = knowledgeIndex.entries.map(e => ({
  type: 'knowledge',
  id: e.id,
  updatedAt: e.updatedAt,
  file: e.file
}));

// 3. Read task index (all tasks with updatedAt)
const taskIndex = await readTaskIndex(projectDir);
const taskTimestamps = taskIndex.tasks.map(t => ({
  type: 'task',
  id: t.id,
  updatedAt: t.updatedAt,
}));

// 4. Get filesystem mtimes for summary docs
const overviewMtime = (await stat(join(projectDir, 'overview.md'))).mtime.toISOString();
const tasksMdMtime = (await stat(join(projectDir, 'tasks.md'))).mtime.toISOString();
```

**Relevant Functions in project-memory.ts:**
- Line 287: `async function rebuildPlanIndex(plansDir)` — rebuilds from .meta.json files
- Line 320: `async function rebuildKnowledgeIndex(knowledgeDir)` — rebuilds from .meta.json files
- Line 530: `export async function readPlanIndex(projectDir)` — reads with staleness check
- Line 678: `export async function readKnowledgeIndex(projectDir)` — reads with staleness check
- Line 769: `async function readTaskIndex(projectDir)` — reads from tasks/index.json

---

## UNIT 5: E1 — planId on TaskMeta

### Current TaskMeta Schema (from project-memory.ts lines 713–722)

```typescript
export interface TaskMeta {
  id: string;
  normalizedId: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  sourceFiles?: FileRef[];
  createdAt: string;
  updatedAt: string;
  // NOTE: planId is NOT currently present
}
```

**Available statuses:** `"backlog" | "in_progress" | "done" | "cancelled"`  
**Available priorities:** `"high" | "medium" | "low"`

### Create/Update Task Input Schemas (from project-tasks.ts)

**Create schema (lines 20–61):**
```typescript
server.tool(
  "create_project_task",
  "Create a new task within a project.",
  {
    slug: z.string().describe("Project slug"),
    title: z.string().describe("Task title"),
    priority: z.enum(TASK_PRIORITIES).optional().default("medium"),
    status: z.enum(TASK_STATUSES).optional().default("backlog"),
    sourceFiles: z.array(fileRefSchema).optional(),
  },
  // async handler...
);
```

**Update schema (lines 118–153):**
```typescript
server.tool(
  "update_project_task",
  "Update a task's metadata (title, status, priority).",
  {
    slug: z.string().describe("Project slug"),
    taskId: z.string().describe("Task identifier"),
    title: z.string().optional().describe("New title"),
    status: z.enum(TASK_STATUSES).optional().describe("New status"),
    priority: z.enum(TASK_PRIORITIES).optional().describe("New priority"),
    sourceFiles: z.array(fileRefSchema).optional(),
  },
  // async handler...
);
```

### Where Active Tasks Are Assembled (resolve_project_context.ts)

**Location:** `/home/rryando/Work/SPOC/src/tools/resolve-context.ts` lines 121–161

**Function:** Assembly happens in `resolve_project_context` tool handler

```typescript
const tasksPath = resolve(projectDir, "tasks.md");
const tasksRaw = existsSync(tasksPath) ? await readFile(tasksPath, "utf-8") : "";

// Extract in-progress and backlog tasks
const inProgressTasks = extractInProgressTasks(tasksRaw);  // Matches [/]
const backlogTasks = extractBacklogTasks(tasksRaw);        // Matches [ ]

// Assemble operating brief (uses task lines)
const brief = deriveOperatingBrief({
  plans: planIndex.plans,
  inProgressTasks,
  backlogTasks,
  hasDurableKnowledgeSignal: knowledgeIndex.entries.length > 0,
});

// Output to context
sections.push(
  "\n## Operating Brief\n",
  `**Current Focus:** ${brief.currentFocus}`,
  `**Recommended Surface:** ${brief.recommendedSurface}`,
  `**Why:** ${brief.why}`,
  `**Next Action:** ${brief.nextAction}`,
);
```

**Helper Functions (from content-assembly.ts):**
```typescript
export function extractInProgressTasks(raw: string): string[] {
  return raw.split("\n").filter((line) => /^- \[\/\]/.test(line.trim()));
}

export function extractBacklogTasks(raw: string): string[] {
  return raw.split("\n").filter((line) => /^- \[ \]/.test(line.trim()));
}

export function stripTaskCheckbox(line: string): string {
  return line.replace(/^- \[[ x/]\]\s*/, "").trim();
}
```

### For planId Integration

When adding `planId?: string` to TaskMeta:

1. **Input schema** in `create_project_task` and `update_project_task` — add optional `planId: z.string().optional()`
2. **Output assembly** in `resolve_project_context` — when outputting active tasks, left-join planId to retrieve the plan title:
   ```typescript
   const taskMeta = ... // from TaskMeta
   const planMeta = taskMeta.planId 
     ? planIndex.plans.find(p => p.normalizedId === taskMeta.planId)
     : null;
   // Render: `- [${status}] ${taskMeta.title} (Plan: ${planMeta?.title})`
   ```

---

## UNIT 6: B1 — dryRun Support

Target three mutating tools. Current input schemas:

### 1. update_project_doc (from update-doc.ts lines 13–17)

**Current schema:**
```typescript
export const UpdateDocSchema = {
  slug: z.string().describe("Project slug"),
  doc: z.enum(VALID_DOCS).describe("Document type to update"),
  content: z.string().describe("New document content (full replacement)"),
};
```

**Current implementation (lines 19–53):**
```typescript
server.tool(
  "update_project_doc",
  "Update a project document. Reads the existing doc, replaces with new content.",
  UpdateDocSchema,
  async (params) => {
    try {
      const projectDir = getProjectDir(params.slug);
      if (!existsSync(projectDir)) {
        return formatError(projectNotFound(params.slug));
      }
      
      const fileName = PROJECT_DOC_FILES[params.doc];
      if (!fileName) {
        return formatError(invalidDocType(params.doc));
      }
      
      const filePath = resolve(projectDir, fileName);
      await writeFile(filePath, params.content, "utf-8");
      
      return {
        content: [
          {
            type: "text" as const,
            text: `✅ Updated ${params.doc} for project "${params.slug}".`,
          },
        ],
      };
    } catch (err) {
      return errorResult(err);
    }
  },
);
```

### 2. update_project_plan_body (from project-plans.ts lines 198–238)

**Current schema:**
```typescript
server.tool(
  "update_project_plan_body",
  "Update a plan's markdown body content.",
  {
    slug: z.string().describe("Project slug"),
    planId: z.string().describe("Plan identifier"),
    body: z.string().describe("New markdown body content"),
  },
  // ...
);
```

**Current implementation (lines 199–238):**
```typescript
async (params) => {
  try {
    const projectDir = getProjectDir(params.slug);
    if (!existsSync(projectDir)) {
      return formatError(projectNotFound(params.slug));
    }
    
    const normalizedId = normalizeIdentifier(params.planId);
    const metaPath = resolve(projectDir, "plans", `${normalizedId}.meta.json`);
    
    if (!existsSync(metaPath)) {
      return formatError(itemNotFound("plan", params.planId));
    }
    
    const rawMeta = await readJsonSafe<unknown>(metaPath);
    if (rawMeta === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
    const existingMeta = validateJson(rawMeta, planMetaSchema, metaPath);
    const bodyPath = resolve(projectDir, existingMeta.file);
    
    // Write the new body
    await writeFile(bodyPath, params.body, "utf-8");
    
    // Update the meta's updatedAt by calling updatePlan with just id
    const meta = await updatePlan(projectDir, { id: params.planId });
    
    return jsonResult({ meta, body: params.body });
  } catch (err) {
    if (err instanceof DagError) return formatError(err);
    return errorResult(err);
  }
}
```

### 3. update_project_knowledge_body (from project-knowledge.ts lines 198–238)

**Current schema:**
```typescript
server.tool(
  "update_project_knowledge_body",
  "Update a knowledge entry's markdown body content.",
  {
    slug: z.string().describe("Project slug"),
    entryId: z.string().describe("Entry identifier"),
    body: z.string().describe("New markdown body content"),
  },
  // ...
);
```

**Current implementation (lines 199–238):**
```typescript
async (params) => {
  try {
    const projectDir = getProjectDir(params.slug);
    if (!existsSync(projectDir)) {
      return formatError(projectNotFound(params.slug));
    }
    
    const normalizedId = normalizeIdentifier(params.entryId);
    const metaPath = resolve(projectDir, "knowledge", `${normalizedId}.meta.json`);
    
    if (!existsSync(metaPath)) {
      return formatError(itemNotFound("knowledge entry", params.entryId));
    }
    
    const rawMeta = await readJsonSafe<unknown>(metaPath);
    if (rawMeta === undefined) throw invalidFileFormat(metaPath, "unable to parse JSON");
    const existingMeta = validateJson(rawMeta, knowledgeMetaSchema, metaPath);
    const bodyPath = resolve(projectDir, existingMeta.file);
    
    // Write the new body
    await writeFile(bodyPath, params.body, "utf-8");
    
    // Update the meta's updatedAt by calling updateKnowledgeEntry with just id
    const meta = await updateKnowledgeEntry(projectDir, { id: params.entryId });
    
    return jsonResult({ meta, body: params.body });
  } catch (err) {
    if (err instanceof DagError) return formatError(err);
    return errorResult(err);
  }
}
```

### dryRun Implementation Pattern

For each tool, add `dryRun: z.boolean().optional().default(false)` to schema, then:

```typescript
// Only write if not dryRun
if (!params.dryRun) {
  await writeFile(filePath, params.content, "utf-8");
  return { content: [{ type: "text", text: `✅ Updated ...` }] };
} else {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          dryRun: true,
          message: `Would update ${params.doc}`,
          preview: params.content.slice(0, 200),
        }, null, 2),
      },
    ],
  };
}
```

---

## GENERAL: Testing & Build Setup

### Test Structure

**Framework:** Vitest (see package.json line 43)  
**Test command:** `npm run test` (runs `vitest run`)

**Test helper location:** `/home/rryando/Work/SPOC/test/helpers/`

**Test server setup template (from test/helpers/test-server.ts):**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectKnowledgeTools } from "../../src/tools/project-knowledge.js";

type ToolRegistration = (server: McpServer) => void;

const defaultRegistrations: ToolRegistration[] = [
  registerInitProject,
  registerGetProject,
  registerUpdateDoc,
  registerProjectPlanTools,
  registerProjectKnowledgeTools,
  registerProjectTaskTools,
  // ... etc
];

export function createTestServer(): McpServer {
  const server = new McpServer({
    name: "spoc-test-server",
    version: "1.0.0",
  });
  
  for (const register of defaultRegistrations) {
    register(server);
  }
  
  registerProjectResources(server);
  return server;
}

export async function invokeJsonTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return withConnectedClient(server, async (client) => {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) {
      throw new Error(result.content[0].text);
    }
    return JSON.parse(result.content[0].text);
  });
}
```

**Representative tool test (from test/project-knowledge.test.ts):**

```typescript
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("project-knowledge tools", () => {
  it("full knowledge lifecycle: create, list, get, update meta, update body", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        // 1. Initialize project
        await invokeJsonTool(server, "init_project", {
          name: "My Project",
          description: "Test project",
        });
        
        // 2. Create knowledge entry
        const createResult = await invokeJsonTool(server, "create_project_knowledge_entry", {
          slug: "my-project",
          title: "Auth flow module",
          kind: "module",
          summary: "Explains auth boundaries.",
          entryId: "Auth Flow Module",
          keywords: ["auth", "session"],
          body: "# Auth flow module\n",
        });
        expect(createResult.meta.kind).toBe("module");
        
        // 3. List with filters
        const listResult = await invokeJsonTool(server, "list_project_knowledge_entries", {
          slug: "my-project",
          kind: "module",
          keywords: ["auth", "missing"],
        });
        expect(listResult.entries).toHaveLength(1);
        
        // ... additional assertions
      } finally {
        server = null; // cleanup
      }
    });
  });
});
```

### CHANGELOG Convention

**Status:** No CHANGELOG.md exists in the SPOC repository.

**Recommendation:** Check git log for patterns:
```bash
git log --oneline | head -20
```

Current test and code patterns suggest commits are organized by tool/feature. Consider adding a CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/) format when adding new tools.

### Package.json Test Command

**Location:** `/home/rryando/Work/SPOC/package.json` lines 19–30

```json
"scripts": {
  "build": "tsc",
  "build:opencode-bundle": "node scripts/build-opencode-superpowers-bundle.mjs",
  "prepack": "npm run build:opencode-bundle",
  "start": "node dist/index.js",
  "dev": "tsc --watch",
  "test": "vitest run",
  "init": "npm run build && node dist/index.js init",
  "lint": "biome check src/ test/",
  "lint:fix": "biome check --fix src/ test/",
  "format": "biome format --write src/ test/",
  "typecheck": "tsc --noEmit"
}
```

**To run tests:**
```bash
npm run test          # Run once
npm run test -- --watch  # Watch mode (vitest-specific)
```

**Linting:** Biome (lines 27–29) — check & fix code style

---

## Summary: Key Patterns to Mirror

| Area | Pattern | File Location |
|------|---------|----------------|
| **Tool registration** | `export function register*Tools(server: McpServer)` with `server.tool()` | All `src/tools/*.ts` |
| **Input validation** | Zod schemas inline in `server.tool()` call | All tools |
| **Success response** | `jsonResult({ ...data })` or custom object | `src/utils/tool-response.ts` |
| **Error handling** | `DagError` → `formatError()`, unknown → `errorResult()` | All tools |
| **File paths** | `resolve(projectDir, ...)` with `existsSync()` checks | Consistent across tools |
| **Meta with timestamps** | `.meta.json` files with `createdAt`, `updatedAt` | Plans, knowledge, tasks |
| **Keyword filtering** | Any-match semantics (union of provided keywords) | Knowledge & plan list tools |
| **sourceFiles** | Array of `{ path, anchor? }`, path relative from workspace root | Knowledge, plans, tasks |
| **Task rendering** | Extract from `tasks.md` markdown with `[/]`, `[ ]`, `[x]`, `[~]` markers | `content-assembly.ts` |
| **Context assembly** | T0–T4 tier system for information loading | `resolve-context.ts` |
| **Tests** | Vitest + temp data dir helpers + invokeJsonTool wrapper | `test/` directory |

---

## Gotchas & Notes

1. **Task index vs. individual files**: Tasks are stored in `tasks/index.json` (not individual `.meta.json` files like plans/knowledge)
2. **Keyword lowercasing**: Keywords are stored lowercase; search filters should normalize to lowercase before matching
3. **Stale index detection**: Knowledge and plan indexes rebuild on read if any `.meta.json` file is newer than the index entry
4. **sourceFiles validation**: Backslash paths are normalized to forward slashes; relative paths cannot start with `/` or contain `..`
5. **T0 context**: Operating brief is derived from task lines (not the full task index), so task creation doesn't immediately show up in resolve_project_context
6. **DagError vs. unknown**: All domain errors inherit from `DagError` for proper formatting; use `formatError()` for these, `errorResult()` only as fallback
7. **Workspace path matching**: Segment-aware to prevent false prefix matches (e.g., "/Users/ryan" won't match "/Users/ryan.ryn")

---

**END OF REPORT**
