import { beforeAll, describe, expect, it } from "vitest";
import { type CLIResult, type CommandFlags, defineCommand } from "../src/cli/command-registry.js";
import {
  formatCommandsDiscovery,
  generateCommandHelp,
  generateCommandsDiscovery,
} from "../src/cli/help-generator.js";

const noop = async (_p: Record<string, unknown>, _f: CommandFlags): Promise<CLIResult> => ({
  ok: true,
  data: null,
});

beforeAll(() => {
  defineCommand({
    path: "help-test propose",
    description: "Test command for help generator",
    mutation: false,
    params: {
      summary: {
        type: "string",
        required: true,
        positional: 0,
        description: "Human-readable summary",
      },
      ops: { type: "string", required: true, description: "Comma-separated operation names" },
      slug: { type: "string", required: true, description: "Target project slug" },
      ttl: { type: "number", required: false, default: 600000, description: "Token TTL in ms" },
    },
    handler: noop,
  });

  defineCommand({
    path: "help-test list",
    description: "List items",
    params: {
      format: {
        type: "string",
        required: false,
        description: "Output format",
        enum: ["table", "json", "csv"],
      },
    },
    handler: noop,
  });
});

describe("generateCommandHelp", () => {
  it("produces correct title and usage line", () => {
    const help = generateCommandHelp({
      path: "help-test propose",
      description: "Test command for help generator",
      params: {
        summary: {
          type: "string",
          required: true,
          positional: 0,
          description: "Human-readable summary",
        },
        ops: { type: "string", required: true, description: "Comma-separated operation names" },
        slug: { type: "string", required: true, description: "Target project slug" },
        ttl: { type: "number", required: false, default: 600000, description: "Token TTL in ms" },
      },
      handler: noop,
    });
    expect(help).toContain("arcs help-test propose — Test command for help generator");
    expect(help).toContain(
      "Usage: arcs help-test propose <summary> --ops=STRING --slug=STRING [--ttl=NUMBER]",
    );
  });

  it("shows positional params as <name>", () => {
    const help = generateCommandHelp({
      path: "help-test propose",
      description: "Test",
      params: { arg: { type: "string", required: true, positional: 0, description: "An arg" } },
      handler: noop,
    });
    expect(help).toContain("<arg>");
  });

  it("shows optional params in brackets", () => {
    const help = generateCommandHelp({
      path: "help-test propose",
      description: "Test",
      params: { opt: { type: "string", required: false, description: "Optional" } },
      handler: noop,
    });
    expect(help).toContain("[--opt=STRING]");
  });

  it("displays default values", () => {
    const help = generateCommandHelp({
      path: "help-test propose",
      description: "Test",
      params: { ttl: { type: "number", required: false, default: 600000, description: "TTL" } },
      handler: noop,
    });
    expect(help).toContain("default: 600000");
  });

  it("mentions enum values", () => {
    const help = generateCommandHelp({
      path: "help-test list",
      description: "List",
      params: {
        format: { type: "string", required: false, description: "Format", enum: ["table", "json"] },
      },
      handler: noop,
    });
    expect(help).toContain("table, json");
  });

  it("includes global flags section", () => {
    const help = generateCommandHelp({
      path: "help-test list",
      description: "List",
      params: {},
      handler: noop,
    });
    expect(help).toContain("Global flags:");
    expect(help).toContain("--json");
    expect(help).toContain("--lean");
    expect(help).toContain("--dry-run");
    expect(help).toContain("--help");
  });
});

describe("generateCommandsDiscovery", () => {
  it("returns all registered commands", () => {
    const discovery = generateCommandsDiscovery();
    const paths = discovery.commands.map((c) => c.path);
    expect(paths).toContain("help-test propose");
    expect(paths).toContain("help-test list");
  });

  it("includes param metadata without handler", () => {
    const discovery = generateCommandsDiscovery();
    const cmd = discovery.commands.find((c) => c.path === "help-test propose");
    expect(cmd).toBeDefined();
    expect(cmd!.params.summary.positional).toBe(0);
    expect(cmd!.params.ttl.default).toBe(600000);
    expect(cmd as unknown as Record<string, unknown>).not.toHaveProperty("handler");
  });

  it("includes errorCodes array in discovery output", () => {
    const discovery = generateCommandsDiscovery();
    expect(discovery.errorCodes).toBeInstanceOf(Array);
    expect(discovery.errorCodes).toContain("missing_param");
    expect(discovery.errorCodes).toContain("project_not_found");
    expect(discovery.errorCodes.length).toBeGreaterThanOrEqual(7);
  });

  it("includes mutation: false for read-only commands that declare it", () => {
    const discovery = generateCommandsDiscovery();
    const proposeCmd = discovery.commands.find((c) => c.path === "help-test propose");
    expect(proposeCmd).toBeDefined();
    expect(proposeCmd!.mutation).toBe(false);
  });
});

describe("formatCommandsDiscovery", () => {
  it("json mode produces valid JSON", () => {
    const discovery = generateCommandsDiscovery();
    const output = formatCommandsDiscovery(discovery, true);
    expect(() => JSON.parse(output)).not.toThrow();
    const parsed = JSON.parse(output);
    expect(parsed.commands).toBeInstanceOf(Array);
  });

  it("human mode is readable text", () => {
    const discovery = generateCommandsDiscovery();
    const output = formatCommandsDiscovery(discovery, false);
    expect(output).toContain("Available commands:");
    expect(output).toContain("help-test propose");
    expect(output).toContain("Use 'arcs <command> --help' for details.");
  });
});
