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
import { IDE_IDS, ideOption, printInstructions, type IdeId } from "./instructions.js";

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
      "init-project": { enabled: enabledAgents.has("init-project") },
      brainstorm: { enabled: enabledAgents.has("brainstorm") },
      execute: { enabled: enabledAgents.has("execute") },
      "sync-knowledge": { enabled: enabledAgents.has("sync-knowledge") },
    },
  };

  // ── Write config ──────────────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Writing configuration…");
  writeConfig(config);
  s.stop("Configuration saved.");

  // ── Print IDE instructions ────────────────────────────────────────────────
  const instructions = printInstructions(answers.ides);
  p.note(instructions, "MCP Configuration Instructions");

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
