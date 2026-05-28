import "./commands/index.js"; // Trigger command registrations
import { parseArgs } from "./arg-parser.js";
import { getCommand } from "./command-registry.js";
import { handleDagCommand } from "./dag-commands.js";
import {
  formatCommandsDiscovery,
  generateCommandHelp,
  generateCommandsDiscovery,
} from "./help-generator.js";
import { render } from "./output-envelope.js";
import { runSetup } from "./setup.js";

// ---------------------------------------------------------------------------
// CLI Subcommand Router
// ---------------------------------------------------------------------------

/**
 * Determine the longest-match command path from raw args.
 * Tries two-word path first (e.g. "task transition"), then single word.
 */
function determineCommandPath(args: string[]): { path: string; remaining: string[] } | undefined {
  if (args.length >= 2) {
    const twoWord = `${args[0]} ${args[1]}`;
    if (getCommand(twoWord)) {
      return { path: twoWord, remaining: args.slice(2) };
    }
  }
  if (args.length >= 1) {
    const oneWord = args[0];
    if (getCommand(oneWord)) {
      return { path: oneWord, remaining: args.slice(1) };
    }
  }
  return undefined;
}

/**
 * Entry point for `npx arcs init`, `npx arcs config`.
 * Returns true if a CLI subcommand was handled, false if the caller
 * should proceed with normal exit.
 */
export async function handleCli(args: string[]): Promise<boolean> {
  const command = args[0];

  // --commands discovery
  if (args.includes("--commands")) {
    const json = args.includes("--json");
    const discovery = generateCommandsDiscovery();
    if (json) {
      console.log(JSON.stringify({ ok: true, data: discovery }));
    } else {
      console.log(formatCommandsDiscovery(discovery, false));
    }
    return true;
  }

  // Registry-first routing
  const match = determineCommandPath(args);
  if (match) {
    const registeredCmd = getCommand(match.path)!;
    const result = parseArgs(registeredCmd, match.remaining);
    if (!result.ok) {
      const flags = {
        json: match.remaining.includes("--json"),
        lean: match.remaining.includes("--lean"),
      };
      render(result.error, flags, match.path);
      process.exitCode = 1;
      return true;
    }
    if (result.parsed.flags.help) {
      console.log(generateCommandHelp(registeredCmd));
      return true;
    }
    const cmdResult = await registeredCmd.handler(result.parsed.params, result.parsed.flags);
    render(cmdResult, result.parsed.flags, match.path);
    if (!cmdResult.ok) process.exitCode = 1;
    return true;
  }

  switch (command) {
    case "init":
      await runSetup("init");
      return true;

    case "config":
      await runSetup("config");
      return true;

    case "task":
    case "plan":
    case "knowledge":
    case "diagram":
    case "project":
    case "doc":
    case "dependency":
    case "paths":
    case "loop":
    case "graph":
      return handleDagCommand(command, args.slice(1));

    default:
      return false;
  }
}
