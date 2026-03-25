import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "../src/cli/setup.js";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

vi.mock("@clack/prompts", () => {
  const confirm = vi.fn();
  const note = vi.fn();

  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note,
    cancel: vi.fn(),
    isCancel: () => false,
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    confirm,
    __confirm: confirm,
    __note: note,
  };
});

vi.mock("../src/cli/opencode-superpowers.js", () => ({
  detectOpencodeSuperpowersInstall: vi.fn(() => ({ state: "absent" })),
  installBundledOpencodeSuperpowers: vi.fn(() => ({
    status: "installed",
    summary: "Installed bundled superpowers",
  })),
}));

describe("OpenCode setup flow", () => {
  beforeEach(async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked((prompts as any).__confirm).mockReset();
    vi.mocked((prompts as any).__note).mockReset();
    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReset();
    vi.mocked(installer.installBundledOpencodeSuperpowers).mockReset();
    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReturnValue({
      state: "absent",
    } as any);
    vi.mocked(installer.installBundledOpencodeSuperpowers).mockReturnValue({
      status: "installed",
      summary: "Installed bundled superpowers",
    } as any);
  });

  it("installs bundled superpowers during init when user confirms setup", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(true); // register agent

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installBundledOpencodeSuperpowers).toHaveBeenCalledWith({
        autoConfirmReplacement: false,
      });
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("Installed bundled superpowers"),
        "OpenCode Superpowers",
      );
    });
  });

  it("re-syncs bundled superpowers during config when user confirms setup", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(true); // register agent

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installBundledOpencodeSuperpowers).toHaveBeenCalledWith({
        autoConfirmReplacement: false,
      });
    });
  });

  it("skips bundled superpowers install when the user declines OpenCode agent registration", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(false); // decline agent registration

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installBundledOpencodeSuperpowers).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("declined SPOC Orchestrator registration"),
        "OpenCode Superpowers",
      );
    });
  });

  it("asks before replacing a foreign OpenCode superpowers install during init", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace Superpowers

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installBundledOpencodeSuperpowers).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("asks before replacing a foreign OpenCode superpowers install during config", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace Superpowers

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installBundledOpencodeSuperpowers).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("skips replacement when the user declines foreign install takeover", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(true) // write MCP
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(false); // decline Superpowers

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installBundledOpencodeSuperpowers).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("Skipped OpenCode bundled Superpowers install"),
        "OpenCode Superpowers",
      );
    });
  });

  it("re-applies MCP entry even when already configured (config mode)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm).mockResolvedValueOnce(true); // setup confirm only — MCP and agent already present, no prompts

    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      // Pre-populate config: MCP and agent already present, but missing default_agent
      writeFileSync(
        configFile,
        JSON.stringify(
          {
            mcp: {
              spoc: { type: "local", command: ["node", "/old/path/index.js"], enabled: true },
            },
            agent: { "SPOC Orchestrator": { mode: "primary", prompt: "old-prompt" } },
          },
          null,
          2,
        ),
      );

      await runSetup("config");

      const updated = JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>;
      // default_agent must now be set even though it was absent before
      expect(updated.default_agent).toBe("SPOC Orchestrator");
      // MCP command should be updated to current dist path (not old stale path)
      const mcp = updated.mcp as Record<string, unknown>;
      const spoc = mcp?.spoc as Record<string, unknown>;
      const cmd = spoc?.command as string[];
      expect(cmd?.[1]).not.toBe("/old/path/index.js");
    });
  });

  it("re-applies agent entry even when already configured (config mode, stale prompt)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm).mockResolvedValueOnce(true); // setup confirm only — both already present, no extra prompts

    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      // Pre-populate: agent already registered with stale prompt, no default_agent
      writeFileSync(
        configFile,
        JSON.stringify(
          {
            mcp: {
              spoc: { type: "local", command: ["node", "/some/path/index.js"], enabled: true },
            },
            agent: { "SPOC Orchestrator": { mode: "primary", prompt: "stale-prompt-text" } },
          },
          null,
          2,
        ),
      );

      await runSetup("config");

      const updated = JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>;
      // default_agent must now be set
      expect(updated.default_agent).toBe("SPOC Orchestrator");
      // Agent prompt should be updated to the current template value
      const agents = updated.agent as Record<string, unknown>;
      const spocAgent = agents?.["SPOC Orchestrator"] as Record<string, unknown>;
      expect(spocAgent?.prompt).not.toBe("stale-prompt-text");
    });
  });
});
