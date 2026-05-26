import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/cli/md-renderer.js";

describe("renderMarkdown", () => {
  describe("Single entity", () => {
    it("task get renders title and status", () => {
      const md = renderMarkdown("task get", {
        title: "Fix the bug", status: "in_progress", priority: "high",
      });
      expect(md).toContain("**Fix the bug**");
      expect(md).toContain("Status: in_progress");
      expect(md).toContain("Priority: high");
    });

    it("task get includes planId when present", () => {
      const md = renderMarkdown("task get", {
        title: "T", status: "backlog", planId: "plan-123",
      });
      expect(md).toContain("Plan: plan-123");
    });

    it("task get defaults priority to medium", () => {
      const md = renderMarkdown("task get", { title: "T", status: "backlog" });
      expect(md).toContain("Priority: medium");
    });
  });

  describe("Task transition", () => {
    it("renders id: prev → new", () => {
      const md = renderMarkdown("task transition", {
        taskId: "abc-123", previousStatus: "backlog", newStatus: "in_progress",
      });
      expect(md).toBe("abc-123: backlog → in_progress");
    });
  });

  describe("Lists", () => {
    it("task list grouped by status with markers", () => {
      const md = renderMarkdown("task list", [
        { title: "A", status: "in_progress", priority: "high" },
        { title: "B", status: "backlog" },
        { title: "C", status: "done" },
        { title: "D", status: "cancelled" },
      ]);
      expect(md).toContain("## Tasks (4)");
      expect(md).toContain("- [/] A  [high]");
      expect(md).toContain("- [ ] B  [medium]");
      expect(md).toContain("- [x] C  [medium]");
      expect(md).toContain("- [-] D  [medium]");
    });

    it("plan list with status", () => {
      const md = renderMarkdown("plan list", [
        { title: "Alpha", status: "active" },
        { title: "Beta", status: "planned" },
      ]);
      expect(md).toContain("## Plans (2)");
      expect(md).toContain("- Alpha [active]");
      expect(md).toContain("- Beta [planned]");
    });

    it("knowledge list with kind", () => {
      const md = renderMarkdown("knowledge list", [
        { title: "Pattern X", kind: "pattern" },
      ]);
      expect(md).toContain("## Knowledge (1)");
      expect(md).toContain("- Pattern X (pattern)");
    });

    it("project list with name and status", () => {
      const md = renderMarkdown("project list", [
        { name: "spoc", status: "active", description: "CLI tool" },
      ]);
      expect(md).toContain("## Projects (1)");
      expect(md).toContain("- **spoc** [active] — CLI tool");
    });
  });

  describe("Body responses", () => {
    it("plan get with body renders meta + --- + body", () => {
      const md = renderMarkdown("plan get", {
        title: "My Plan", status: "active", body: "# Details\nSome content",
      });
      expect(md).toContain("**My Plan**");
      expect(md).toContain("Status: active");
      expect(md).toContain("---");
      expect(md).toContain("# Details\nSome content");
    });

    it("plan get without body renders summary and tags", () => {
      const md = renderMarkdown("plan get", {
        title: "P", status: "planned", summary: "A summary", keywords: ["a", "b"],
      });
      expect(md).toContain("A summary");
      expect(md).toContain("Tags: a, b");
    });

    it("knowledge get with body renders title + --- + body", () => {
      const md = renderMarkdown("knowledge get", {
        title: "K Entry", kind: "pattern", body: "Body text here",
      });
      expect(md).toContain("**K Entry** (pattern)");
      expect(md).toContain("---");
      expect(md).toContain("Body text here");
    });

    it("knowledge get without body renders summary", () => {
      const md = renderMarkdown("knowledge get", {
        title: "K", kind: "gotcha", summary: "Watch out",
      });
      expect(md).toContain("**K** (gotcha)");
      expect(md).toContain("Watch out");
    });
  });

  describe("Search results", () => {
    it("renders numbered ranked list with scores", () => {
      const md = renderMarkdown("search", [
        { title: "Result A", type: "task", score: 0.95 },
        { title: "Result B", type: "knowledge", score: 0.42 },
      ]);
      expect(md).toContain("1. **Result A** (task) — score: 0.95");
      expect(md).toContain("2. **Result B** (knowledge) — score: 0.42");
    });

    it("knowledge search uses same format", () => {
      const md = renderMarkdown("knowledge search", [
        { title: "X", type: "knowledge", score: 1.0 },
      ]);
      expect(md).toContain("1. **X** (knowledge) — score: 1.00");
    });
  });

  describe("Validation", () => {
    it("no-issues case", () => {
      const md = renderMarkdown("validate", { issues: [], totalChecks: 12 });
      expect(md).toBe("No issues found (12 checks passed).");
    });

    it("with-issues grouped by severity", () => {
      const md = renderMarkdown("validate", {
        issues: [
          { severity: "error", message: "Missing field", repair: "Add it" },
          { severity: "warn", message: "Stale ref" },
        ],
        totalChecks: 5,
      });
      expect(md).toContain("2 issues found");
      expect(md).toContain("- [error] Missing field (Add it)");
      expect(md).toContain("- [warn] Stale ref");
    });
  });

  describe("Context", () => {
    it("renders operating brief and sections", () => {
      const md = renderMarkdown("context", {
        name: "myapp",
        operatingBrief: {
          currentFocus: "Ship v2",
          recommendedSurface: "PLAN",
          why: "Active plan",
          nextAction: "Execute phase 1",
        },
        tasks: [{ title: "Task A", status: "in_progress" }],
        plans: [{ title: "Plan A", status: "active" }],
        knowledge: [{ title: "K1", kind: "pattern" }],
      });
      expect(md).toContain("# myapp");
      expect(md).toContain("**Current Focus:** Ship v2");
      expect(md).toContain("**Surface:** PLAN");
      expect(md).toContain("**Why:** Active plan");
      expect(md).toContain("**Next:** Execute phase 1");
      expect(md).toContain("## Tasks");
      expect(md).toContain("- [/] Task A");
      expect(md).toContain("## Plans");
      expect(md).toContain("- Plan A [active]");
      expect(md).toContain("## Knowledge");
      expect(md).toContain("- K1 (pattern)");
    });
  });

  describe("Null fallback", () => {
    it("unknown commands return null", () => {
      expect(renderMarkdown("unknown-command", { foo: 1 })).toBeNull();
    });

    it("batch returns null", () => {
      expect(renderMarkdown("batch", { results: [] })).toBeNull();
    });

    it("null data returns null", () => {
      expect(renderMarkdown("task get", null)).toBeNull();
    });

    it("string data returns null", () => {
      expect(renderMarkdown("task get", "raw string")).toBeNull();
    });
  });

  describe("Empty lists", () => {
    it("empty task list", () => {
      const md = renderMarkdown("task list", []);
      expect(md).toContain("## Tasks (0)");
    });

    it("empty plan list", () => {
      const md = renderMarkdown("plan list", []);
      expect(md).toContain("## Plans (0)");
    });

    it("empty knowledge list", () => {
      const md = renderMarkdown("knowledge list", []);
      expect(md).toContain("## Knowledge (0)");
    });

    it("empty project list", () => {
      const md = renderMarkdown("project list", []);
      expect(md).toContain("## Projects (0)");
    });
  });
});
