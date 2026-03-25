/**
 * Lightweight advisory file locking for concurrent write protection.
 *
 * Uses a .lock file alongside the target file. The lock file is created
 * with O_EXCL (exclusive create) which is atomic on all platforms.
 * Includes a stale lock timeout to prevent deadlocks from crashed processes.
 */
import { constants } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";

const STALE_LOCK_MS = 10_000; // 10 seconds — locks older than this are considered stale
const RETRY_INTERVAL_MS = 50;
const MAX_RETRIES = 200; // 10 seconds total max wait

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Acquire an advisory lock on a file path.
 * Returns a release function that must be called when done.
 *
 * @throws Error if lock cannot be acquired within timeout
 */
export async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockPath = `${filePath}.lock`;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // O_CREAT | O_EXCL — atomic create, fails if exists
      const handle = await open(
        lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      );
      await handle.close();

      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          // Already removed — fine
        }
      };
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code: string }).code === "EEXIST"
      ) {
        // Lock exists — check if stale
        try {
          const lockStat = await stat(lockPath);
          if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
            try {
              await unlink(lockPath);
            } catch {
              // Race with another cleaner — retry
            }
            continue; // Retry immediately after cleaning stale lock
          }
        } catch {
          // Lock gone, retry
        }

        await sleep(RETRY_INTERVAL_MS);
        continue;
      }
      throw err; // Unexpected error
    }
  }

  throw new Error(
    `Could not acquire lock on "${filePath}" after ${MAX_RETRIES * RETRY_INTERVAL_MS}ms`,
  );
}

/**
 * Execute a function while holding a lock on the given file path.
 * The lock is released after the function returns (or throws).
 */
export async function withLock<T>(filePath: string, fn: () => T | Promise<T>): Promise<T> {
  const release = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    await release();
  }
}
