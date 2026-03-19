import * as p from "@clack/prompts";
import color from "picocolors";
import {
  readConfig,
  writeConfig,
  configExists,
  AGENT_IDS,
  type SpocConfig,
  type AgentId,
} from "./config.js";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import {
  IDE_IDS,
  ideOption,
  ideConfigPath,
  ideHasSpoc,
  writeIdeConfig,
  displayPath,
  opencodeHasAgent,
  writeOpencodeAgent,
  type IdeId,
} from "./instructions.js";
import {
  detectOpencodeSuperpowersInstall,
  installBundledOpencodeSuperpowers,
} from "./opencode-superpowers.js";

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
  p.intro(color.bgCyan(color.black(isInit ? " SPOC setup " : " SPOC config ")));

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
          message: "Which IDE / tools will you use with SPOC?",
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
            ? AGENT_IDS.filter((id) => existing.agents[id]?.enabled)
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
  const config: SpocConfig = {
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

  // ── Write SPOC config ───────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Writing configuration…");
  writeConfig(config);
  s.stop("Configuration saved.");

  // ── Write MCP entries per IDE ───────────────────────────────────────────
  const results: string[] = [];

  for (const id of answers.ides) {
    const configFile = displayPath(ideConfigPath(id));
    const already = ideHasSpoc(id);

    if (already) {
      results.push(`${color.dim("⊘")} ${color.bold(IDE_MAP_LABEL[id])} — already configured in ${color.dim(configFile)}`);
      continue;
    }

    const shouldWrite = await p.confirm({
      message: `Write SPOC MCP entry to ${color.cyan(configFile)}?`,
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
  let opencodeAgentActive = false;

  if (selectedOpenCode && orchestrateEnabled) {
    const alreadyHasAgent = opencodeHasAgent();
    opencodeAgentActive = alreadyHasAgent;

    if (alreadyHasAgent) {
      p.note(
        `${color.dim("⊘")} OpenCode agent ${color.cyan("SPOC - (Orchestrator)")} already registered`,
        "OpenCode Agent"
      );
    } else {
      const shouldRegister = await p.confirm({
        message: `Register ${color.cyan("SPOC - (Orchestrator)")} as a primary agent in OpenCode? (Tab-switchable alongside Build/Plan)`,
        initialValue: true,
      });

      if (p.isCancel(shouldRegister)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (shouldRegister) {
        const agentResult = writeOpencodeAgent();
        opencodeAgentActive = true;
        const verb = agentResult.action === "created" ? "Created" : "Updated";
        p.note(
          [
            `${color.green("✔")} ${verb} agent entry in ${color.dim(displayPath(agentResult.configPath))}`,
            `${color.green("✔")} Wrote prompt to ${color.dim(displayPath(agentResult.promptPath))}`,
            "",
            `Switch to ${color.cyan("SPOC - (Orchestrator)")} with ${color.bold("Tab")} in OpenCode.`,
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

  if (selectedOpenCode && !orchestrateEnabled) {
    p.note(
      `${color.yellow("⊘")} Skipped bundled OpenCode Superpowers install because SPOC Orchestrator is disabled`,
      "OpenCode Superpowers"
    );
  }

  if (selectedOpenCode && orchestrateEnabled && !opencodeAgentActive) {
    p.note(
      `${color.yellow("⊘")} Skipped bundled OpenCode Superpowers install because the user declined SPOC Orchestrator registration`,
      "OpenCode Superpowers"
    );
  }

  if (selectedOpenCode && orchestrateEnabled && opencodeAgentActive) {
    const detection = detectOpencodeSuperpowersInstall();

    if (detection.state === "foreign-existing") {
      const shouldReplace = await p.confirm({
        message:
          "Replace the active OpenCode superpowers setup with the bundled SPOC-customized version? Future spoc config runs will keep it synced.",
        initialValue: true,
      });

      if (p.isCancel(shouldReplace)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (shouldReplace) {
        const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: true });
        p.note(result.summary, "OpenCode Superpowers");
      } else {
        p.note(
          `${color.yellow("⊘")} Skipped OpenCode bundled Superpowers install`,
          "OpenCode Superpowers"
        );
      }
    } else {
      const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: false });
      p.note(result.summary, "OpenCode Superpowers");
    }
  }

  // ── Print enabled slash commands ──────────────────────────────────────────
  const slashList = answers.agents
    .map((id) => `  /${AGENT_DEFINITIONS[id].promptName}`)
    .join("\n");
  p.note(slashList, "Enabled Slash Commands");

  p.outro(
    color.green("Done!") + " You can re-run this setup at any time with " + color.cyan("npm run init")
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
