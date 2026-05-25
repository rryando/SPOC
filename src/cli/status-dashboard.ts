import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
import pc from "picocolors";

import { getDataDir } from "../utils/paths.js";

interface ProjectMatch {
  slug: string;
  name: string;
  status: string;
}

interface PlanInfo {
  name: string;
  totalNodes: number;
  doneNodes: number;
  inProgressNodes: number;
  blockedNodes: number;
  backlogNodes: number;
  nextReady: string;
}

/**
 * Show a compact status dashboard when `spoc` is invoked with no args in a TTY.
 */
export async function showStatusDashboard(): Promise<void> {
  const cwd = process.cwd();
  const dataDir = getDataDir();
  const projectsDir = resolve(dataDir, "projects");

  // 1. Find project matching cwd
  const project = findProject(projectsDir, dataDir, cwd);
  if (!project) {
    console.log(pc.dim("No SPOC project found for this directory."));
    return;
  }

  // 2. Read tasks
  const taskCounts = readTaskCounts(resolve(projectsDir, project.slug));

  // 3. Read plans with diagram info
  const plans = readPlans(resolve(projectsDir, project.slug));

  // 4. Check preview server
  const previewRunning = await checkPreviewServer();

  // 5. Render
  render(project, taskCounts, plans, previewRunning);
}

