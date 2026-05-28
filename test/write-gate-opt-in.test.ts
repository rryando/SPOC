// ---------------------------------------------------------------------------
// Write-gate opt-in tests — verifies SPOC_GUARDED=1 enforcement
// ---------------------------------------------------------------------------

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleDagCommand, requireWriteGate } from "../src/cli/dag-commands.js";

// ---------------------------------------------------------------------------
// requireWriteGate unit tests
// ---------------------------------------------------------------------------

describe("requireWriteGate", () => {
  afterEach(() => {
    delete process.env.SPOC_GUARDED;
  });

  it("returns null (no-op) when SPOC_GUARDED is not set", () => {
    delete process.env.SPOC_GUARDED;
    expect(requireWriteGate()).toBeNull();
    expect(requireWriteGate(undefined)).toBeNull();
    expect(requireWriteGate("any-token")).toBeNull();
  });

  it("returns null (no-op) when SPOC_GUARDED=0", () => {
    process.env.SPOC_GUARDED = "0";
    expect(requireWriteGate()).toBeNull();
  });

  it("returns error when SPOC_GUARDED=1 and no token provided", () => {
    process.env.SPOC_GUARDED = "1";
    const result = requireWriteGate();
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe("write_gate_required");
  });

  it("returns error when SPOC_GUARDED=1 and empty token provided", () => {
    process.env.SPOC_GUARDED = "1";
    const result = requireWriteGate("   ");
    expect(result).not.toBeNull();
    expect(result?.ok).toBe(false);
  });

  it("returns null when SPOC_GUARDED=1 and valid token provided", () => {
    process.env.SPOC_GUARDED = "1";
    const result = requireWriteGate("my-valid-token");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — handleDagCommand with --guarded
// ---------------------------------------------------------------------------

function createTempDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-write-gate-"));
  writeFileSync(
    join(dir, "meta.json"),
    JSON.stringify({
      version: "1.0",
      projects: [{ id: "gate-proj", name: "Gate Project", status: "active", dependsOn: [] }],
    }),
  );
  const projDir = join(dir, "projects", "gate-proj");
  mkdirSync(projDir, { recursive: true });
  writeFileSync(
    join(projDir, "meta.json"),
    JSON.stringify({
      id: "gate-proj",
      name: "Gate Project",
      description: "Write-gate test project",
      createdAt: "2025-01-01T00:00:00.000Z",
      workspacePaths: [],
    }),
  );
  writeFileSync(
    join(projDir, "overview.md"),
    "# Gate Project\n\n> Test\n\n## Goals\n\nTest write-gate.\n",
  );
  const tasksDir = join(projDir, "tasks");
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(
    join(tasksDir, "index.json"),
    JSON.stringify({ tasks: [] }),
  );
  writeFileSync(join(projDir, "tasks.md"), "# Tasks\n");
  const knowledgeDir = join(projDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, "index.json"), JSON.stringify({ entries: [] }));
  const plansDir = join(projDir, "plans");
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, "index.json"), JSON.stringify({ plans: [] }));
  return dir;
}

describe("handleDagCommand — write-gate opt-in", () => {
  let dataDir: string;
  let origDataDir: string | undefined;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let origExitCode: number | undefined;

  beforeEach(() => {
    dataDir = createTempDataDir();
    origDataDir = process.env.SPOC_DATA_DIR;
    process.env.SPOC_DATA_DIR = dataDir;
    delete process.env.SPOC_GUARDED;
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    origExitCode = process.exitCode as number | undefined;
    process.exitCode = 0;
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.env.SPOC_DATA_DIR = origDataDir;
    delete process.env.SPOC_GUARDED;
    process.exitCode = origExitCode;
  });

  it("mutation command works without --token in default (unguarded) mode", async () => {
    await handleDagCommand("task", ["create", "gate-proj", "My Test Task", "--priority=medium", "--json"]);
    expect(process.exitCode).toBe(0);
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toBeTruthy();
    const parsed = JSON.parse(output);
    expect(JSON.stringify(parsed)).toContain("Test Task");
  });

  it("mutation command fails with --guarded and no --token", async () => {
    await handleDagCommand("task", [
      "create",
      "gate-proj",
      "My Test Task",
      "--priority=medium",
      "--json",
      "--guarded",
    ]);
    expect(process.exitCode).toBe(1);
    const errorOutput = consoleErrorSpy.mock.calls[0]?.[0] as string;
    expect(errorOutput).toBeTruthy();
    const parsed = JSON.parse(errorOutput);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe("write_gate_required");
  });

  it("mutation command works with --guarded and valid --token", async () => {
    await handleDagCommand("task", [
      "create",
      "gate-proj",
      "My Guarded Task",
      "--priority=medium",
      "--json",
      "--guarded",
      "--token=my-valid-token",
    ]);
    expect(process.exitCode).toBe(0);
    const output = consoleSpy.mock.calls[0]?.[0] as string;
    expect(output).toBeTruthy();
    const parsed = JSON.parse(output);
    expect(JSON.stringify(parsed)).toContain("Guarded Task");
  });

  it("--guarded flag sets SPOC_GUARDED env var", async () => {
    delete process.env.SPOC_GUARDED;
    await handleDagCommand("task", [
      "create",
      "gate-proj",
      "Env Test",
      "--guarded",
      "--token=tok",
      "--json",
    ]);
    // After the call, SPOC_GUARDED should be set (it persists within the process)
    expect(process.env.SPOC_GUARDED).toBe("1");
  });

  it("SPOC_GUARDED=1 env var enforces gate without --guarded flag", async () => {
    process.env.SPOC_GUARDED = "1";
    await handleDagCommand("task", [
      "create",
      "gate-proj",
      "Env Gate Task",
      "--priority=medium",
      "--json",
    ]);
    expect(process.exitCode).toBe(1);
    const errorOutput = consoleErrorSpy.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(errorOutput);
    expect(parsed.code).toBe("write_gate_required");
  });
});
