import { describe, expect, it } from "vitest";
import {
  chooseCurrentFocus,
  deriveOperatingBrief,
  recommendSurface,
} from "../src/utils/workflow-policy.js";

describe("workflow policy", () => {
  it("recommends queue for a small standalone action", () => {
    expect(
      recommendSurface({
        hasPlanSignals: false,
        hasDurableKnowledgeSignal: false,
        itemLabel: "Rename one function across two files",
      })
    ).toEqual({
      surface: "queue",
      why: expect.stringMatching(/execution state|small standalone/i),
    });
  });

  it("recommends plan for multi-step coordinated work", () => {
    expect(
      recommendSurface({
        hasPlanSignals: true,
        hasDurableKnowledgeSignal: false,
        itemLabel: "Add operating brief across prompts and context resolution",
      }).surface
    ).toBe("plan");
  });

  it("recommends memory for durable discoveries", () => {
    expect(
      recommendSurface({
        hasPlanSignals: false,
        hasDurableKnowledgeSignal: true,
        itemLabel: "Document focus-selection gotcha",
      }).surface
    ).toBe("memory");
  });

  it("prefers memory when both plan and durable knowledge signals are present", () => {
    expect(
      recommendSurface({
        hasPlanSignals: true,
        hasDurableKnowledgeSignal: true,
        itemLabel: "Auth System",
      }).surface
    ).toBe("memory");
  });

  it("prefers the most recently updated in-progress plan over tasks", () => {
    expect(
      chooseCurrentFocus({
        plans: [
          {
            title: "Older plan",
            status: "in_progress",
            updatedAt: "2026-03-17T00:00:00.000Z",
          },
          {
            title: "Newer plan",
            status: "in_progress",
            updatedAt: "2026-03-18T00:00:00.000Z",
          },
        ],
        inProgressTasks: ["- [/] Update docs"],
        backlogTasks: ["- [ ] First backlog item"],
      })
    ).toEqual({
      kind: "plan",
      label: "Newer plan",
    });
  });

  it("preserves stable plan order when recency cannot be determined", () => {
    expect(
      chooseCurrentFocus({
        plans: [
          {
            title: "First plan",
            status: "in_progress",
            updatedAt: "not-a-date",
          },
          {
            title: "Second plan",
            status: "in_progress",
          },
        ],
        inProgressTasks: ["- [/] Update docs"],
        backlogTasks: ["- [ ] First backlog item"],
      })
    ).toEqual({
      kind: "plan",
      label: "First plan",
    });
  });

  it("falls back to first in-progress task when no in-progress plan exists", () => {
    expect(
      chooseCurrentFocus({
        plans: [],
        inProgressTasks: ["- [/] First task", "- [/] Second task"],
        backlogTasks: ["- [ ] Backlog item"],
      })
    ).toEqual({
      kind: "task",
      label: "First task",
    });
  });

  it("falls back to first backlog item when nothing is in progress", () => {
    expect(
      chooseCurrentFocus({
        plans: [],
        inProgressTasks: [],
        backlogTasks: ["- [ ] First backlog item", "- [ ] Second backlog item"],
      })
    ).toEqual({
      kind: "task",
      label: "First backlog item",
    });
  });

  it("returns no current focus and a safe fallback next action when state is empty", () => {
    expect(
      deriveOperatingBrief({
        plans: [],
        inProgressTasks: [],
        backlogTasks: [],
        hasDurableKnowledgeSignal: false,
      })
    ).toEqual({
      currentFocus: "None",
      recommendedSurface: "queue",
      why: expect.any(String),
      nextAction: expect.stringMatching(/review backlog|create the next plan/i),
    });
  });
});
