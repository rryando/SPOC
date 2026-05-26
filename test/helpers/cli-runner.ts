// ---------------------------------------------------------------------------
// CLI Runner — test helper that invokes commands through the registry path
// ---------------------------------------------------------------------------

import { getCommand, type CLIResult } from "../../src/cli/command-registry.js";
import { parseArgs } from "../../src/cli/arg-parser.js";

// Import command registrations (side-effect imports)
import "../../src/cli/commands/index.js";

/**
 * Run a CLI command through the registry and return the CLIResult directly.
 * Use this in new tests to verify envelope-format behavior.
 */
export async function runCommand(path: string, args: string[] = []): Promise<CLIResult> {
  const cmd = getCommand(path);
  if (!cmd) throw new Error(`Command not found in registry: ${path}`);

  const parsed = parseArgs(cmd, args);
  if (!parsed.ok) return parsed.error;

  // Early return for --help
  if (parsed.parsed.flags.help) {
    return { ok: true, data: { help: true, path: cmd.path, description: cmd.description } };
  }

  return cmd.handler(parsed.parsed.params, parsed.parsed.flags);
}
