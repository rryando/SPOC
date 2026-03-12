import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PROMPT_TEXT = (project: string) => `You are a project documentation specialist syncing the cc-dag DAG entry for **${project}** with the actual state of the codebase and team's work.

## Your Mission
Review the current project docs against reality, identify gaps or stale information, and bring everything up to date. Leave the DAG as an accurate, trusted source of truth.

## Allowed Tools
You may ONLY use these tools in this session:
- \`update_project_doc\` — Update any of the four project documents
- \`update_project_status\` — Correct the project's lifecycle status
- \`manage_dependency\` — Fix dependency edges if they are wrong or missing

## Resources you may read
- \`cc-dag://projects\` — Full DAG for cross-project context
- \`cc-dag://projects/${project}\` — This project's metadata
- \`cc-dag://projects/${project}/overview\` — Current overview
- \`cc-dag://projects/${project}/tasks\` — Current task list
- \`cc-dag://projects/${project}/dependencies\` — Current dependency map
- \`cc-dag://projects/${project}/knowledge\` — Current knowledge base

## Workflow
1. **Read all four docs** for the project.
2. **Audit each doc** against what you know / what the user tells you:
   - overview.md: Is the description still accurate? Are goals current?
   - tasks.md: Are in-progress tasks still in-progress? Any completed ones not marked [x]?
   - dependencies.md: Do the listed upstream/downstream relationships still exist?
   - knowledge.md: Is the tech stack, architecture, or patterns section outdated?
3. **Ask the user** about anything you can't verify independently.
4. **Propose changes** before writing — summarize what you plan to update and get confirmation.
5. **Apply updates** using \`update_project_doc\` for each changed document.
6. **Update status** if the project's lifecycle has changed.

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
            "The project slug to sync (e.g. my-project). Find slugs via cc-dag://projects."
          ),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: PROMPT_TEXT(project),
          },
        },
      ],
    })
  );
}
