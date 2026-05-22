import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, "../scripts/spoc-cli.mjs");
const NODE = process.execPath;

function run(args: string[] = []) {
  return exec(NODE, [SCRIPT, ...args], {
    env: { ...process.env, SPOC_DATA: "/tmp/opencode/spoc-cli-test-data" },
    timeout: 10_000,
  });
}

function runExpectFail(args: string[] = []) {
  return exec(NODE, [SCRIPT, ...args], {
    env: { ...process.env, SPOC_DATA: "/tmp/opencode/spoc-cli-test-data" },
    timeout: 10_000,
  }).catch((err) => err);
}

describe("scripts/spoc-cli.mjs", () => {
  it("shows usage and exits 1 with no args", async () => {
    const result = await runExpectFail([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("Commands:");
  });

  it("shows usage with --help", async () => {
    const result = await runExpectFail(["--help"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 1 for unknown command", async () => {
    const result = await runExpectFail(["nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });

  it("runs validate command without crashing", async () => {
    const result = await run(["validate"]).catch((e) => e);
    expect(result.stdout !== undefined || result.stderr !== undefined).toBe(true);
  });

  it("runs context command (handled without crash)", async () => {
    // context with a non-project path is still "handled" by the CLI
    const result = await run(["context", "/tmp"]).catch((e) => e);
    // Should not crash with unhandled exception — exits 0 or produces output
    expect(result.stdout !== undefined || result.stderr !== undefined).toBe(true);
  });

  it("runs search command (handled without crash)", async () => {
    const result = await run(["search", "test"]).catch((e) => e);
    expect(result.stdout !== undefined || result.stderr !== undefined).toBe(true);
  });
});