function findProject(
  projectsDir: string,
  dataDir: string,
  cwd: string,
): ProjectMatch | null {
  const metaPath = resolve(dataDir, "meta.json");
  if (!existsSync(metaPath)) return null;

  let rootMeta: { projects?: Array<{ id: string; name: string; status: string }> };
  try {
    rootMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
  } catch {
    return null;
  }

  if (!rootMeta.projects) return null;

  for (const node of rootMeta.projects) {
    const projMetaPath = resolve(projectsDir, node.id, "meta.json");
    if (!existsSync(projMetaPath)) continue;

    try {
      const projMeta = JSON.parse(readFileSync(projMetaPath, "utf-8"));
      const paths: string[] = Array.isArray(projMeta.workspacePaths)
        ? projMeta.workspacePaths
        : [];
      for (const wp of paths) {
        const resolved = wp.startsWith("~")
          ? resolve(homedir(), wp.slice(2))
          : resolve(wp);
        if (cwd === resolved || cwd.startsWith(resolved + "/")) {
          return { slug: node.id, name: node.name, status: node.status };
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function readTaskCounts(projectDir: string): {
  backlog: number;
  inProgress: number;
  done: number;
} {
  const counts = { backlog: 0, inProgress: 0, done: 0 };
  const tasksPath = resolve(projectDir, "tasks.md");
  if (!existsSync(tasksPath)) return counts;

  try {
    const content = readFileSync(tasksPath, "utf-8");
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.includes("- [ ]")) counts.backlog++;
      else if (line.includes("- [/]")) counts.inProgress++;
      else if (line.includes("- [x]")) counts.done++;
    }
  } catch {
    // graceful degradation
  }

  return counts;
}

function readPlans(projectDir: string): PlanInfo[] {
  const plansDir = resolve(projectDir, "plans");
  if (!existsSync(plansDir)) return [];

  const plans: PlanInfo[] = [];

  try {
    const entries = readdirSync(plansDir);
    // Find .diagram.mmd files
    const diagramFiles = entries.filter((e) => e.endsWith(".diagram.mmd"));

    for (const diagramFile of diagramFiles) {
      const planId = diagramFile.replace(".diagram.mmd", "");
      // Try to get plan name from meta
      const planMetaPath = resolve(plansDir, `${planId}.meta.json`);
      let planName = planId;
      if (existsSync(planMetaPath)) {
        try {
          const meta = JSON.parse(readFileSync(planMetaPath, "utf-8"));
          if (meta.title) planName = meta.title;
        } catch {
          // use planId
        }
      }

      // Run manage-diagram.mjs inspect
      const diagramPath = resolve(plansDir, diagramFile);
      try {
        const scriptPath = resolveManageDiagramScript();
        if (!scriptPath) continue;

        const output = execSync(
          `node "${scriptPath}" inspect "${diagramPath}"`,
          { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
        );
        const data = JSON.parse(output);
        const nodes: Array<{ id: string; label?: string; status?: string }> =
          data.nodes ?? [];
        const totalNodes = nodes.length;
        const doneNodes = nodes.filter((n) => n.status === "done").length;
        const inProgressNodes = nodes.filter((n) => n.status === "inProgress").length;
        const blockedNodes = nodes.filter((n) => n.status === "blocked").length;
        const backlogNodes = totalNodes - doneNodes - inProgressNodes - blockedNodes;

        // Parse ready from readyComment (format: "T002" or "T002,T003" or "ready=T002,T003")
        const readyComment: string = data.readyComment ?? "";
        let readyIds: string[] = [];
        if (readyComment) {
          const eqMatch = readyComment.match(/ready=([A-Z0-9,]+)/i);
          if (eqMatch) {
            readyIds = eqMatch[1].split(",").map((s: string) => s.trim());
          } else {
            readyIds = readyComment.split(",").map((s: string) => s.trim()).filter((s: string) => /^T\d+$/i.test(s));
          }
        }
        const nextReadyNode = readyIds.length > 0
          ? nodes.find((n) => n.id === readyIds[0])
          : undefined;
        const nextReady = nextReadyNode
          ? `${nextReadyNode.id} ${nextReadyNode.label ?? ""}`
          : "";

        plans.push({ name: planName, totalNodes, doneNodes, inProgressNodes, blockedNodes, backlogNodes, nextReady });
      } catch {
        // If inspect fails, still show the plan without progress
        plans.push({ name: planName, totalNodes: 0, doneNodes: 0, inProgressNodes: 0, blockedNodes: 0, backlogNodes: 0, nextReady: "" });
      }
    }
  } catch {
    // graceful degradation
  }

  return plans;
}

function resolveManageDiagramScript(): string | null {
  // Check local repo path first, then config path
  const candidates = [
    resolve(
      import.meta.dirname,
      "../../opencode/spoc/skills/to-diagram/scripts/manage-diagram.mjs",
    ),
    resolve(
      homedir(),
      ".config/opencode/skills/spoc/to-diagram/scripts/manage-diagram.mjs",
    ),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function checkPreviewServer(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    const res = await fetch("http://localhost:4077/diagrams", {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

function render(
  project: ProjectMatch,
  tasks: { backlog: number; inProgress: number; done: number },
  plans: PlanInfo[],
  previewRunning: boolean,
): void {
  const WIDTH = 60;
  const innerWidth = WIDTH - 4; // inside box padding

  // Header box
  const topLine = `┌─ ${pc.bold("SPOC")} ${"─".repeat(WIDTH - 7)}┐`;
  const botLine = `└${"─".repeat(WIDTH - 2)}┘`;

  const dirLine = padRight(
    `  Dir:     ${process.cwd()}`,
    innerWidth,
  );
  const projectLine = padRight(
    `  Project: ${pc.bold(project.name)} (${project.status})`,
    innerWidth,
  );
  const taskParts: string[] = [];
  if (tasks.inProgress > 0)
    taskParts.push(pc.yellow(`${tasks.inProgress} in-progress`));
  if (tasks.backlog > 0) taskParts.push(pc.dim(`${tasks.backlog} backlog`));
  if (tasks.done > 0) taskParts.push(pc.green(`${tasks.done} done`));
  const taskLine = padRight(
    `  Tasks:   ${taskParts.join(" · ")}`,
    innerWidth,
  );

  console.log(topLine);
  console.log(`│${dirLine}│`);
  console.log(`│${projectLine}│`);
  console.log(`│${taskLine}│`);
  console.log(botLine);

  // Plans
  if (plans.length > 0) {
    console.log("");
    console.log("Plans:");
    for (const plan of plans) {
      const barWidth = 7;
      const filled =
        plan.totalNodes > 0
          ? Math.round((plan.doneNodes / plan.totalNodes) * barWidth)
          : 0;
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      const progress =
        plan.totalNodes > 0 ? `${plan.doneNodes}/${plan.totalNodes}` : "—";
      const isDone = plan.totalNodes > 0 && plan.doneNodes === plan.totalNodes;
      const doneFlag = isDone ? ` ${pc.green("✓ done")}` : "";
      const name = truncate(plan.name, 30);
      console.log(
        `  ▸ ${pc.bold(name.padEnd(30))} ${bar} ${progress.padEnd(5)}${doneFlag}`,
      );

      // Second line: node status counts + next ready task (only if diagram has nodes)
      if (plan.totalNodes > 0 && !isDone) {
        const counts: string[] = [];
        if (plan.doneNodes > 0) counts.push(pc.green(`✓${plan.doneNodes}`));
        if (plan.inProgressNodes > 0) counts.push(pc.yellow(`◉${plan.inProgressNodes}`));
        if (plan.blockedNodes > 0) counts.push(pc.red(`✗${plan.blockedNodes}`));
        if (plan.backlogNodes > 0) counts.push(pc.dim(`○${plan.backlogNodes}`));
        const next = plan.nextReady
          ? `  next: ${truncate(plan.nextReady, 25)}`
          : "";
        console.log(`    ${counts.join(" ")}${pc.dim(next)}`);
      }
    }
  }

  // Preview server
  console.log("");
  if (previewRunning) {
    console.log(
      `Preview: ${pc.green("●")} running → ${pc.cyan("http://localhost:4077")}`,
    );
  } else {
    console.log(
      `Preview: ${pc.dim("○")} stopped — run: ${pc.dim("spoc preview --open")}`,
    );
  }

  // Hints
  console.log("");
  console.log(pc.dim("Hints:"));
  console.log(pc.dim("  spoc diagram show <plan-id>    tree view"));
  console.log(pc.dim("  spoc preview --open            live browser"));
  console.log(pc.dim("  spoc task <slug>               list tasks"));
}

function padRight(str: string, width: number): string {
  // Strip ANSI for length calculation
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, "");
  const pad = Math.max(0, width - stripped.length);
  return str + " ".repeat(pad);
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + "…";
}
