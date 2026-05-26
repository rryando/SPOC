import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { success, failure, render, formatHuman, stripTimestamps } from "../src/cli/output-envelope.js";

describe("output-envelope", () => {
  describe("success()", () => {
    it("creates correct shape", () => {
      const result = success({ id: "abc" });
      expect(result).toEqual({ ok: true, data: { id: "abc" } });
    });
  });

  describe("failure()", () => {
    it("creates correct shape with optional fields", () => {
      const result = failure("missing_param", "slug is required", {
        hint: "Pass --slug=<slug>",
        usage: "spoc task list --slug=<slug>",
        param: "slug",
      });
      expect(result).toEqual({
        ok: false,
        code: "missing_param",
        message: "slug is required",
        hint: "Pass --slug=<slug>",
        usage: "spoc task list --slug=<slug>",
        param: "slug",
      });
    });

    it("omits undefined optional fields", () => {
      const result = failure("unknown_command", "not found");
      expect(result).toEqual({ ok: false, code: "unknown_command", message: "not found" });
      expect("hint" in result).toBe(false);
    });
  });

  describe("render()", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("JSON mode outputs to stdout for success", () => {
      render(success({ x: 1 }), { json: true, lean: false });
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ ok: true, data: { x: 1 } }));
    });

    it("JSON mode outputs to stderr for failure", () => {
      render(failure("err", "bad"), { json: true, lean: false });
      expect(errorSpy).toHaveBeenCalledWith(JSON.stringify({ ok: false, code: "err", message: "bad" }));
    });

    it("human mode formats error with hint/usage", () => {
      render(failure("err", "bad thing", { hint: "try this", usage: "cmd --flag" }), { json: false, lean: false });
      expect(errorSpy).toHaveBeenCalledWith("Error: bad thing\nHint: try this\nUsage: cmd --flag");
    });

    it("lean mode applies timestamp stripping", () => {
      render(success({ id: "a", createdAt: "2024-01-01", nested: { updatedAt: "x" } }), { json: true, lean: true });
      const output = JSON.parse(logSpy.mock.calls[0][0] as string);
      expect(output.data).toEqual({ id: "a", nested: {} });
    });
  });

  describe("formatHuman()", () => {
    it("handles strings", () => {
      expect(formatHuman("hello")).toBe("hello");
    });

    it("handles objects", () => {
      expect(formatHuman({ a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
    });

    it("handles null", () => {
      expect(formatHuman(null)).toBe("");
    });

    it("handles undefined", () => {
      expect(formatHuman(undefined)).toBe("");
    });
  });

  describe("stripTimestamps()", () => {
    it("removes createdAt/updatedAt recursively", () => {
      const input = {
        id: "x",
        createdAt: "2024-01-01",
        updatedAt: "2024-02-01",
        items: [{ name: "a", createdAt: "2024-01-01" }],
        nested: { updatedAt: "2024-03-01", value: 42 },
      };
      expect(stripTimestamps(input)).toEqual({
        id: "x",
        items: [{ name: "a" }],
        nested: { value: 42 },
      });
    });

    it("returns primitives unchanged", () => {
      expect(stripTimestamps("hello")).toBe("hello");
      expect(stripTimestamps(42)).toBe(42);
      expect(stripTimestamps(null)).toBe(null);
    });
  });
});
