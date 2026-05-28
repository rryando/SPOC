// ---------------------------------------------------------------------------
// next — Tell the user what to work on next with relevant context
// ---------------------------------------------------------------------------

import { listTasks, readPlanIndex } from "../../utils/project-memory.js";
import { resolveProject } from "../../utils/project-resolver.js";
import { deriveOperatingBrief } from "../../utils/workflow-policy.js";
import { type CLIResult, type CommandFlags, defineCommand } from "../command-registry.js";
import { failure, success } from "../output-envelope.js";

// ---------------------------------------------------------------------------

defineCommand({
  path: "next",
  description: "Show the next task to work on with relevant context",
  params: {
    slug: {
      type: "string",
      positional: 0,
      description: "Project slug or path",
    },
  },
  handler: handleNext,
});

// ---------------------------------------------------------------------------

async function handleNext(
  params: Record<string, unknown>,
  flags: CommandFlags,
): Promise<CLIResult> {
  const rawArg = params.slug as string | undefined;

  const resolved = await resolveProject(rawArg);
  if (!resolved.ok) return resolved.result;

  const { slug, projectDir } = resolved;

  const [allTasks, planIndex] = await Promise.all([
    listTasks(projectDir),
    readPlanIndex(projectDir),
  ]);

  const openTasks = allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");

  if (openTasks.length === 0) {
    if (flags.json) {
      return success({ message: "Nothing to do. All tasks complete or no active plans." });
    }
    return success("Nothing to do. All tasks complete or no active plans.");
  }

  const brief = deriveOperatingBrief({
    tasks: allTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      planId: t.planId,
      priority: t.priority,
    })),
    plans: planIndex.plans.map((p) => ({ id: p.id, title: p.title, status: p.status })),
  });

  // Pick the top open task — prefer in_progress, then backlog by priority order
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const sorted = [...openTasks].sort((a, b) => {
    if (a.status === "in_progress" && b.status !== "in_progress") return -1;
    if (b.status === "in_progress" && a.status !== "in_progress") return 1;
    const pa = priorityOrder[a.priority ?? "medium"] ?? 1;
    const pb = priorityOrder[b.priority ?? "medium"] ?? 1;
    return pa - pb;
  });

  const task = sorted[0]!;
  const plan = task.planId ? planIndex.plans.find((p) => p.id === task.planId) : undefined;

  const contextParts: string[] = [];
  if (plan?.summary) contextParts.push(plan.summary);
  if (brief.why) contextParts.push(brief.why);
  const context = contextParts.join(" ") || `Work on: ${task.title}`;

  const doneCommand = `spoc done ${slug} ${task.id}`;

  if (flags.json) {
    return success({
      task: {
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority ?? "medium",
      },
      context,
      planTitle: plan?.title ?? null,
      command: doneCommand,
    });
  }

  const lines: string[] = [
    `Next: ${task.title}`,
    plan ? `Plan: ${plan.title}` : "",
    `Priority: ${task.priority ?? "medium"}`,
    "",
    "Context:",
    context,
    "",
    `When done: ${doneCommand}`,
  ].filter((l, i) => i === 0 || l !== "" || i > 3);

  return success(lines.join("\n"));
}
