import { execSync } from "node:child_process";

export interface GitLogEntry {
  sha: string;
  message: string;
  date: string;
  filesChanged: string[];
}

function exec(cmd: string, cwd: string): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

export function isGitRepo(cwd: string): boolean {
  return exec("git rev-parse --is-inside-work-tree", cwd) === "true";
}

export function getHeadCommit(cwd: string): string | null {
  return exec("git rev-parse --short HEAD", cwd);
}

export function getGitLog(
  cwd: string,
  options?: { since?: string; limit?: number },
): GitLogEntry[] {
  const limit = options?.limit ?? 50;
  const since = options?.since;

  let cmd = `git log --format=%H%n%s%n%aI -n ${limit}`;
  if (since) {
    // Try as ISO date first; if it looks like a SHA, use commit range
    if (/^[a-f0-9]{4,40}$/.test(since)) {
      cmd += ` ${since}..HEAD`;
    } else {
      cmd += ` --since="${since}"`;
    }
  }

  const output = exec(cmd, cwd);
  if (!output) return [];

  const lines = output.split("\n");
  const entries: GitLogEntry[] = [];

  for (let i = 0; i + 2 < lines.length; i += 3) {
    const fullSha = lines[i];
    const message = lines[i + 1];
    const date = lines[i + 2];
    const shortSha = fullSha.slice(0, 7);

    // Get files changed for this commit
    const filesOutput = exec(`git diff-tree --no-commit-id --name-only -r ${fullSha}`, cwd);
    const filesChanged = filesOutput ? filesOutput.split("\n").filter(Boolean) : [];

    entries.push({ sha: shortSha, message, date, filesChanged });
  }

  return entries;
}

export function getFilesChanged(cwd: string, fromCommit: string): string[] {
  const output = exec(`git diff --name-only ${fromCommit} HEAD`, cwd);
  if (!output) return [];
  return output.split("\n").filter(Boolean);
}
