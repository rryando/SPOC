import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SYNC_PROMPT_TEXT = (project: string) => `You are a project documentation specialist syncing the SPOC DAG entry for **${project}** with the actual state of the codebase and team's work.

## Your Mission
Review the current summary docs and structured plan/knowledge indexes against reality, re-scan the codebase to identify gaps or stale information, and bring everything up to date. Leave the DAG as an accurate, trusted source of truth.

Use the agent-facing model of queue / plan / memory while syncing:
- queue = immediate execution state in tasks.md
- plan = durable multi-step change records
- memory = durable reusable discoveries

## Allowed Tools
You may ONLY use these tools in this session:
- \`update_project_doc\` — Update any of the four project documents
- \`update_project_status\` — Correct the project's lifecycle status
- \`manage_dependency\` — Fix dependency edges if they are wrong or missing
- \`list_projects\` — List all projects in the DAG for cross-project context
- \`get_project\` — Get a project's metadata or documents (pass slug and optionally doc type)
- \`list_project_plans\` — List structured plans for the project
- \`get_project_plan\` — Read a plan's metadata and body
- \`update_project_plan_meta\` — Update a plan's status, title, summary, or keywords
- \`create_project_plan\` — Create a new structured plan for newly discovered work
- \`list_project_knowledge_entries\` — List structured knowledge entries for the project
- \`get_project_knowledge_entry\` — Read a knowledge entry's metadata and body
- \`update_project_knowledge_meta\` — Update a knowledge entry's kind, title, summary, or keywords
- \`create_project_knowledge_entry\` — Create new knowledge entries for discoveries
- \`update_project_knowledge_body\` — Update the detailed body of a knowledge entry

You also have standard file exploration tools (file reads, directory listing, grep/search) to re-scan the repository.

## Workflow

### Step 1 — Read Current State
1. **Read all four docs** for the project using \`get_project\` with slug="${project}" and each doc type (overview, tasks, dependencies, knowledge).
2. **Read structured stores**: call \`list_project_plans\` and \`list_project_knowledge_entries\` to review all indexed records.
3. **Use the operating brief** from resolved project context if available to validate current focus and recommended surface against reality.

### Step 2 — Re-scan the Codebase
4. **Re-scan the repository** using file reads, directory listing, and grep/search to detect changes since the last sync:
   - New or removed files, modules, services, or dependencies
   - Changed code patterns, architecture decisions, or conventions
   - New features or deprecated functionality
   - Updated tech stack versions or tooling

### Step 3 — Audit and Reconcile
5. **Audit** summary docs and structured plan/knowledge indexes against what you discovered:
   - overview.md: Is the description still accurate? Are goals current?
   - tasks.md: Are in-progress tasks still in-progress? Any completed ones not marked [x]?
   - dependencies.md: Do the listed upstream/downstream relationships still exist?
   - knowledge.md: Is the landing page summary still accurate?
   - plans/: Are plan statuses current? Any plans that should be marked done or archived?
      - Check for externally-created plans using keyword filters: \`list_project_plans(slug, keywords: ["spec"])\` for design specs, \`list_project_plans(slug, keywords: ["implementation-plan"])\` for implementation plans. Verify their statuses match the actual state of work.
   - knowledge/: Are entries still accurate? Any missing entries for recent discoveries?
6. **Ask the user** about anything you can't verify independently.

### Step 4 — Apply Updates
7. **Propose changes** before writing — summarize what you plan to update and get confirmation.
8. **Apply updates**:
   - Use \`update_project_doc\` for summary docs
   - Use \`update_project_plan_meta\` to correct plan statuses
   - Use \`update_project_knowledge_meta\` to correct entry metadata
   - Use \`update_project_knowledge_body\` to refresh entry content with new findings
   - Use \`create_project_knowledge_entry\` + \`update_project_knowledge_body\` for **new** discoveries that deserve their own entries (e.g. new modules, new services, changed patterns)
   - Use \`create_project_plan\` for newly discovered work items that should be tracked
9. **Update status** if the project's lifecycle has changed.

## Output
End the session with a brief sync report:
- Docs updated: [list]
- Knowledge entries created/updated: [list]
- Plans created/updated: [list]
- Key changes: [summary]
- Outstanding gaps: [anything that still needs attention]

Stay focused. Do not use any tools outside the allowed list.`;

export function registerSpocSyncPrompt(server: McpServer) {
  server.registerPrompt(
    "spoc-sync",
    {
      title: "SPOC: Sync Project Docs",
      description:
        "Start a sync session to reconcile a project's DAG entry with its real-world state. Audits all four docs and updates them to be current and accurate.",
      argsSchema: {
        project: z
          .string()
          .describe(
            "The project slug to sync (e.g. my-project). Find slugs via list_projects."
          ),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: SYNC_PROMPT_TEXT(project),
          },
        },
      ],
    })
  );
}
