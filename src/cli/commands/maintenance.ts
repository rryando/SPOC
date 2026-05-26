// ---------------------------------------------------------------------------
// Maintenance commands — git-log, sync-agents-md (registry-based)
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import { lstat, symlink, unlink, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { defineCommand, type CLIResult, type CommandFlags, ERROR_CODES } from "../command-registry.js";
import { success, failure } from "../output-envelope.js";
import { requireWriteGate, WriteGateError } from "../../utils/write-gate.js";
import { getDataDir, getProjectDir } from "../../utils/paths.js";
import { readRootMeta } from "../../utils/dag.js";
import { readJsonSafe, validateJson } from "../../utils/json.js";
import { projectMetaSchema } from "../../utils/json-schemas.js";
import { isGitRepo, getGitLog } from "../../utils/git.js";
import { extractOverviewContent, extractInProgressTasks, extractDependenciesContent } from "../../utils/content-assembly.js";
import { readPlanIndex } from "../../utils/project-memory.js";

// ---------------------------------------------------------------------------
// git-log
// ---------------------------------------------------------------------------

defineCommand({
  path: "git-log",
  description: "Show git commit history for a project workspace",
  mutation: false,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    since: { type: "string", description: "Git commit hash or ISO date to start from" },
    limit: { type: "number", default: 20, description: "Max number of commits to return" },
  },
  handler: handleGitLog,
});

