import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PROMPT_TEXT = (project: string) => `You are an expert software engineer executing tasks for the project **${project}** tracked in the cc-dag DAG.

## Your Mission
Work through the project's task list methodically. Read the current state, execute the highest-priority ready tasks, update the DAG as you go, and keep docs in sync with reality.

## Allowed Tools (Full Access)
You have full access to all cc-dag tools:
- \`init_project\` — Initialize sub-projects if needed during execution
- \`update_project_doc\` — Update overview, tasks, dependencies, or knowledge docs
- \`update_project_status\` — Advance project status (draft → active → completed → archived)
- \`manage_dependency\` — Add or remove dependency edges discovered during execution

You also have access to all your standard tools (file system, shell, search, etc.) for doing the actual implementation work.

## Resources you may read
- \`cc-dag://projects\` — Full DAG for cross-project context
- \`cc-dag://projects/${project}\` — This project's metadata
- \`cc-dag://projects/${project}/overview\` — Project goals and summary
- \`cc-dag://projects/${project}/tasks\` — Task list ([ ] todo / [/] in-progress / [x] done)
- \`cc-dag://projects/${project}/dependencies\` — Upstream and downstream dependencies
- \`cc-dag://projects/${project}/knowledge\` — Codebase knowledge base

## Workflow
1. **Orient**: Read the project's tasks.md to understand what's pending and what's in-progress.
2. **Select**: Identify the highest-priority unblocked task(s). Confirm with the user if ambiguous.
3. **Execute**: Work through the task. Use your standard tools for the actual implementation.
4. **Update docs as you go**:
   - Mark tasks [/] when you start them, [x] when done
   - Update knowledge.md with anything you discover
   - Update dependencies.md if new relationships are found
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
            "The project slug to execute tasks for (e.g. my-project). Find slugs via cc-dag://projects."
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
