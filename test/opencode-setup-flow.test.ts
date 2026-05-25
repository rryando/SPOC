import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runSetup } from "../src/cli/setup.js";
import { withTempHomeDir } from "./helpers/temp-home-dir.js";

vi.mock("@clack/prompts", () => {
  const confirm = vi.fn();
  const note = vi.fn();
  const text = vi.fn();

  return {
    intro: vi.fn(),
    outro: vi.fn(),
    note,
    cancel: vi.fn(),
    isCancel: () => false,
    spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
    confirm,
    text,
    __confirm: confirm,
    __note: note,
    __text: text,
  };
});

vi.mock("../src/cli/bundle-installer.js", () => ({
  detectSpocBundleInstall: vi.fn(() => ({ state: "absent" })),
  installSpocBundle: vi.fn(() => ({
    status: "installed",
    summary: "Installed bundled SPOC skills",
  })),
}));

describe("OpenCode setup flow", () => {
  beforeEach(async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked((prompts as any).__confirm).mockReset();
    vi.mocked((prompts as any).__note).mockReset();
    vi.mocked((prompts as any).__text).mockReset();
    // text prompts return empty strings by default (model config)
    vi.mocked((prompts as any).__text).mockResolvedValue("");
    vi.mocked(installer.detectSpocBundleInstall).mockReset();
    vi.mocked(installer.installSpocBundle).mockReset();
    vi.mocked(installer.detectSpocBundleInstall).mockReturnValue({
      state: "absent",
    } as any);
    vi.mocked(installer.installSpocBundle).mockReturnValue({
      status: "installed",
      summary: "Installed bundled SPOC skills",
    } as any);
  });

  it("installs bundled SPOC skills during init when user confirms setup", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true); // register agent

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true); // register agent

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installSpocBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: false,
      });
    });
  });

  it("skips bundled SPOC skills install when the user declines OpenCode agent registration", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(false); // decline agent registration

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installSpocBundle).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("declined SPOC Orchestrator registration"),
        "OpenCode SPOC Bundle",
      );
    });
  });

  it("asks before replacing a foreign OpenCode SPOC bundle install during init", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectSpocBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace SPOC Bundle

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installSpocBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("asks before replacing a foreign OpenCode SPOC bundle install during config", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectSpocBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace SPOC Bundle

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installSpocBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("skips replacement when the user declines foreign install takeover", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectSpocBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(false); // decline SPOC Bundle

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installSpocBundle).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("Skipped OpenCode bundled SPOC Bundle install"),
        "OpenCode SPOC Bundle",
      );
    });
  });

  it("sets default_agent even when agent already configured (config mode)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false); // customizeAgents — agent already present, no prompts

    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      // Pre-populate config: agent already present, but missing default_agent
      writeFileSync(
        configFile,
        JSON.stringify(
          {
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
    });
  });

  it("re-applies agent entry even when already configured (config mode, stale prompt)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true) // setup confirm
      .mockResolvedValueOnce(false); // customizeAgents — both already present, no extra prompts

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
