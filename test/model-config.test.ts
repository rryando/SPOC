import { mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractModelPreFills, readOpenCodeConfig } from "../src/cli/config.js";
import { applyAgentModelConfig, writeOpencodeAgent } from "../src/cli/instructions.js";

// ---------------------------------------------------------------------------
// A. extractModelPreFills (pure function)
// ---------------------------------------------------------------------------

describe("extractModelPreFills", () => {
  it("returns empty strings for null", () => {
    expect(extractModelPreFills(null)).toEqual({ heavy: "", standard: "", light: "" });
  });

  it("returns empty strings for undefined", () => {
    expect(extractModelPreFills(undefined)).toEqual({ heavy: "", standard: "", light: "" });
  });

  it("returns empty strings for empty object", () => {
    expect(extractModelPreFills({})).toEqual({ heavy: "", standard: "", light: "" });
  });

  it("uses model for all tiers when no small_model", () => {
    expect(extractModelPreFills({ model: "foo/bar" })).toEqual({
      heavy: "foo/bar",
      standard: "foo/bar",
      light: "foo/bar",
    });
  });

  it("uses small_model for light tier when model is also set", () => {
    expect(extractModelPreFills({ model: "foo/bar", small_model: "foo/baz" })).toEqual({
      heavy: "foo/bar",
      standard: "foo/bar",
      light: "foo/baz",
    });
  });

  it("uses small_model for light when no model", () => {
    expect(extractModelPreFills({ small_model: "foo/baz" })).toEqual({
      heavy: "",
      standard: "",
      light: "foo/baz",
    });
  });

  it("treats non-string model as empty string", () => {
    expect(extractModelPreFills({ model: 123 })).toEqual({
      heavy: "",
      standard: "",
      light: "",
    });
  });

  it("treats non-string small_model as empty string", () => {
    expect(extractModelPreFills({ model: "foo/bar", small_model: 42 })).toEqual({
      heavy: "foo/bar",
      standard: "foo/bar",
      light: "foo/bar",
    });
  });

  it("treats non-object input (array) as empty", () => {
    expect(extractModelPreFills([1, 2, 3])).toEqual({ heavy: "", standard: "", light: "" });
  });

  it("treats non-object input (string) as empty", () => {
    expect(extractModelPreFills("hello")).toEqual({ heavy: "", standard: "", light: "" });
  });
});

// ---------------------------------------------------------------------------
// B. readOpenCodeConfig (IO function)
// ---------------------------------------------------------------------------

describe("readOpenCodeConfig", () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "spoc-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true });
  });

  it("returns null when config file does not exist", async () => {
    const result = await readOpenCodeConfig();
    expect(result).toBeNull();
  });

  it("returns parsed JSON when file exists", async () => {
    const configDir = join(tempDir, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), JSON.stringify({ model: "test/model" }));
    const result = await readOpenCodeConfig();
    expect(result).toEqual({ model: "test/model" });
  });

  it("returns null for malformed JSON", async () => {
    const configDir = join(tempDir, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), "not json{{{");
    const result = await readOpenCodeConfig();
    expect(result).toBeNull();
  });

  it("returns parsed value for non-object JSON (array)", async () => {
    const configDir = join(tempDir, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), "[1, 2, 3]");
    const result = await readOpenCodeConfig();
    expect(result).toEqual([1, 2, 3]);
  });

  it("returns parsed value for non-object JSON (number)", async () => {
    const configDir = join(tempDir, ".config", "opencode");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "opencode.json"), "42");
    const result = await readOpenCodeConfig();
    expect(result).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// C. Integration: applyAgentModelConfig (tier resolution via filesystem)
// ---------------------------------------------------------------------------

