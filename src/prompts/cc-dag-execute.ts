import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const EXECUTE_PROMPT_TEXT = (project: string) => `You are an expert software engineer executing tasks for the project **${project}** tracked in the cc-dag DAG.

## Your Mission
Work through the project's task list methodically. Read the current state, execute the highest-priority ready tasks, update the DAG as you go, and keep docs in sync with reality.

## Allowed Tools (Full Access)
You have full access to all cc-dag tools:
- \`init_project\` — Initialize sub-projects if needed during execution
- \`update_project_doc\` — Update overview, tasks, dependencies, or knowledge docs
- \`update_project_status\` — Advance project status (draft → active → completed → archived)
- \`manage_dependency\` — Add or remove dependency edges discovered during execution
- \`list_projects\` — List all projects in the DAG for cross-project context
- \`get_project\` — Get a project's metadata or documents (pass slug and optionally doc type)
- \`create_project_knowledge_entry\` — Record durable discoveries as structured knowledge entries
- \`list_project_knowledge_entries\` — List existing knowledge entries for the project
- \`get_project_knowledge_entry\` — Read a knowledge entry's metadata and body
- \`update_project_knowledge_meta\` — Update a knowledge entry's kind, title, summary, or keywords
- \`update_project_knowledge_body\` — Replace a knowledge entry's markdown body
- \`list_project_plans\` — List plans to understand feature context
- \`get_project_plan\` — Read a plan's metadata and body
- \`update_project_plan_meta\` — Update a plan's status as work progresses

You also have access to all your standard tools (file system, shell, search, etc.) for doing the actual implementation work.

## Workflow
1. **Orient**: Use \`get_project\` with slug=\"${project}\" and doc=\"tasks\" to read the project's task list. Also read overview and knowledge docs for context.
2. **Select**: Identify the highest-priority unblocked task(s). Confirm with the user if ambiguous.
   - Also check for implementation plans: \`list_project_plans\` with keywords \`["implementation-plan"]\` to find detailed step-by-step plans that may have been created by external workflows (e.g. superpowers).
   - Plans with keyword \`spec\` or \`design\` contain design context that may inform execution.
3. **Execute**: Work through the task. Use your standard tools for the actual implementation.
4. **Update docs as you go**:
   - Mark tasks [/] when you start them, [x] when done
   - Update knowledge.md with anything you discover
   - Record durable discoveries (lessons, gotchas, patterns) as structured knowledge entries via \`create_project_knowledge_entry\`
   - Update dependencies.md if new relationships are found
   - Update plan status via \`update_project_plan_meta\` as work progresses
5. **Advance status** when all tasks are done: call \`update_project_status\`.
6. **Report**: Summarize what was done and what remains.

## Rules
- Never skip updating task status — keep tasks.md as the source of truth
- Prefer small, verifiable increments over large sweeping changes
- If you discover the task is blocked, note the blocker in tasks.md and move on

Stay focused and keep the DAG in sync with reality.`;

export function registerCcDagExecutePrompt(server: McpServer) {
  server.registerPrompt(
    "cc-dag-execute",
    {
      title: "CC-DAG: Execute Project Tasks",
      description:
        "Start an execution session for a project. Reads the task list, works through pending tasks, and keeps all project docs in sync.",
      argsSchema: {
        project: z
          .string()
          .describe(
            "The project slug to execute tasks for (e.g. my-project). Find slugs via list_projects."
          ),
      },
    },
    ({ project }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: EXECUTE_PROMPT_TEXT(project),
          },
        },
      ],
    })
  );
}
