// ---------------------------------------------------------------------------
// stdin — Shared stdin reading utility
// ---------------------------------------------------------------------------

/**
 * Read all data from stdin with a configurable timeout.
 * Rejects if no data arrives within the timeout window.
 */
export async function readStdin(timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out reading from stdin (${timeoutMs / 1000}s). Ensure data is piped to the command.`));
    }, timeoutMs);
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