describe("applyAgentModelConfig", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let configDir: string;
  let configFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "spoc-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    configDir = join(tempDir, ".config", "opencode");
    configFile = join(configDir, "opencode.json");
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true });
  });

  it("does nothing when config file does not exist", () => {
    // Reset HOME to a dir without opencode.json
    const altDir = join(tempDir, "empty");
    mkdirSync(altDir, { recursive: true });
    process.env.HOME = altDir;
    expect(() =>
      applyAgentModelConfig({ heavy: "h/m", standard: "s/m", light: "l/m" }),
    ).not.toThrow();
  });

  it("assigns tier-based models to sub-agents", async () => {
    const config = {
      agent: {
        "SPOC Orchestrator": { prompt: "test" },
        "SPOC Caveman": { prompt: "test" },
        explore: { prompt: "explore things" },
        "coder-expert": { prompt: "code stuff" },
        build: { prompt: "build stuff" },
      },
    };
    writeFileSync(configFile, JSON.stringify(config));

    applyAgentModelConfig({ heavy: "big/model", standard: "mid/model", light: "small/model" });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    // Sub-agents get tier models
    expect(result.agent.explore.model).toBe("small/model");
    expect(result.agent["coder-expert"].model).toBe("big/model");
    expect(result.agent.build.model).toBe("mid/model");
    // Primary agents get no model field (no perAgent override)
    expect(result.agent["SPOC Orchestrator"].model).toBeUndefined();
    expect(result.agent["SPOC Caveman"].model).toBeUndefined();
  });

  it("applies perAgent override to sub-agents", async () => {
    const config = {
      agent: {
        explore: { prompt: "explore" },
        "coder-expert": { prompt: "code" },
      },
    };
    writeFileSync(configFile, JSON.stringify(config));

    applyAgentModelConfig({
      heavy: "big/model",
      standard: "mid/model",
      light: "small/model",
      perAgent: { explore: "custom/explorer" },
    });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    expect(result.agent.explore.model).toBe("custom/explorer");
    expect(result.agent["coder-expert"].model).toBe("big/model");
  });

  it("applies perAgent override to primary agents", async () => {
    const config = {
      agent: {
        "SPOC Orchestrator": { prompt: "test" },
        "SPOC Caveman": { prompt: "test" },
      },
    };
    writeFileSync(configFile, JSON.stringify(config));

    applyAgentModelConfig({
      heavy: "big/model",
      standard: "mid/model",
      light: "small/model",
      perAgent: { "SPOC Orchestrator": "special/orchestrator" },
    });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    expect(result.agent["SPOC Orchestrator"].model).toBe("special/orchestrator");
    // Caveman has no override — no model field
    expect(result.agent["SPOC Caveman"].model).toBeUndefined();
  });

  it("removes model from primary agents when no perAgent override", async () => {
    const config = {
      agent: {
        "SPOC Orchestrator": { prompt: "test", model: "old/model" },
        "SPOC Caveman": { prompt: "test", model: "old/model" },
      },
    };
    writeFileSync(configFile, JSON.stringify(config));

    applyAgentModelConfig({ heavy: "big/model", standard: "mid/model", light: "small/model" });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    expect(result.agent["SPOC Orchestrator"].model).toBeUndefined();
    expect(result.agent["SPOC Caveman"].model).toBeUndefined();
  });

  it("skips agents not in tier map", async () => {
    const config = {
      agent: {
        "unknown-agent": { prompt: "mystery" },
        explore: { prompt: "explore" },
      },
    };
    writeFileSync(configFile, JSON.stringify(config));

    applyAgentModelConfig({ heavy: "big/model", standard: "mid/model", light: "small/model" });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    // unknown-agent is not in AGENT_TIER_MAP and not a primary — no model field set
    expect(result.agent["unknown-agent"].model).toBeUndefined();
    // explore IS in tier map
    expect(result.agent.explore.model).toBe("small/model");
  });
});

// ---------------------------------------------------------------------------
// D. Integration: writeOpencodeAgent with model config
// ---------------------------------------------------------------------------

describe("writeOpencodeAgent with modelConfig", () => {
  let tempDir: string;
  let originalHome: string | undefined;
  let configDir: string;
  let configFile: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "spoc-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tempDir;
    configDir = join(tempDir, ".config", "opencode");
    configFile = join(configDir, "opencode.json");
    mkdirSync(configDir, { recursive: true });
    // Seed an empty config
    writeFileSync(configFile, JSON.stringify({}));
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    await rm(tempDir, { recursive: true });
  });

  it("does not set model on primary agents without perAgent override", async () => {
    writeOpencodeAgent({ heavy: "big/m", standard: "mid/m", light: "sm/m" });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    expect(result.agent["SPOC Orchestrator"].model).toBeUndefined();
    expect(result.agent["SPOC Caveman"].model).toBeUndefined();
  });

  it("sets model on primary agents with perAgent override", async () => {
    writeOpencodeAgent({
      heavy: "big/m",
      standard: "mid/m",
      light: "sm/m",
      perAgent: { "SPOC Orchestrator": "override/orch" },
    });

    const result = JSON.parse(await readFile(configFile, "utf-8"));
    expect(result.agent["SPOC Orchestrator"].model).toBe("override/orch");
    expect(result.agent["SPOC Caveman"].model).toBeUndefined();
  });

  it("creates config file if it does not exist", async () => {
    // Remove the seeded file
    const { unlink } = await import("node:fs/promises");
    await unlink(configFile);

    const result = writeOpencodeAgent();
    expect(result.action).toBe("created");
  });
});
