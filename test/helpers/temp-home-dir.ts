import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export async function withTempHomeDir(
  run: (homeDir: string) => Promise<void> | void,
): Promise<void> {
  const originalHome = process.env["HOME"];
  const homeDir = mkdtempSync(resolve(tmpdir(), "spoc-home-"));

  mkdirSync(resolve(homeDir, ".config", "opencode"), { recursive: true });
  process.env["HOME"] = homeDir;

  try {
    await run(homeDir);
  } finally {
    if (originalHome === undefined) {
      delete process.env["HOME"];
    } else {
      process.env["HOME"] = originalHome;
    }
    rmSync(homeDir, { recursive: true, force: true });
  }
}
