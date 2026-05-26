import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeOpencodeAgent } from "../src/cli/instructions.js";
import {
  CAVEMAN_PREAMBLE,
  ORCHESTRATE_CAVEMAN_PROMPT_TEXT,
} from "../src/cli/spoc-orchestrate-caveman.js";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

describe("writeOpencodeAgent — agent key order", () => {
  it("places SPOC Orchestrator first and SPOC Caveman second in a fresh config", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agentKeys = Object.keys(config.agent as object);

      expect(agentKeys[0]).toBe("SPOC Orchestrator");
      expect(agentKeys[1]).toBe("SPOC Caveman");
    });
  });

  it("places SPOC agents first and build third when existing config has build and plan", async () => {
    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const existing = {
        $schema: "https://opencode.ai/config.json",
        agent: {
          build: { model: "some-model" },
          plan: { model: "another-model" },
          general: { model: "third-model" },
        },
      };
      writeFileSync(configFile, JSON.stringify(existing, null, 2));

      writeOpencodeAgent();

      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agentKeys = Object.keys(config.agent as object);

      expect(agentKeys[0]).toBe("SPOC Orchestrator");
      expect(agentKeys[1]).toBe("SPOC Caveman");
      expect(agentKeys[2]).toBe("build");
    });
  });

  it("preserves all existing agent configs when reordering", async () => {
    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const existing = {
        agent: {
          plan: { model: "opus" },
          build: { model: "sonnet" },
        },
      };
      writeFileSync(configFile, JSON.stringify(existing, null, 2));

      writeOpencodeAgent();

      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = config.agent as Record<string, unknown>;

      expect((agents.build as any).model).toBe("sonnet");
      expect((agents.plan as any).model).toBe("opus");
      expect(agents["SPOC Orchestrator"]).toBeDefined();
      expect(agents["SPOC Caveman"]).toBeDefined();
    });
  });

  it("does not duplicate SPOC agents if already present", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agentKeys = Object.keys(config.agent as object);

      const orchestratorCount = agentKeys.filter((k) => k === "SPOC Orchestrator").length;
      const cavemanCount = agentKeys.filter((k) => k === "SPOC Caveman").length;
      expect(orchestratorCount).toBe(1);
      expect(cavemanCount).toBe(1);
      expect(agentKeys[0]).toBe("SPOC Orchestrator");
      expect(agentKeys[1]).toBe("SPOC Caveman");
    });
  });

  it("sets default_agent to SPOC Orchestrator (Caveman is opt-in)", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;

      expect(config.default_agent).toBe("SPOC Orchestrator");
    });
  });

  it("writes both orchestrator prompt files to disk", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const orchestratorPrompt = resolve(
        homeDir,
        ".config",
        "opencode",
        "prompts",
        "spoc-orchestrate.txt",
      );
      const cavemanPrompt = resolve(
        homeDir,
        ".config",
        "opencode",
        "prompts",
        "spoc-orchestrate-caveman.txt",
      );

      const orchestratorContent = readFileSync(orchestratorPrompt, "utf-8");
      const cavemanContent = readFileSync(cavemanPrompt, "utf-8");

      expect(orchestratorContent).toContain("orchestration agent for SPOC, a CLI-first");
      expect(cavemanContent).toContain("Caveman Mode");
      // Caveman wraps the full orchestrator prompt
      expect(cavemanContent).toContain("orchestration agent for SPOC, a CLI-first");
      // Caveman must include the sub-agent propagation rule so caveman mode
      // cascades into dispatched sub-agents
      expect(cavemanContent).toContain("Sub-Agent Propagation");
      expect(cavemanContent).toContain("INHERITED from SPOC Caveman orchestrator");
      // Caveman must reference the bundled commit/review skills
      expect(cavemanContent).toContain("caveman-commit");
      expect(cavemanContent).toContain("caveman-review");
    });
  });
});

describe("Caveman preamble content regression", () => {
  it("contains all three intensity levels", () => {
    expect(CAVEMAN_PREAMBLE).toContain("| **lite** |");
    expect(CAVEMAN_PREAMBLE).toContain("| **full** |");
    expect(CAVEMAN_PREAMBLE).toContain("| **ultra** |");
  });

  it("contains required section headings", () => {
    expect(CAVEMAN_PREAMBLE).toContain("Auto-Clarity");
    expect(CAVEMAN_PREAMBLE).toContain("Sub-Agent Propagation");
    expect(CAVEMAN_PREAMBLE).toContain("Carve-outs — Structured-Terse");
  });

  it("contains sub-agent inheritance block", () => {
    expect(CAVEMAN_PREAMBLE).toContain(
      "# Caveman Mode (INHERITED from SPOC Caveman orchestrator)",
    );
    expect(CAVEMAN_PREAMBLE).toContain("Respond terse like caveman");
  });

  it("has correct agent metadata for SPOC Orchestrator and Caveman", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agents = config.agent as Record<string, any>;

      expect(agents["SPOC Orchestrator"].color).toBe("#00bcd4");
      expect(agents["SPOC Orchestrator"].mode).toBe("primary");
      expect(agents["SPOC Caveman"].color).toBe("#d2691e");
      expect(agents["SPOC Caveman"].mode).toBe("primary");
      expect(agents["SPOC Caveman"].description).toContain("token-efficient");
    });
  });

  it("caveman prompt file starts with CAVEMAN_PREAMBLE", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const cavemanPrompt = resolve(
        homeDir,
        ".config",
        "opencode",
        "prompts",
        "spoc-orchestrate-caveman.txt",
      );
      const content = readFileSync(cavemanPrompt, "utf-8");
      expect(content.startsWith(CAVEMAN_PREAMBLE)).toBe(true);
    });
  });

  it("contains structured-terse token for commit carve-out", () => {
    expect(CAVEMAN_PREAMBLE).toContain("structured-terse");
  });
});
