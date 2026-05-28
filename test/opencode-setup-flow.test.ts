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
  detectArcsBundleInstall: vi.fn(() => ({ state: "absent" })),
  installArcsBundle: vi.fn(() => ({
    status: "installed",
    summary: "Installed bundled ARCS skills",
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
    vi.mocked(installer.detectArcsBundleInstall).mockReset();
    vi.mocked(installer.installArcsBundle).mockReset();
    vi.mocked(installer.detectArcsBundleInstall).mockReturnValue({
      state: "absent",
    } as any);
    vi.mocked(installer.installArcsBundle).mockReturnValue({
      status: "installed",
      summary: "Installed bundled ARCS skills",
    } as any);
  });

  it("installs bundled ARCS skills during init when user confirms setup", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true); // register agent

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installArcsBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: false,
      });
    });
  });

  it("skips bundled ARCS skills install when the user declines OpenCode agent registration", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(false); // decline agent registration

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installArcsBundle).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("declined ARCS Orchestrator registration"),
        "OpenCode ARCS Bundle",
      );
    });
  });

  it("asks before replacing a foreign OpenCode ARCS bundle install during init", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectArcsBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace ARCS Bundle

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installArcsBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("asks before replacing a foreign OpenCode ARCS bundle install during config", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectArcsBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(true); // replace ARCS Bundle

    await withTempHomeDir(async () => {
      await runSetup("config");
      expect(installer.installArcsBundle).toHaveBeenCalledWith({
        autoConfirmReplacement: true,
      });
    });
  });

  it("skips replacement when the user declines foreign install takeover", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/bundle-installer.js");

    vi.mocked(installer.detectArcsBundleInstall).mockReturnValue({
      state: "foreign-existing",
    } as any);
    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(false) // customizeAgents
      .mockResolvedValueOnce(true) // register agent
      .mockResolvedValueOnce(false); // decline ARCS Bundle

    await withTempHomeDir(async () => {
      await runSetup("init");
      expect(installer.installArcsBundle).not.toHaveBeenCalled();
      expect((prompts as any).__note).toHaveBeenCalledWith(
        expect.stringContaining("Skipped OpenCode bundled ARCS Bundle install"),
        "OpenCode ARCS Bundle",
      );
    });
  });

  it("sets default_agent even when agent already configured (config mode)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm).mockResolvedValueOnce(false); // customizeAgents — agent already present, no prompts

    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      // Pre-populate config: agent already present, but missing default_agent
      writeFileSync(
        configFile,
        JSON.stringify(
          {
            agent: { "ARCS Orchestrator": { mode: "primary", prompt: "old-prompt" } },
          },
          null,
          2,
        ),
      );

      await runSetup("config");

      const updated = JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>;
      // default_agent must now be set even though it was absent before
      expect(updated.default_agent).toBe("ARCS Orchestrator");
    });
  });

  it("re-applies agent entry even when already configured (config mode, stale prompt)", async () => {
    const prompts = await import("@clack/prompts");
    const { readFileSync } = await import("node:fs");

    vi.mocked((prompts as any).__confirm).mockResolvedValueOnce(false); // customizeAgents — both already present, no extra prompts

    await withTempHomeDir(async (homeDir) => {
      const configFile = resolve(homeDir, ".config", "opencode", "opencode.json");
      // Pre-populate: agent already registered with stale prompt, no default_agent
      writeFileSync(
        configFile,
        JSON.stringify(
          {
            mcp: {
              arcs: { type: "local", command: ["node", "/some/path/index.js"], enabled: true },
            },
            agent: { "ARCS Orchestrator": { mode: "primary", prompt: "stale-prompt-text" } },
          },
          null,
          2,
        ),
      );

      await runSetup("config");

      const updated = JSON.parse(readFileSync(configFile, "utf-8")) as Record<string, unknown>;
      // default_agent must now be set
      expect(updated.default_agent).toBe("ARCS Orchestrator");
      // Agent prompt should be updated to the current template value
      const agents = updated.agent as Record<string, unknown>;
      const arcsAgent = agents?.["ARCS Orchestrator"] as Record<string, unknown>;
      expect(arcsAgent?.prompt).not.toBe("stale-prompt-text");
    });
  });
});
