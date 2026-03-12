import * as p from "@clack/prompts";
import color from "picocolors";
import {
  readConfig,
  writeConfig,
  configExists,
  AGENT_IDS,
  type CcDagConfig,
  type AgentId,
} from "./config.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import {
  IDE_IDS,
  ideOption,
  ideConfigPath,
  ideHasCcDag,
  writeIdeConfig,
  displayPath,
  opencodeHasAgent,
  writeOpencodeAgent,
  type IdeId,
} from "./instructions.js";

// ---------------------------------------------------------------------------
// TUI Wizard
// ---------------------------------------------------------------------------

/**
 * Runs the interactive setup wizard.
 * @param mode "init" for first-time setup, "config" for reconfiguration.
 */
export async function runSetup(mode: "init" | "config"): Promise<void> {
  const isInit = mode === "init";
  const existing = configExists() ? readConfig() : null;

  console.clear();
  p.intro(color.bgCyan(color.black(isInit ? " cc-dag setup " : " cc-dag config ")));

  if (isInit && existing) {
    const overwrite = await p.confirm({
      message: "An existing configuration was found. Overwrite it?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Setup cancelled. Existing config preserved.");
      process.exit(0);
    }
  }

  // ── Group wizard ──────────────────────────────────────────────────────────
  const answers = await p.group(
    {
      // Step 1: IDE / tool selection
      ides: () =>
        p.multiselect<IdeId>({
          message: "Which IDE / tools will you use with cc-dag?",
          options: IDE_IDS.map(ideOption),
          initialValues: existing?.ides as IdeId[] | undefined,
          required: true,
        }),

      // Step 2: Agent enablement
      agents: () =>
        p.multiselect<AgentId>({
          message: "Which agents (slash commands) do you want enabled?",
          options: AGENT_IDS.map((id) => ({
            value: id,
            label: AGENT_DEFINITIONS[id].name,
            hint: AGENT_DEFINITIONS[id].hint,
          })),
          initialValues: existing
            ? AGENT_IDS.filter((id) => existing.agents[id].enabled)
            : AGENT_IDS, // all enabled by default
          required: true,
        }),

      // Step 3: Confirm
      confirmed: ({ results }) =>
        p.confirm({
          message: `Save config? (${(results.ides as IdeId[])?.length ?? 0} IDEs, ${(results.agents as AgentId[])?.length ?? 0} agents)`,
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Setup cancelled.");
        process.exit(0);
      },
    }
  );

  if (!answers.confirmed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // ── Build config ──────────────────────────────────────────────────────────
  const enabledAgents = new Set<string>(answers.agents);
  const config: CcDagConfig = {
    version: "1",
    ides: answers.ides,
    agents: {
      orchestrate: { enabled: enabledAgents.has("orchestrate") },
      "init-project": { enabled: enabledAgents.has("init-project") },
      brainstorm: { enabled: enabledAgents.has("brainstorm") },
      execute: { enabled: enabledAgents.has("execute") },
      "sync-knowledge": { enabled: enabledAgents.has("sync-knowledge") },
    },
  };

  // ── Write cc-dag config ─────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Writing configuration…");
  writeConfig(config);
  s.stop("Configuration saved.");

  // ── Write MCP entries per IDE ───────────────────────────────────────────
  const results: string[] = [];

  for (const id of answers.ides) {
    const configFile = displayPath(ideConfigPath(id));
    const already = ideHasCcDag(id);

    if (already) {
      results.push(`${color.dim("⊘")} ${color.bold(IDE_MAP_LABEL[id])} — already configured in ${color.dim(configFile)}`);
      continue;
    }

    const shouldWrite = await p.confirm({
      message: `Write cc-dag MCP entry to ${color.cyan(configFile)}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldWrite)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (shouldWrite) {
      const result = writeIdeConfig(id);
      const verb = result.action === "created" ? "Created" : "Updated";
      results.push(`${color.green("✔")} ${color.bold(IDE_MAP_LABEL[id])} — ${verb} ${color.dim(configFile)}`);
    } else {
      results.push(`${color.yellow("⊘")} ${color.bold(IDE_MAP_LABEL[id])} — skipped`);
    }
  }

  if (results.length > 0) {
    p.note(results.join("\n"), "MCP Configuration");
  }

  // ── Register OpenCode agent (if OpenCode selected + orchestrate enabled) ──
  const selectedOpenCode = answers.ides.includes("opencode");
  const orchestrateEnabled = enabledAgents.has("orchestrate");

  if (selectedOpenCode && orchestrateEnabled) {
    const alreadyHasAgent = opencodeHasAgent();

    if (alreadyHasAgent) {
      p.note(
        `${color.dim("⊘")} cc-dag orchestrator agent already registered in OpenCode`,
        "OpenCode Agent"
      );
    } else {
      const shouldRegister = await p.confirm({
        message: `Register ${color.cyan("cc-dag")} as a primary agent in OpenCode? (Tab-switchable alongside Build/Plan)`,
        initialValue: true,
      });

      if (p.isCancel(shouldRegister)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (shouldRegister) {
        const agentResult = writeOpencodeAgent();
        const verb = agentResult.action === "created" ? "Created" : "Updated";
        p.note(
          [
            `${color.green("✔")} ${verb} agent entry in ${color.dim(displayPath(agentResult.configPath))}`,
            `${color.green("✔")} Wrote prompt to ${color.dim(displayPath(agentResult.promptPath))}`,
            "",
            `Switch to the ${color.cyan("cc-dag")} agent with ${color.bold("Tab")} in OpenCode.`,
          ].join("\n"),
          "OpenCode Agent"
        );
      } else {
        p.note(
          `${color.yellow("⊘")} Skipped OpenCode agent registration`,
          "OpenCode Agent"
        );
      }
    }
  }

  // ── Print enabled slash commands ──────────────────────────────────────────
  const slashList = answers.agents
    .map((id) => `  /${AGENT_DEFINITIONS[id].promptName}`)
    .join("\n");
  p.note(slashList, "Enabled Slash Commands");

  p.outro(
    color.green("Done!") +
      " Run " +
      color.cyan("npx cc-dag") +
      " to start the MCP server."
  );
}

// ---------------------------------------------------------------------------
// Label lookup (avoids importing full IdeInfo)
// ---------------------------------------------------------------------------
const IDE_MAP_LABEL: Record<IdeId, string> = {
  vscode: "VS Code (Copilot)",
  "copilot-cli": "GitHub Copilot CLI",
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};
