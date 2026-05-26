import { describe, expect, it } from "vitest";
import { generateUsage, parseArgs } from "../src/cli/arg-parser.js";
import type { CommandDef } from "../src/cli/command-registry.js";

function makeDef(params: CommandDef["params"] = {}, path = "test cmd"): CommandDef {
  return {
    path,
    description: "A test command",
    params,
    handler: async () => ({ ok: true, data: null }),
  };
}

describe("parseArgs", () => {
  it("parses --flag=value syntax", () => {
    const def = makeDef({ slug: { type: "string", required: true, description: "project slug" } });
    const result = parseArgs(def, ["--slug=myproject"]);
    expect(result).toEqual({
      ok: true,
      parsed: {
        params: { slug: "myproject" },
        flags: { json: false, lean: false, dryRun: false, help: false },
      },
    });
  });

  it("parses --flag value (space-separated) syntax", () => {
    const def = makeDef({ slug: { type: "string", required: true, description: "project slug" } });
    const result = parseArgs(def, ["--slug", "myproject"]);
    expect(result).toEqual({
      ok: true,
      parsed: {
        params: { slug: "myproject" },
        flags: { json: false, lean: false, dryRun: false, help: false },
      },
    });
  });

  it("assigns positional args to params with positional field", () => {
    const def = makeDef({
      summary: { type: "string", required: true, positional: 0, description: "summary" },
    });
    const result = parseArgs(def, ["hello world"]);
    expect(result).toEqual({
      ok: true,
      parsed: {
        params: { summary: "hello world" },
        flags: { json: false, lean: false, dryRun: false, help: false },
      },
    });
  });

  it("returns ambiguous_arg error when both positional and flag provided for same param", () => {
    const def = makeDef({
      summary: { type: "string", required: true, positional: 0, description: "summary" },
    });
    const result = parseArgs(def, ["positional-val", "--summary=flag-val"]);
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous_arg", param: "summary" } });
  });

  it("extracts global flags from anywhere", () => {
    const def = makeDef({ name: { type: "string", positional: 0, description: "name" } });
    const result = parseArgs(def, ["--json", "hello", "--lean", "--dry-run"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.flags).toEqual({ json: true, lean: true, dryRun: true, help: false });
      expect(result.parsed.params.name).toBe("hello");
    }
  });

  it("--help short-circuits", () => {
    const def = makeDef({ name: { type: "string", required: true, description: "name" } });
    const result = parseArgs(def, ["--help"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.flags.help).toBe(true);
  });

  it("errors on required param missing", () => {
    const def = makeDef({ slug: { type: "string", required: true, description: "slug" } });
    const result = parseArgs(def, []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("missing_param");
      expect(result.error.param).toBe("slug");
    }
  });

  it("errors on unknown flag with suggestion", () => {
    const def = makeDef({ slug: { type: "string", description: "slug" } });
    const result = parseArgs(def, ["--slgu=x"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_flag");
      expect(result.error.hint).toContain("--slug");
    }
  });

  it("errors on invalid enum value", () => {
    const def = makeDef({
      status: { type: "string", required: true, enum: ["open", "closed"], description: "status" },
    });
    const result = parseArgs(def, ["--status=pending"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_enum");
      expect(result.error.hint).toContain("open");
    }
  });

  it("coerces number type", () => {
    const def = makeDef({ ttl: { type: "number", required: true, description: "ttl" } });
    const result = parseArgs(def, ["--ttl=120"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.params.ttl).toBe(120);
  });

  it("errors on invalid number", () => {
    const def = makeDef({ ttl: { type: "number", required: true, description: "ttl" } });
    const result = parseArgs(def, ["--ttl=abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_type");
  });

  it("coerces boolean type (flag present = true)", () => {
    const def = makeDef({ verbose: { type: "boolean", description: "verbose" } });
    const result = parseArgs(def, ["--verbose"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.params.verbose).toBe(true);
  });

  it("coerces boolean type from string values", () => {
    const def = makeDef({ verbose: { type: "boolean", description: "verbose" } });
    const result = parseArgs(def, ["--verbose=false"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.params.verbose).toBe(false);
  });

  it("applies default values", () => {
    const def = makeDef({ ttl: { type: "number", default: 120, description: "ttl" } });
    const result = parseArgs(def, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.parsed.params.ttl).toBe(120);
  });

  it("handles mixed positional + flags + globals", () => {
    const def = makeDef({
      summary: { type: "string", required: true, positional: 0, description: "summary" },
      ops: { type: "string", required: true, description: "operations" },
      slug: { type: "string", required: true, description: "slug" },
    });
    const result = parseArgs(def, [
      "my summary",
      "--ops=task:create",
      "--json",
      "--slug",
      "myproj",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.parsed.params).toEqual({
        summary: "my summary",
        ops: "task:create",
        slug: "myproj",
      });
      expect(result.parsed.flags.json).toBe(true);
    }
  });
});

describe("generateUsage", () => {
  it("generates correct usage string", () => {
    const def = makeDef(
      {
        summary: { type: "string", required: true, positional: 0, description: "summary" },
        ops: { type: "string", required: true, description: "operations" },
        slug: { type: "string", required: true, description: "slug" },
        ttl: { type: "number", description: "time to live" },
      },
      "write propose",
    );
    const usage = generateUsage(def);
    expect(usage).toBe("Usage: spoc write propose <summary> --ops=OPS --slug=SLUG [--ttl=TTL]");
  });
});

describe("conditional required", () => {
  const def = makeDef({
    file: { type: "string", required: (params) => !params["list-ops"], description: "file path" },
    "list-ops": { type: "boolean", description: "list operations" },
  });

  it("returns missing_param when condition is true and param missing", () => {
    const result = parseArgs(def, []);
    expect(result).toMatchObject({ ok: false, error: { code: "missing_param", param: "file" } });
  });

  it("no error when condition is false and param missing", () => {
    const result = parseArgs(def, ["--list-ops"]);
    expect(result).toMatchObject({ ok: true, parsed: { params: { "list-ops": true } } });
  });
});

describe("parseArgs — ambiguous arg detection", () => {
  const def = makeDef({
    slug: { type: "string", required: true, positional: 0, description: "project slug" },
    taskId: { type: "string", required: true, positional: 1, description: "task id" },
  });

  it("returns ambiguous_arg when param provided as both positional and flag", () => {
    const result = parseArgs(def, ["myslug", "--slug=other"]);
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous_arg", param: "slug" } });
  });

  it("works with positional only", () => {
    const result = parseArgs(def, ["myslug", "task1"]);
    expect(result).toMatchObject({
      ok: true,
      parsed: { params: { slug: "myslug", taskId: "task1" } },
    });
  });

  it("works with flag only", () => {
    const result = parseArgs(def, ["--slug=myslug", "--taskId=task1"]);
    expect(result).toMatchObject({
      ok: true,
      parsed: { params: { slug: "myslug", taskId: "task1" } },
    });
  });
});
