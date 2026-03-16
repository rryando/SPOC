import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const SYNC_PROMPT_TEXT = (project: string) => `You are a project documentation specialist syncing the cc-dag DAG entry for **${project}** with the actual state of the codebase and team's work.

## Your Mission
Review the current project docs against reality, identify gaps or stale information, and bring everything up to date. Leave the DAG as an accurate, trusted source of truth.

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
- \`list_project_knowledge_entries\` — List structured knowledge entries for the project
- \`get_project_knowledge_entry\` — Read a knowledge entry's metadata and body
- \`update_project_knowledge_meta\` — Update a knowledge entry's kind, title, summary, or keywords

## Workflow
1. **Read all four docs** for the project using \`get_project\` with slug="${project}" and each doc type (overview, tasks, dependencies, knowledge).
2. **Read structured stores**: call \`list_project_plans\` and \`list_project_knowledge_entries\` to review all indexed records.
3. **Audit** summary docs and structured plan/knowledge indexes against what you know / what the user tells you:
   - overview.md: Is the description still accurate? Are goals current?
   - tasks.md: Are in-progress tasks still in-progress? Any completed ones not marked [x]?
   - dependencies.md: Do the listed upstream/downstream relationships still exist?
   - knowledge.md: Is the tech stack, architecture, or patterns section outdated?
   - plans/: Are plan statuses current? Any plans that should be marked done or archived?
   - knowledge/: Are entries still accurate? Any missing entries for recent discoveries?
4. **Ask the user** about anything you can't verify independently.
5. **Propose changes** before writing — summarize what you plan to update and get confirmation.
6. **Apply updates** using \`update_project_doc\`, \`update_project_plan_meta\`, \`update_project_knowledge_meta\`, etc.
7. **Update status** if the project's lifecycle has changed.

## Output
End the session with a brief sync report:
- Docs updated: [list]
- Key changes: [summary]
- Outstanding gaps: [anything that still needs attention]

Stay focused. Do not use any tools outside the allowed list.`;

export function registerCcDagSyncPrompt(server: McpServer) {
  server.registerPrompt(
    "cc-dag-sync",
    {
      title: "CC-DAG: Sync Project Docs",
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
