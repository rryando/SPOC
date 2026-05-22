import { describe, expect, it, vi } from "vitest";
import { handleCli } from "../src/cli/index.js";

// Mock setup and preview to avoid side effects
vi.mock("../src/cli/setup.js", () => ({
  runSetup: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/cli/preview.js", () => ({
  handlePreviewCli: vi.fn().mockReturnValue(true),
}));

describe("CLI Router", () => {
  const dagCommands = [
    "context",
    "task",
    "plan",
    "knowledge",
    "search",
    "diagram",
    "batch",
    "validate",
  ];

  describe("DAG commands route to handleDagCommand", () => {
    for (const cmd of dagCommands) {
      it(`"${cmd}" returns true`, async () => {
        const consoleSpy = vi
          .spyOn(console, "log")
          .mockImplementation(() => {});
        const result = await handleCli([cmd]);
        expect(result).toBe(true);
        consoleSpy.mockRestore();
      });
    }
  });

  it("unknown commands return false", async () => {
    const result = await handleCli(["foobar"]);
    expect(result).toBe(false);
  });

  it("existing commands still work — init", async () => {
    const result = await handleCli(["init"]);
    expect(result).toBe(true);
  });

  it("existing commands still work — config", async () => {
    const result = await handleCli(["config"]);
    expect(result).toBe(true);
  });

  it("existing commands still work — preview", async () => {
    const result = await handleCli(["preview"]);
    expect(result).toBe(true);
  });

  it("--help flag prints usage and returns true", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await handleCli(["task", "--help"]);
    expect(result).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Usage: spoc"),
    );
    consoleSpy.mockRestore();
  });

  it("--json flag is stripped from args", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await handleCli(["task", "--json", "list"]);
    expect(result).toBe(true);
    // task list without --slug now errors to stderr
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--slug is required"),
    );
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
