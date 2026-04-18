import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeOpencodeAgent } from "../src/cli/instructions.js";
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

      expect(orchestratorContent).toContain("orchestration agent for the SPOC MCP server");
      expect(cavemanContent).toContain("Caveman Mode");
      // Caveman wraps the full orchestrator prompt
      expect(cavemanContent).toContain("orchestration agent for the SPOC MCP server");
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
