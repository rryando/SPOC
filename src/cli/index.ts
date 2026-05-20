import { handlePreviewCli } from "./preview.js";
import { runSetup } from "./setup.js";

// ---------------------------------------------------------------------------
// CLI Subcommand Router
// ---------------------------------------------------------------------------

/**
 * Entry point for `npx spoc init`, `npx spoc config`, `npx spoc preview`.
 * Returns true if a CLI subcommand was handled, false if the caller
 * should proceed with MCP server startup.
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

    default:
      return false;
  }
}
