import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const SCRIPT = resolve(import.meta.dirname, "../scripts/arcs-cli.mjs");
const NODE = process.execPath;

function run(args: string[] = []) {
  return exec(NODE, [SCRIPT, ...args], {
    env: { ...process.env, ARCS_DATA: "/tmp/opencode/arcs-cli-test-data" },
    timeout: 10_000,
  });
}

function runExpectFail(args: string[] = []) {
  return exec(NODE, [SCRIPT, ...args], {
    env: { ...process.env, ARCS_DATA: "/tmp/opencode/arcs-cli-test-data" },
    timeout: 10_000,
  }).catch((err) => err);
}

describe("scripts/arcs-cli.mjs", () => {
  it("shows usage and exits 1 with no args", async () => {
    const result = await runExpectFail([]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.stderr).toContain("Commands:");
  });

  it("shows usage with --help", async () => {
    const result = await run(["--help"]);
    expect(result.stderr).toContain("Usage:");
  });

  it("exits 1 for unknown command", async () => {
    const result = await runExpectFail(["nonexistent"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
