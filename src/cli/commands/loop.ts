// ---------------------------------------------------------------------------
// Loop commands — start, cancel, status (registry-based)
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";
import { cancelLoop, findActiveLoop, readLoopState, startLoop } from "../../utils/loop-state.js";
import { getProjectDir } from "../../utils/paths.js";
import {
  type CLIResult,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
} from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

// ---------------------------------------------------------------------------
// loop start
// ---------------------------------------------------------------------------

defineCommand({
  path: "loop start",
  description: "Start an iterative loop for a project session",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    prompt: { type: "string", required: true, description: "Loop prompt text" },
    session: { type: "string", required: true, description: "Session ID" },
    "max-iterations": { type: "number", default: 100, description: "Maximum iteration count" },
    "completion-promise": {
      type: "string",
      default: "DONE",
      description: "Completion promise tag",
    },
    strategy: {
      type: "string",
      enum: ["continue", "reset"],
      default: "continue",
      description: "Loop strategy",
    },
  },
  handler: handleLoopStart,
});

async function handleLoopStart(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const prompt = params.prompt as string;
  const session = params.session as string;
  const maxIterations = (params["max-iterations"] as number) ?? 100;
  const completionPromise = (params["completion-promise"] as string) ?? "DONE";
  const strategy = (params.strategy as "continue" | "reset") ?? "continue";

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (flags.dryRun) {
    return success({
      dryRun: true,
      wouldStart: { slug, session, prompt, maxIterations, completionPromise, strategy },
    });
  }

  try {
    const state = await startLoop(projectDir, {
      sessionId: session,
      prompt,
      maxIterations,
      completionPromise,
      strategy,
      projectSlug: slug,
    });
    return success({ message: `Loop started for project "${slug}"`, state });
  } catch (err) {
    return failure("loop_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// loop cancel
// ---------------------------------------------------------------------------

defineCommand({
  path: "loop cancel",
  description: "Cancel an active loop for a project session",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    session: { type: "string", required: true, description: "Session ID to cancel" },
  },
  handler: handleLoopCancel,
});

async function handleLoopCancel(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string;
  const session = params.session as string;

  const projectDir = getProjectDir(slug);
  if (!existsSync(projectDir)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  if (flags.dryRun) {
    return success({ dryRun: true, wouldCancel: { slug, session } });
  }

  try {
    const cancelled = await cancelLoop(projectDir, session);
    return success({ slug, session, cancelled });
  } catch (err) {
    return failure("loop_error", err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// loop status
// ---------------------------------------------------------------------------

defineCommand({
  path: "loop status",
  description: "Show loop status for a project or find active loop globally",
  mutation: false,
  params: {
    slug: {
      type: "string",
      required: false,
      positional: 0,
      description: "Project slug (omit to find any active loop)",
    },
  },
  handler: handleLoopStatus,
});

async function handleLoopStatus(
  params: Record<string, unknown>,
  _flags: CommandFlags,
): Promise<CLIResult> {
  const slug = params.slug as string | undefined;

  try {
    if (slug) {
      const projectDir = getProjectDir(slug);
      if (!existsSync(projectDir)) {
        return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
      }
      const state = await readLoopState(projectDir);
      return success({ slug, state });
    }

    const active = await findActiveLoop();
    if (active) {
      return success({ slug: active.slug, state: active.state });
    }
    return success({ message: "No active loop found.", state: null });
  } catch (err) {
    return failure("loop_error", err instanceof Error ? err.message : String(err));
  }
}
