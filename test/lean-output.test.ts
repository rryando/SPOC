import { describe, expect, it } from "vitest";
import { leanify } from "../src/cli/lean-output.js";

describe("leanify", () => {
  it("strips null values from flat objects", () => {
    const input = { a: 1, b: null, c: "hello" };
    expect(leanify(input)).toEqual({ a: 1, c: "hello" });
  });

  it("strips empty arrays and objects", () => {
    const input = { a: 1, b: [], c: {}, d: "ok" };
    expect(leanify(input)).toEqual({ a: 1, d: "ok" });
  });

  it("strips timestamp fields (createdAt, updatedAt)", () => {
    const input = { id: "t1", title: "Task", createdAt: "2024-01-01", updatedAt: "2024-06-01" };
    expect(leanify(input)).toEqual({ id: "t1", title: "Task" });
  });

  it("strips normalizedId when id is present, keeps it when id is absent", () => {
    const withId = { id: "t1", normalizedId: "t-1", name: "foo" };
    expect(leanify(withId)).toEqual({ id: "t1", name: "foo" });

    const withoutId = { normalizedId: "t-1", name: "foo" };
    expect(leanify(withoutId)).toEqual({ normalizedId: "t-1", name: "foo" });
  });

  it("preserves non-empty arrays of objects (cleaning each)", () => {
    const input = {
      items: [
        { id: "1", createdAt: "x", title: "A" },
        { id: "2", updatedAt: "y", title: "B" },
      ],
    };
    expect(leanify(input)).toEqual({
      items: [
        { id: "1", title: "A" },
        { id: "2", title: "B" },
      ],
    });
  });

  it("handles nested objects recursively", () => {
    const input = {
      a: { b: { c: null, d: "yes" }, e: [] },
      f: "keep",
    };
    expect(leanify(input)).toEqual({
      a: { b: { d: "yes" } },
      f: "keep",
    });
  });

  it("is idempotent: leanify(leanify(x)) === leanify(x)", () => {
    const input = {
      id: "t1",
      normalizedId: "t-1",
      title: "Task",
      createdAt: "2024-01-01",
      nested: { a: null, b: [], c: { d: "" } },
      items: [{ id: "1", updatedAt: "x", name: "A" }],
    };
    const once = leanify(input);
    const twice = leanify(once);
    expect(twice).toEqual(once);
  });

  it("measures token reduction: realistic ARCS task JSON is at least 20% smaller", () => {
    // A realistic task with typical metadata noise ratio
    const realisticTask = {
      id: "task-001",
      normalizedId: "task-001",
      title: "Implement lean output for CLI",
      description: "Add --lean flag to strip noise",
      status: "in_progress",
      priority: "high",
      createdAt: "2024-01-15T10:00:00Z",
      updatedAt: "2024-06-20T14:30:00Z",
      confirmationToken: "tok_abc123def456ghi789",
      tags: ["cli", "optimization"],
      planId: "plan-retrieval",
      assignee: null,
      metadata: { reviewed: false },
      dependencies: [],
      sourceFiles: [{ path: "src/cli/lean-output.ts" }],
      subtasks: [
        {
          id: "sub-1",
          normalizedId: "sub-1",
          title: "Create module",
          status: "done",
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-01-16T09:00:00Z",
          metadata: {},
          dependencies: [],
        },
      ],
    };

    const original = JSON.stringify(realisticTask);
    const leaned = JSON.stringify(leanify(realisticTask));
    const reduction = 1 - leaned.length / original.length;

    // Lean mode should provide meaningful reduction
    expect(reduction).toBeGreaterThanOrEqual(0.2);
  });
});
