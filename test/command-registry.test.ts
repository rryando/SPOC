import { describe, expect, it } from "vitest";
import {
  type CLIResult,
  type CommandDef,
  type CommandFlags,
  defineCommand,
  ERROR_CODES,
  getCommand,
  listCommands,
  suggestCommand,
} from "../src/cli/command-registry.js";

// Since the registry is module-level state, we need to be careful about ordering.
// We'll rely on the fact that each test adds unique paths.

const makeHandler =
  () =>
  async (_p: Record<string, unknown>, _f: CommandFlags): Promise<CLIResult> => ({
    ok: true,
    data: null,
  });

describe("command-registry", () => {
  it("defineCommand registers and getCommand retrieves", () => {
    const def: CommandDef = {
      path: "test get",
      description: "A test command",
      params: { slug: { type: "string", required: true, description: "project slug" } },
      handler: makeHandler(),
    };
    defineCommand(def);
    expect(getCommand("test get")).toBe(def);
  });

  it("duplicate path throws error", () => {
    const def: CommandDef = {
      path: "dup cmd",
      description: "first",
      params: {},
      handler: makeHandler(),
    };
    defineCommand(def);
    expect(() => defineCommand(def)).toThrow('Duplicate command path: "dup cmd"');
  });

  it("empty path throws error", () => {
    expect(() =>
      defineCommand({ path: "", description: "x", params: {}, handler: makeHandler() }),
    ).toThrow("Command path must be non-empty");
  });

  it("listCommands returns all registered", () => {
    const before = listCommands().length;
    defineCommand({ path: "list test a", description: "a", params: {}, handler: makeHandler() });
    defineCommand({ path: "list test b", description: "b", params: {}, handler: makeHandler() });
    expect(listCommands().length).toBe(before + 2);
  });

  it("suggestCommand finds close matches", () => {
    defineCommand({ path: "task list", description: "x", params: {}, handler: makeHandler() });
    // "task lit" is distance 2 from "task list"
    expect(suggestCommand("task lit")).toBe("task list");
  });

  it("suggestCommand returns undefined for far misses", () => {
    expect(suggestCommand("zzzzzzzzzzz")).toBeUndefined();
  });

  it("CLIResult ok and error shapes", () => {
    const ok: CLIResult = { ok: true, data: { items: [] } };
    expect(ok.ok).toBe(true);

    const err: CLIResult = {
      ok: false,
      code: ERROR_CODES.MISSING_PARAM,
      message: "Missing required param",
      hint: "Pass --slug",
      param: "slug",
    };
    expect(err.ok).toBe(false);
  });

  it("ERROR_CODES has expected keys", () => {
    expect(ERROR_CODES.UNKNOWN_COMMAND).toBe("unknown_command");
  });
});
