import { describe, expect, it } from "vitest";
import { type BriefData, renderBrief } from "../src/cli/brief-renderer.js";

const sampleData: BriefData = {
  slug: "myapp",
  name: "myapp",
  summary: "A cool application for managing things.",
  operatingBrief: {
    currentFocus: "Implement the widget",
    recommendedSurface: "QUEUE",
    why: "Task in progress: Implement the widget",
    nextAction: "Continue task implement-the-widget",
  },
  activePlansCount: 2,
  activePlanTitles: ["Plan Alpha", "Plan Beta"],
  openTasksCount: 5,
  topOpenTasks: [
    { id: "t1", title: "Do thing A", status: "backlog" },
    { id: "t2", title: "Do thing B", status: "in_progress" },
    { id: "t3", title: "Do thing C", status: "backlog" },
  ],
  topKnowledge: [
    { id: "k1", title: "Important pattern", kind: "pattern" },
    { id: "k2", title: "A gotcha", kind: "gotcha" },
  ],
};

describe("renderBrief", () => {
  it("renders heading with project name", () => {
    const md = renderBrief(sampleData);
    expect(md).toMatch(/^# myapp\n/);
  });

  it("renders summary paragraph", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("A cool application for managing things.");
  });

  it("renders operating brief block with bold labels", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("**Focus:** Implement the widget");
    expect(md).toContain("**Surface:** QUEUE");
    expect(md).toContain("**Why:** Task in progress: Implement the widget");
    expect(md).toContain("**Next:** Continue task implement-the-widget");
  });

  it("renders active plans section with count and titles", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("## Active Plans (2)");
    expect(md).toContain("- Plan Alpha");
    expect(md).toContain("- Plan Beta");
  });

  it("renders 'None active.' when no plans", () => {
    const md = renderBrief({ ...sampleData, activePlansCount: 0, activePlanTitles: [] });
    expect(md).toContain("## Active Plans\nNone active.");
  });

  it("renders open tasks with checkbox markers", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("## Open Tasks (5)");
    expect(md).toContain("- [ ] Do thing A");
    expect(md).toContain("- [/] Do thing B");
    expect(md).toContain("- [ ] Do thing C");
  });

  it("renders ellipsis when more tasks than shown", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("- ...");
  });

  it("renders 'None open.' when no tasks", () => {
    const md = renderBrief({ ...sampleData, openTasksCount: 0, topOpenTasks: [] });
    expect(md).toContain("## Open Tasks\nNone open.");
  });

  it("renders top knowledge with kind in parens", () => {
    const md = renderBrief(sampleData);
    expect(md).toContain("## Top Knowledge");
    expect(md).toContain("- Important pattern (pattern)");
    expect(md).toContain("- A gotcha (gotcha)");
  });

  it("contains no ANSI escape sequences", () => {
    const md = renderBrief(sampleData);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape detection
    expect(md).not.toMatch(/\u001b\[/);
  });

  it("contains no box-drawing characters", () => {
    const md = renderBrief(sampleData);
    expect(md).not.toMatch(/[┌─┐│└┘┤├┬┴┼]/);
  });
});
