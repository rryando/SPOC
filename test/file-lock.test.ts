import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, withLock } from "../src/utils/file-lock.js";

describe("file-lock", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "spoc-lock-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("acquires and releases a lock", async () => {
    const target = join(tmp, "test.json");
    writeFileSync(target, "{}", "utf-8");

    const release = await acquireLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);

    await release();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("withLock executes function and releases lock", async () => {
    const target = join(tmp, "test.json");
    writeFileSync(target, "{}", "utf-8");

    const result = await withLock(target, () => {
      expect(existsSync(`${target}.lock`)).toBe(true);
      return 42;
    });

    expect(result).toBe(42);
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("withLock releases lock even on error", async () => {
    const target = join(tmp, "test.json");
    writeFileSync(target, "{}", "utf-8");

    await expect(
      withLock(target, () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("can re-acquire lock after release", async () => {
    const target = join(tmp, "test.json");
    writeFileSync(target, "{}", "utf-8");

    const release1 = await acquireLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);
    await release1();
    expect(existsSync(`${target}.lock`)).toBe(false);

    const release2 = await acquireLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);
    await release2();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });

  it("release is idempotent", async () => {
    const target = join(tmp, "test.json");
    writeFileSync(target, "{}", "utf-8");

    const release = await acquireLock(target);
    await release();
    // Should not throw when called again
    await expect(release()).resolves.toBeUndefined();
  });

  it("works on paths that do not exist yet", async () => {
    const target = join(tmp, "nonexistent.json");
    // Target file does not exist, but lock should still work
    const release = await acquireLock(target);
    expect(existsSync(`${target}.lock`)).toBe(true);
    await release();
    expect(existsSync(`${target}.lock`)).toBe(false);
  });
});