async function handleGitLog(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const since = params.since as string | undefined;
  const limit = (params.limit as number) ?? 20;

  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");
  if (!existsSync(metaPath)) {
    return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
  const workspacePaths: string[] = meta.workspacePaths ?? [];

  if (workspacePaths.length === 0) {
    return failure("missing_param", `Project "${slug}" has no workspace paths configured`);
  }

  const cwd = workspacePaths[0];

  if (!isGitRepo(cwd)) {
    return success({ commits: [], info: "Workspace path is not a git repository" });
  }

  const commits = getGitLog(cwd, { since, limit });
  return success(commits);
}

// ---------------------------------------------------------------------------
// sync-agents-md
// ---------------------------------------------------------------------------

defineCommand({
  path: "sync-agents-md",
  description: "Regenerate AGENTS.md from analysis data",
  gated: true,
  gateName: "sync-agents-md",
  mutation: true,
  params: {
    slug: { type: "string", required: true, positional: 0, description: "Project slug" },
    "analysis-file": { type: "string", required: true, description: "Path to JSON analysis file" },
    token: { type: "string", description: "Write-gate token" },
  },
  handler: handleSyncAgentsMd,
});

async function handleSyncAgentsMd(params: Record<string, unknown>, flags: CommandFlags): Promise<CLIResult> {
  const slug = params.slug as string;
  const analysisFile = params["analysis-file"] as string;
  const token = params.token as string | undefined;

  if (flags.dryRun) {
    return success({ dryRun: true, wouldSync: { slug, analysisFile } });
  }

  try {
    requireWriteGate(token, slug, "tool:sync_agents_md");
  } catch (err) {
    if (err instanceof WriteGateError) {
      return failure(err.code, err.message, { hint: err.hint });
    }
    throw err;
  }

  if (!existsSync(analysisFile)) {
    return failure("missing_param", `Analysis file not found: ${analysisFile}`);
  }

  let analysis: unknown;
  try {
    const raw = readFileSync(analysisFile, "utf-8");
    analysis = JSON.parse(raw);
  } catch {
    return failure("invalid_type", `Could not parse analysis file as JSON: ${analysisFile}`);
  }

  const codebaseAnalysis = analysis as {
    directoryStructure: string;
    fileNaming: string;
    codePatterns: string;
    techStack: string;
    testingPatterns?: string;
    additionalNotes?: string;
  };

  if (!codebaseAnalysis.directoryStructure || !codebaseAnalysis.fileNaming || !codebaseAnalysis.codePatterns || !codebaseAnalysis.techStack) {
    return failure("invalid_type", "Analysis file must contain directoryStructure, fileNaming, codePatterns, and techStack fields");
  }

  try {
    const dataDir = getDataDir();
    const rootMeta = await readRootMeta(dataDir);
    const projectNode = rootMeta.projects.find((p) => p.id === slug);
    if (!projectNode) {
      return failure(ERROR_CODES.PROJECT_NOT_FOUND, `Project "${slug}" not found`);
    }

    const projectDir = getProjectDir(slug);
    const metaPath = resolve(projectDir, "meta.json");
    const rawMeta = await readJsonSafe<unknown>(metaPath);
    if (rawMeta === undefined) {
      return failure("internal_error", `Could not read project meta at ${metaPath}`);
    }
    const meta = validateJson(rawMeta, projectMetaSchema, metaPath);
    const name = (meta as { name?: string }).name ?? slug;
    const workspacePaths = Array.isArray((meta as { workspacePaths?: string[] }).workspacePaths)
      ? (meta as { workspacePaths: string[] }).workspacePaths
      : [];

    if (workspacePaths.length === 0) {
      return failure("missing_param", `Project "${slug}" has no workspace paths configured`);
    }

    // Build preamble
    const preamble = `# AGENTS.md — ${name}\n\n> Auto-generated by SPOC. Do not edit manually.\n> Regenerate: \`spoc sync-agents-md ${slug} --analysis-file=<path> --token=<token>\`\n\n---\n\n## Coding Discipline\n\nYou are working in an existing codebase maintained by a team.\nYour code must be indistinguishable from the team's existing code.`;

    // Build analysis sections
    const analysisSections: string[] = [];
    analysisSections.push(`\n## Tech Stack\n\n${codebaseAnalysis.techStack}`);
    analysisSections.push(`\n## Directory Structure\n\n${codebaseAnalysis.directoryStructure}`);
    analysisSections.push(`\n## File Naming Conventions\n\n${codebaseAnalysis.fileNaming}`);
    analysisSections.push(`\n## Code Patterns\n\n${codebaseAnalysis.codePatterns}`);
    if (codebaseAnalysis.testingPatterns?.trim()) {
      analysisSections.push(`\n## Testing Patterns\n\n${codebaseAnalysis.testingPatterns}`);
    }
    if (codebaseAnalysis.additionalNotes?.trim()) {
      analysisSections.push(`\n## Additional Notes\n\n${codebaseAnalysis.additionalNotes}`);
    }

    // Build project context
    const contextSections: string[] = [];
    const overviewPath = resolve(projectDir, "overview.md");
    if (existsSync(overviewPath)) {
      const overviewRaw = await readFile(overviewPath, "utf-8");
      const overviewContent = extractOverviewContent(overviewRaw);
      if (overviewContent) contextSections.push(`\n## Project Overview\n\n${overviewContent}`);
    }
    const tasksPath = resolve(projectDir, "tasks.md");
    if (existsSync(tasksPath)) {
      const tasksRaw = await readFile(tasksPath, "utf-8");
      const inProgress = extractInProgressTasks(tasksRaw);
      if (inProgress.length > 0) contextSections.push(`\n## Current Focus\n\n${inProgress.join("\n")}`);
    }
    const depsPath = resolve(projectDir, "dependencies.md");
    if (existsSync(depsPath)) {
      const depsRaw = await readFile(depsPath, "utf-8");
      const depsContent = extractDependenciesContent(depsRaw);
      if (depsContent) contextSections.push(`\n## Dependencies\n\n${depsContent}`);
    }
    const planIndex = await readPlanIndex(projectDir);
    const activePlans = planIndex.plans.filter((p) => p.status === "in_progress" || p.status === "planned");
    if (activePlans.length > 0) {
      const bullets = activePlans.map((p) => `- **${p.title}** (${p.status})${p.summary ? `: ${p.summary}` : ""}`).join("\n");
      contextSections.push(`\n## Active Plans\n\n${bullets}`);
    }

    const content = `${preamble}\n\n---${analysisSections.join("")}\n${contextSections.length > 0 ? `\n---${contextSections.join("")}` : ""}\n`;

    // Write source and symlink
    const sourcePath = resolve(projectDir, "AGENTS.md");
    await writeFile(sourcePath, content, "utf-8");

    const symlinked: string[] = [];
    const warnings: string[] = [];
    for (const wsPath of workspacePaths) {
      if (!existsSync(wsPath)) {
        warnings.push(`Warning: workspace path "${wsPath}" does not exist, skipped.`);
        continue;
      }
      const linkPath = join(wsPath, "AGENTS.md");
      try {
        await lstat(linkPath);
        await unlink(linkPath);
      } catch { /* does not exist */ }
      await symlink(sourcePath, linkPath);
      symlinked.push(linkPath);
    }

    return success({ sourcePath, symlinked, warnings });
  } catch (err) {
    return failure("internal_error", err instanceof Error ? err.message : String(err));
  }
}
