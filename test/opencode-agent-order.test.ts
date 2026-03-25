import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { writeOpencodeAgent } from "../src/cli/instructions.js";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

describe("writeOpencodeAgent — agent key order", () => {
  it("places SPOC Orchestrator first in a fresh config", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agentKeys = Object.keys(config.agent as object);

      expect(agentKeys[0]).toBe("SPOC Orchestrator");
    });
  });

  it("places SPOC Orchestrator first and build second when existing config has build and plan", async () => {
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
      expect(agentKeys[1]).toBe("build");
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
    });
  });

  it("does not duplicate SPOC Orchestrator if already present", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;
      const agentKeys = Object.keys(config.agent as object);

      const spocCount = agentKeys.filter((k) => k === "SPOC Orchestrator").length;
      expect(spocCount).toBe(1);
      expect(agentKeys[0]).toBe("SPOC Orchestrator");
    });
  });

  it("sets default_agent to SPOC Orchestrator", async () => {
    await withTempHomeDir(async (homeDir) => {
      writeOpencodeAgent();

      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      const raw = readFileSync(configFile, "utf-8");
      const config = JSON.parse(raw) as Record<string, unknown>;

      expect(config.default_agent).toBe("SPOC Orchestrator");
    });
  });
});
