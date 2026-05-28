#!/usr/bin/env node
import { handleCli } from "./cli/index.js";

async function run(): Promise<void> {
  const args = process.argv.slice(2);

  // TTY detection: if human at terminal with no args, show status dashboard
  if (args.length === 0 && process.stdin.isTTY) {
    const { showStatusDashboard } = await import("./cli/status-dashboard.js");
    await showStatusDashboard();
    return;
  }

  // Handle CLI subcommands
  if (args.length > 0) {
    const handled = await handleCli(args);
    if (handled) return;
  }

  // No recognized command
  console.error("Unknown command. Run `arcs --help` for usage.");
  process.exit(1);
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
