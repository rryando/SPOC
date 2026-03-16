import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const SEED_META = JSON.stringify({ version: "1.0", projects: [] }, null, 2);

export async function withTempDataDir(
  run: (dir: string) => Promise<void> | void
): Promise<void> {
  const originalDataDir = process.env["CC_DAG_DATA_DIR"];
  const dir = mkdtempSync(resolve(tmpdir(), "cc-dag-test-"));

  writeFileSync(resolve(dir, "meta.json"), SEED_META, "utf-8");
  process.env["CC_DAG_DATA_DIR"] = dir;

  try {
    await run(dir);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env["CC_DAG_DATA_DIR"];
    } else {
      process.env["CC_DAG_DATA_DIR"] = originalDataDir;
    }

    rmSync(dir, { recursive: true, force: true });
  }
}
