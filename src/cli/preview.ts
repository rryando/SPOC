import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createPreviewServer, type PreviewServer } from "../preview/server.js";
import { getProjectDir } from "../utils/paths.js";

export interface PreviewCliOptions {
  project?: string;
  port?: number;
  open?: boolean;
}

function parsePreviewArgs(args: string[]): PreviewCliOptions {
  const opts: PreviewCliOptions = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--project" && args[i + 1]) {
      opts.project = args[++i];
    } else if (args[i] === "--port" && args[i + 1]) {
      opts.port = Number.parseInt(args[++i], 10);
    } else if (args[i] === "--open") {
      opts.open = true;
    }
  }
  return opts;
}

function resolveProjectPlansDir(slug: string): string | null {
  const projectDir = getProjectDir(slug);
  const metaPath = resolve(projectDir, "meta.json");
  if (!existsSync(metaPath)) return null;

  // Plans always live in the DAG project directory
  const plansDir = resolve(projectDir, "plans");
  return existsSync(plansDir) ? plansDir : null;
}

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} ${url}`);
}

/**
 * Handle `spoc preview` CLI command.
 * Returns true if handled.
 */
export async function handlePreviewCli(args: string[]): Promise<boolean> {
  const opts = parsePreviewArgs(args);

  if (!opts.project) {
    console.error("Usage: spoc preview --project <slug> [--port <port>] [--open]");
    process.exit(1);
  }

  const plansDir = resolveProjectPlansDir(opts.project);
  if (!plansDir) {
    console.error(`Could not find plans directory for project "${opts.project}".`);
    process.exit(1);
  }

  let server: PreviewServer;
  try {
    server = await createPreviewServer({
      plansDir,
      host: "127.0.0.1",
      port: opts.port ?? 3000,
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const url = `http://127.0.0.1:${server.port}`;
  console.log(`Preview running at ${url}`);

  if (opts.open) {
    await openBrowser(url);
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await server.close();
    process.exit(0);
  });

  return true;
}
