import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  log: { info: vi.fn(), warn: vi.fn() },
  isCancel: vi.fn(() => false),
  note: vi.fn(),
}));

// Mock setup.ts dependencies that aren't relevant to graphify tests
vi.mock("../src/cli/config.js", () => ({
  configExists: vi.fn(() => false),
  extractModelPreFills: vi.fn(() => ({})),
  readConfig: vi.fn(),
  readOpenCodeConfig: vi.fn(),
  writeConfig: vi.fn(),
}));

vi.mock("../src/cli/instructions.js", () => ({
  applyAgentModelConfig: vi.fn(),
  displayPath: vi.fn(),
  opencodeHasAgent: vi.fn(),
  writeOpencodeAgent: vi.fn(),
}));

vi.mock("../src/cli/bundle-installer.js", () => ({
  detectSpocBundleInstall: vi.fn(),
  installSpocBundle: vi.fn(),
}));

const mockedExecSync = vi.mocked(childProcess.execSync);
const mockedSpawnSync = vi.mocked(childProcess.spawnSync);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedAppendFileSync = vi.mocked(fs.appendFileSync);

import { beforeEach } from "vitest";
import { detectGraphify, pathBetween, queryGraph, runExtraction } from "../src/utils/graphify.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectGraphify", () => {
  it("returns available:false when binary is not found (ENOENT)", () => {
    const err = new Error("Command failed") as NodeJS.ErrnoException;
    err.code = "ENOENT";
    mockedExecSync.mockImplementation(() => {
      throw err;
    });

    const result = detectGraphify();
    expect(result).toEqual({ available: false });
  });

  it("parses version correctly from stdout", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });

    const result = detectGraphify();
    expect(result).toEqual({
      available: true,
      version: "0.8.18",
      path: "/usr/local/bin/graphify",
    });
  });

  it("handles timeout gracefully", () => {
    const err = new Error("Command timed out") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    mockedExecSync.mockImplementation(() => {
      throw err;
    });

    const result = detectGraphify();
    expect(result).toEqual({ available: false });
  });
});

describe("runExtraction", () => {
  it("returns error when graphify not available", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const result = runExtraction("/tmp/project");
    expect(result).toEqual({
      success: false,
      error: "graphify binary not found",
      code: "ENOENT",
    });
  });

  it("returns success with correct paths when extraction succeeds", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "Done",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });
    mockedExistsSync.mockReturnValue(true);

    const result = runExtraction("/tmp/project");
    expect(result).toEqual({
      success: true,
      graphJsonPath: "/tmp/project/graphify-out/graph.json",
    });
  });

  it("returns error with timeout code when process times out", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    const timeoutErr = new Error("spawnSync graphify ETIMEDOUT") as NodeJS.ErrnoException;
    timeoutErr.code = "ETIMEDOUT";
    mockedSpawnSync.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      error: timeoutErr,
      pid: 1234,
      output: [],
      signal: null,
    });

    const result = runExtraction("/tmp/project");
    expect(result).toEqual({
      success: false,
      error: "spawnSync graphify ETIMEDOUT",
      code: "ETIMEDOUT",
    });
  });

  it("returns error when output files don't exist after extraction", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "Done",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });
    mockedExistsSync.mockReturnValue(false);

    const result = runExtraction("/tmp/project");
    expect(result).toEqual({
      success: false,
      error: "Extraction completed but graph.json not found",
      code: "ENOENT",
    });
  });

  it("adds graphify-out/ to .gitignore on successful extraction", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "Done",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("node_modules/\ndist/\n");

    runExtraction("/tmp/project");

    expect(mockedAppendFileSync).toHaveBeenCalledWith(
      "/tmp/project/.gitignore",
      "graphify-out/\n",
      "utf-8",
    );
  });

  it("does not duplicate graphify-out/ in .gitignore if already present", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "Done",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("node_modules/\ngraphify-out/\ndist/\n");

    runExtraction("/tmp/project");

    expect(mockedAppendFileSync).not.toHaveBeenCalled();
  });
});

describe("queryGraph and pathBetween", () => {
  it("queryGraph returns error when graphify not available", () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error("not found");
    });

    const result = queryGraph("what is the main module?", "/tmp/project");
    expect(result).toEqual({ success: false, error: "graphify binary not found" });
  });

  it("queryGraph returns error when graph.json doesn't exist", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = queryGraph("what is the main module?", "/tmp/project");
    expect(result).toEqual({ success: false, error: "graph.json not found" });
  });

  it("queryGraph returns success with answer from stdout", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "The main module is src/index.ts",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });

    const result = queryGraph("what is the main module?", "/tmp/project");
    expect(result).toEqual({ success: true, answer: "The main module is src/index.ts" });
  });

  it("pathBetween returns success with answer from stdout", () => {
    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });
    mockedExistsSync.mockReturnValue(true);
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "ModuleA -> ServiceB -> ModuleC",
      stderr: "",
      error: undefined as unknown as Error,
      pid: 1234,
      output: [],
      signal: null,
    });

    const result = pathBetween("ModuleA", "ModuleC", "/tmp/project");
    expect(result).toEqual({ success: true, answer: "ModuleA -> ServiceB -> ModuleC" });
  });
});

describe("promptGraphifyInstall", () => {
  it("skips when graphify is already available", async () => {
    const { promptGraphifyInstall } = await import("../src/cli/setup.js");
    const prompts = await import("@clack/prompts");

    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") return "graphify 0.8.18\n";
      if (cmd === "which graphify") return "/usr/local/bin/graphify\n";
      return "";
    });

    await promptGraphifyInstall();

    expect(prompts.confirm).not.toHaveBeenCalled();
  });

  it("skips when Python is not found", async () => {
    const { promptGraphifyInstall } = await import("../src/cli/setup.js");
    const prompts = await import("@clack/prompts");

    mockedExecSync.mockImplementation((cmd: string) => {
      if (cmd === "graphify --version") throw new Error("not found");
      if (cmd === "which graphify") throw new Error("not found");
      // python3 --version and python --version both fail
      throw new Error("not found");
    });

    await promptGraphifyInstall();

    expect(prompts.note).toHaveBeenCalled();
    expect(prompts.confirm).not.toHaveBeenCalled();
  });
});
