import { handleDagCommand } from "./dag-commands.js";
import { handlePreviewCli } from "./preview.js";
import { runSetup } from "./setup.js";

// ---------------------------------------------------------------------------
// CLI Subcommand Router
// ---------------------------------------------------------------------------

/**
 * Entry point for `npx spoc init`, `npx spoc config`, `npx spoc preview`.
 * Returns true if a CLI subcommand was handled, false if the caller
 * should proceed with normal exit.
 */
export async function handleCli(args: string[]): Promise<boolean> {
  const command = args[0];

  switch (command) {
    case "init":
      await runSetup("init");
      return true;

    case "config":
      await runSetup("config");
      return true;

    case "preview":
      return handlePreviewCli(args.slice(1));

    case "context":
    case "task":
    case "plan":
    case "knowledge":
    case "search":
    case "diagram":
    case "batch":
    case "validate":
    case "project":
    case "write":
    case "doc":
    case "dependency":
    case "paths":
    case "loop":
    case "audit":
    case "diff":
    case "git-log":
    case "lint-bundle":
    case "deploy-superpowers":
    case "sync-agents-md":
      return handleDagCommand(command, args.slice(1));

    default:
      return false;
  }
}
