#!/usr/bin/env node

// Standalone CLI entry point for sub-agent consumption.
// Requires `npm run build` first — imports from dist/.
// Outputs JSON to stdout, errors to stderr.
// Exit codes: 0 success, 1 user error, 2 internal error.

import { handleCli } from "../dist/cli/index.js";

const args = process.argv.slice(2);

if (args.length === 0) {
  if (process.stdin.isTTY) {
    // Human at terminal: show status dashboard
    const { showStatusDashboard } = await import("../dist/cli/status-dashboard.js");
    await showStatusDashboard();
    process.exit(0);
  }
  process.stderr.write(
    "Usage: spoc <command> [args]\n" +
      "Commands: context, task, plan, knowledge, search, diagram, batch, validate\n" +
      "Run `npm run build` before first use.\n"
  );
  process.exit(1);
}

if (args[0] === "--help" || args[0] === "-h") {
  process.stderr.write(
    "Usage: spoc <command> [args]\n" +
      "Commands: context, task, plan, knowledge, search, diagram, batch, validate\n"
  );
  process.exit(0);
}

try {
  const handled = await handleCli(args);
  if (!handled) {
    process.stderr.write(`Unknown command: ${args[0]}\n`);
    process.exit(1);
  }
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(2);
}
