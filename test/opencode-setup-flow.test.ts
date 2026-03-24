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
    vi.mocked(installer.detectOpencodeSuperpowersInstall).mockReturnValue({ state: "absent" } as any);
    vi.mocked(installer.installBundledOpencodeSuperpowers).mockReturnValue({
      status: "installed",
      summary: "Installed bundled superpowers",
    } as any);
  });

  it("installs bundled superpowers during init when user confirms setup", async () => {
    const prompts = await import("@clack/prompts");
    const installer = await import("../src/cli/opencode-superpowers.js");

    vi.mocked((prompts as any).__confirm)
      .mockResolvedValueOnce(true)  // setup confirm
      .mockResolvedValueOnce(true)  // write MCP
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
      .mockResolvedValueOnce(true)  // setup confirm
      .mockResolvedValueOnce(true)  // write MCP
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
      .mockResolvedValueOnce(true)   // setup confirm
      .mockResolvedValueOnce(true)   // write MCP
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
      .mockResolvedValueOnce(true)  // setup confirm
      .mockResolvedValueOnce(true)  // write MCP
      .mockResolvedValueOnce(true)  // register agent
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
      .mockResolvedValueOnce(true)  // setup confirm
      .mockResolvedValueOnce(true)  // write MCP
      .mockResolvedValueOnce(true)  // register agent
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
      .mockResolvedValueOnce(true)   // setup confirm
      .mockResolvedValueOnce(true)   // write MCP
      .mockResolvedValueOnce(true)   // register agent
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
});
