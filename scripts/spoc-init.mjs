#!/usr/bin/env node

// SPOC CLI global registration
// Usage: node scripts/spoc-init.mjs [-g] [--uninstall]
// Creates symlink ~/.local/bin/spoc → scripts/spoc-cli.mjs

import { existsSync, mkdirSync, symlinkSync, unlinkSync, readlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dirname, "spoc-cli.mjs");
const binDir = resolve(process.env.HOME || "~", ".local/bin");
const linkPath = resolve(binDir, "spoc");
const uninstall = process.argv.includes("--uninstall");

if (uninstall) {
  if (existsSync(linkPath)) {
    unlinkSync(linkPath);
    console.log(`Removed: ${linkPath}`);
  } else {
    console.log("Nothing to remove.");
  }
  process.exit(0);
}

// Ensure bin dir
if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

// Remove stale symlink if exists
if (existsSync(linkPath)) {
  const current = readlinkSync(linkPath);
  if (current === cliPath) {
    console.log(`Already registered: ${linkPath} → ${cliPath}`);
    process.exit(0);
  }
  unlinkSync(linkPath);
}

symlinkSync(cliPath, linkPath);
console.log(`Registered: ${linkPath} → ${cliPath}`);

// PATH check
const pathDirs = (process.env.PATH || "").split(":");
if (!pathDirs.includes(binDir)) {
  console.warn(`\nWARNING: ${binDir} is not in PATH.`);
  console.warn(`Add to your shell rc:  export PATH="$HOME/.local/bin:$PATH"`);
}

console.log(`\nUsage: spoc <command> [args]`);
console.log(`Commands: context, task, plan, knowledge, search, diagram, batch, validate`);
