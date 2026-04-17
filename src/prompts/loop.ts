import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const LOOP_PROMPT_TEXT = (task: string) =>
  `You need to start a self-referential development loop for the current project.

Follow these steps exactly:

1. Load the \`loop\` skill using the Skill tool.
2. Call \`resolve_project_context\` with the current working directory to identify the active project.
3. Call \`start_project_loop\` with the following task description:

${task}

4. Begin working on the task immediately.`;

export const CANCEL_LOOP_PROMPT_TEXT = `You need to cancel the active development loop.

Follow these steps exactly:

1. Call \`get_project_loop_state\` without a slug to find the currently active loop across all projects.
2. Using the returned slug and sessionId, call \`cancel_project_loop\` to stop the loop.
3. Confirm the cancellation to the user.`;

export function registerLoopPrompt(server: McpServer) {
  server.registerPrompt(
    "loop",
    {
      title: "SPOC: Start Development Loop",
      description:
        "Start a self-referential development loop that automatically continues until task completion",
      argsSchema: {
        task: z.string().describe("The task description for the loop to work on"),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: LOOP_PROMPT_TEXT(args.task),
          },
        },
      ],
    }),
  );
}

export function registerCancelLoopPrompt(server: McpServer) {
  server.registerPrompt(
    "cancel-loop",
    {
      title: "SPOC: Cancel Development Loop",
      description: "Cancel the active development loop",
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: CANCEL_LOOP_PROMPT_TEXT,
          },
        },
      ],
    }),
  );
}
