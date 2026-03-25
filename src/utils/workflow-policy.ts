import { stripTaskCheckbox } from "./content-assembly.js";

export type WorkflowSurface = "queue" | "plan" | "memory";

export interface WorkflowPlanCandidate {
  title: string;
  status: string;
  updatedAt?: string;
}

export interface CurrentFocus {
  kind: "plan" | "task" | "none";
  label: string;
}

export interface OperatingBrief {
  currentFocus: string;
  recommendedSurface: WorkflowSurface;
  why: string;
  nextAction: string;
}

export function chooseCurrentFocus(input: {
  plans: WorkflowPlanCandidate[];
  inProgressTasks: string[];
  backlogTasks: string[];
}): CurrentFocus {
  const inProgressPlans = input.plans.filter((plan) => plan.status === "in_progress");

  if (inProgressPlans.length > 0) {
    const sorted = [...inProgressPlans].sort((a, b) => {
      const aTime = safeTime(a.updatedAt);
      const bTime = safeTime(b.updatedAt);
      return bTime - aTime;
    });

    return { kind: "plan", label: sorted[0]?.title ?? "Unknown plan" };
  }

  if (input.inProgressTasks.length > 0) {
    return {
      kind: "task",
      label: stripTaskCheckbox(input.inProgressTasks[0] ?? ""),
    };
  }

  if (input.backlogTasks.length > 0) {
    return {
      kind: "task",
      label: stripTaskCheckbox(input.backlogTasks[0] ?? ""),
    };
  }

  return { kind: "none", label: "None" };
}

export function recommendSurface(input: {
  hasPlanSignals: boolean;
  hasDurableKnowledgeSignal: boolean;
  itemLabel?: string;
}): { surface: WorkflowSurface; why: string } {
  if (input.hasDurableKnowledgeSignal) {
    return {
      surface: "memory",
      why: "This should outlive the current task and be reusable later.",
    };
  }

  if (input.hasPlanSignals) {
    return {
      surface: "plan",
      why: "This work spans multiple steps and needs durable planning context.",
    };
  }

  return {
    surface: "queue",
    why: "This is best tracked as immediate execution state.",
  };
}

export function deriveOperatingBrief(input: {
  plans: WorkflowPlanCandidate[];
  inProgressTasks: string[];
  backlogTasks: string[];
  hasDurableKnowledgeSignal: boolean;
}): OperatingBrief {
  const focus = chooseCurrentFocus(input);
  const recommendation = recommendSurface({
    hasPlanSignals: focus.kind === "plan",
    hasDurableKnowledgeSignal: input.hasDurableKnowledgeSignal,
    itemLabel: focus.label,
  });

  if (focus.kind === "none") {
    return {
      currentFocus: "None",
      recommendedSurface: "queue",
      why: "No active focus was detected, so the safest default is the execution queue.",
      nextAction:
        "Review the backlog and either start the next queue item or create the next plan.",
    };
  }

  return {
    currentFocus: focus.label,
    recommendedSurface: recommendation.surface,
    why: recommendation.why,
    nextAction:
      focus.kind === "plan"
        ? `Continue the active plan "${focus.label}" and keep related task status aligned.`
        : `Continue the queue item "${focus.label}" and update task status as work progresses.`,
  };
}

export function safeTime(value?: string): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}
