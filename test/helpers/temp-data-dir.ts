import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const SEED_META = JSON.stringify({ version: "1.0", projects: [] }, null, 2);

export async function withTempDataDir(run: (dir: string) => Promise<void> | void): Promise<void> {
  const originalDataDir = process.env.SPOC_DATA_DIR;
  const originalSkipGraphify = process.env.SPOC_SKIP_GRAPHIFY;
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-test-"));

  writeFileSync(resolve(dir, "meta.json"), SEED_META, "utf-8");
  process.env.SPOC_DATA_DIR = dir;
  process.env.SPOC_SKIP_GRAPHIFY = "1";

  try {
    await run(dir);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.SPOC_DATA_DIR;
    } else {
      process.env.SPOC_DATA_DIR = originalDataDir;
    }

    if (originalSkipGraphify === undefined) {
      delete process.env.SPOC_SKIP_GRAPHIFY;
    } else {
      process.env.SPOC_SKIP_GRAPHIFY = originalSkipGraphify;
    }

    rmSync(dir, { recursive: true, force: true });
  }
}
