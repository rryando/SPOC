// ---------------------------------------------------------------------------
// Quick Scan — extract initial project context from a git repo
// ---------------------------------------------------------------------------

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface TodoEntry {
  file: string;
  line: number;
  text: string;
}

export interface QuickScanResult {
  recentBranches: string[];
  recentCommitTopics: string[];
  todos: TodoEntry[];
  suggestedTasks: string[];
}

function exec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function isGitRepo(repoPath: string): boolean {
  return exec("git rev-parse --is-inside-work-tree", repoPath) === "true";
}

function getRecentBranches(repoPath: string): string[] {
  const output = exec("git branch --sort=-committerdate --format='%(refname:short)'", repoPath);
  if (!output) return [];

  return output
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b && !["main", "master", "HEAD"].includes(b))
    .slice(0, 5);
}

function getRecentCommitTopics(repoPath: string): string[] {
  const output = exec("git log --oneline -20", repoPath);
  if (!output) return [];

  const seen = new Set<string>();
  const topics: string[] = [];

  for (const line of output.split("\n")) {
    // Remove the short SHA prefix (7 hex chars + space)
    const message = line.replace(/^[0-9a-f]{7,} /, "").trim();
    if (!message) continue;

    // Extract conventional commit prefix (feat:, fix:, chore:, etc.) or first 50 chars
    const conventionalMatch = message.match(/^(\w+)(?:\([^)]+\))?:\s*(.+)/);
    const topic = conventionalMatch
      ? `${conventionalMatch[1]}: ${conventionalMatch[2].slice(0, 60)}`
      : message.slice(0, 60);

    if (!seen.has(topic)) {
      seen.add(topic);
      topics.push(topic);
    }
  }

  return topics;
}

function getTodos(repoPath: string): TodoEntry[] {
  const excludeDirs = ["node_modules", "dist", ".git", "vendor", "target"];
  const excludeArgs = excludeDirs.map((d) => `--exclude-dir=${d}`).join(" ");
  const includePatterns = ["*.ts", "*.js", "*.py", "*.rs"].map((p) => `--include="${p}"`).join(" ");

  const output = exec(
    `grep -rn ${excludeArgs} ${includePatterns} "TODO\\|FIXME" . | head -20`,
    repoPath,
  );
  if (!output) return [];

  const todos: TodoEntry[] = [];
  for (const line of output.split("\n")) {
    // Format: ./path/to/file.ts:42:  // TODO: fix this
    const match = line.match(/^\.\/(.+?):(\d+):(.+)$/);
    if (!match) continue;

    const [, file, lineStr, rawText] = match;
    const text = rawText
      .trim()
      .replace(/^[/*# ]+/, "")
      .trim();
    todos.push({ file, line: parseInt(lineStr, 10), text });
  }

  return todos.slice(0, 20);
}

function branchToTaskTitle(branch: string): string {
  // feat/foo-bar → "Implement foo bar"
  // fix/some-bug → "Fix some bug"
  // chore/update-deps → "Update deps"
  const prefixMap: Record<string, string> = {
    feat: "Implement",
    feature: "Implement",
    fix: "Fix",
    bugfix: "Fix",
    hotfix: "Fix",
    chore: "",
    refactor: "Refactor",
    docs: "Document",
    test: "Test",
    ci: "Configure CI for",
    release: "Release",
  };

  const slashIdx = branch.indexOf("/");
  if (slashIdx === -1) {
    // No prefix — just humanize the branch name
    return humanize(branch);
  }

  const prefix = branch.slice(0, slashIdx).toLowerCase();
  const rest = branch.slice(slashIdx + 1);
  const humanRest = humanize(rest);
  const verb = prefixMap[prefix];

  if (verb === undefined) {
    return humanize(branch.replace("/", " "));
  }
  return verb ? `${verb} ${humanRest}` : humanRest;
}

function humanize(slug: string): string {
  return slug
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

function todoToTaskTitle(todo: TodoEntry): string {
  // Strip TODO:/FIXME: prefix and return first 80 chars
  return todo.text
    .replace(/^(TODO|FIXME)\s*[:!-]?\s*/i, "")
    .slice(0, 80)
    .trim();
}

export function quickScan(repoPath: string): QuickScanResult {
  const absPath = resolve(repoPath);

  if (!existsSync(absPath)) {
    return { recentBranches: [], recentCommitTopics: [], todos: [], suggestedTasks: [] };
  }

  const gitRepo = isGitRepo(absPath);

  const recentBranches = gitRepo ? getRecentBranches(absPath) : [];
  const recentCommitTopics = gitRepo ? getRecentCommitTopics(absPath) : [];
  const todos = getTodos(absPath);

  // Build suggested tasks: branches first, then TODO-derived, dedup, max 5
  const seen = new Set<string>();
  const suggested: string[] = [];

  for (const branch of recentBranches) {
    if (suggested.length >= 5) break;
    const title = branchToTaskTitle(branch);
    if (title && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      suggested.push(title);
    }
  }

  for (const todo of todos) {
    if (suggested.length >= 5) break;
    const title = todoToTaskTitle(todo);
    if (title && title.length > 5 && !seen.has(title.toLowerCase())) {
      seen.add(title.toLowerCase());
      suggested.push(title);
    }
  }

  return { recentBranches, recentCommitTopics, todos, suggestedTasks: suggested };
}
