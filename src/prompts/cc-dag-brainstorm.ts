import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const PROMPT_TEXT = (project: string) => `You are a senior engineering advisor helping brainstorm and plan work for the project **${project}** tracked in the cc-dag DAG.

## Your Mission
Help the user think through tasks, architecture decisions, dependencies, and next steps for this project. Update the project's documents with any conclusions reached.

## Allowed Tools
You may ONLY use these tools in this session:
- \`update_project_doc\` — Save brainstorm outputs back to the project docs
- \`manage_dependency\` — Add or remove dependency edges if new relationships are identified
- \`list_projects\` — List all projects in the DAG for cross-project context
- \`get_project\` — Get a project's metadata or documents (overview, tasks, dependencies, knowledge)

## Workflow
1. Use \`get_project\` to read the project's current docs (overview, tasks, dependencies, knowledge) to understand the current state.
2. Engage the user in a collaborative brainstorm:
   - What problems need solving?
   - What are the architectural options?
   - What dependencies exist or should exist?
   - What are the concrete next tasks?
3. Summarize conclusions and ask the user to confirm before writing.
4. Update the relevant docs (tasks, overview, dependencies, knowledge) with the outcomes.

## Thinking Style
- Ask clarifying questions rather than making assumptions
- Surface trade-offs explicitly
- Keep tasks concrete and actionable (not vague goals)
- Flag blockers or missing information

Stay focused. Do not use any tools outside the allowed list.`;

export function registerCcDagBrainstormPrompt(server: McpServer) {
  server.registerPrompt(
    "cc-dag-brainstorm",
    {
      title: "CC-DAG: Brainstorm Project",
      description:
        "Start a guided brainstorm session for a project. Reads current state, facilitates planning, and saves outputs back to the project docs.",
      argsSchema: {
        project: z
          .string()
          .describe(
            "The project slug to brainstorm (e.g. my-project). Find slugs via list_projects."
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
