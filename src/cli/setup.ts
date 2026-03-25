import * as p from "@clack/prompts";
import color from "picocolors";
import { AGENT_DEFINITIONS } from "../agents/definitions.js";
import { AGENT_IDS, configExists, readConfig, type SpocConfig, writeConfig } from "./config.js";
import {
  displayPath,
  type IdeId,
  ideConfigPath,
  ideHasSpoc,
  opencodeHasAgent,
  writeIdeConfig,
  writeOpencodeAgent,
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

  // ── Single upfront confirm ─────────────────────────────────────────────────
  const proceed = await p.confirm({
    message: isInit
      ? "Set up SPOC for OpenCode with all agents enabled?"
      : "Re-configure SPOC for OpenCode?",
    initialValue: true,
  });

  if (p.isCancel(proceed) || !proceed) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // ── Build config ──────────────────────────────────────────────────────────
  const config: SpocConfig = {
    version: "1",
    ides: ["opencode"],
    agents: {
      orchestrate: { enabled: true },
      "init-project": { enabled: true },
      brainstorm: { enabled: true },
      execute: { enabled: true },
      "sync-knowledge": { enabled: true },
    },
  };

  // ── Write SPOC config ───────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Writing configuration…");
  writeConfig(config);
  s.stop("Configuration saved.");

  // ── Write MCP entry for OpenCode ───────────────────────────────────────
  const opencodeId = "opencode" as IdeId;
  const configFile = displayPath(ideConfigPath(opencodeId));
  const already = ideHasSpoc(opencodeId);
  const results: string[] = [];

  if (already) {
    // Already configured — re-apply silently to keep the entry up to date
    const result = writeIdeConfig(opencodeId);
    const verb = result.action === "created" ? "Created" : "Updated";
    results.push(
      `${color.green("✔")} ${color.bold("OpenCode")} — ${verb} ${color.dim(configFile)}`,
    );
  } else {
    const shouldWrite = await p.confirm({
      message: `Write SPOC MCP entry to ${color.cyan(configFile)}?`,
      initialValue: true,
    });

    if (p.isCancel(shouldWrite)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (shouldWrite) {
      const result = writeIdeConfig(opencodeId);
      const verb = result.action === "created" ? "Created" : "Updated";
      results.push(
        `${color.green("✔")} ${color.bold("OpenCode")} — ${verb} ${color.dim(configFile)}`,
      );
    } else {
      results.push(`${color.yellow("⊘")} ${color.bold("OpenCode")} — skipped`);
    }
  }

  if (results.length > 0) {
    p.note(results.join("\n"), "MCP Configuration");
  }

  // ── Register OpenCode agent (orchestrate always enabled) ──────────────────
  const selectedOpenCode = true;
  const orchestrateEnabled = true;
  let opencodeAgentActive = false;

  if (selectedOpenCode && orchestrateEnabled) {
    const alreadyHasAgent = opencodeHasAgent();
    opencodeAgentActive = alreadyHasAgent;

    if (alreadyHasAgent) {
      // Already registered — re-apply silently to keep the entry and prompt up to date
      const agentResult = writeOpencodeAgent();
      opencodeAgentActive = true;
      p.note(
        [
          `${color.green("✔")} Updated agent entry in ${color.dim(displayPath(agentResult.configPath))}`,
          `${color.green("✔")} Refreshed prompt at ${color.dim(displayPath(agentResult.promptPath))}`,
        ].join("\n"),
        "OpenCode Agent",
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
          "OpenCode Agent",
        );
      } else {
        p.note(`${color.yellow("⊘")} Skipped OpenCode agent registration`, "OpenCode Agent");
      }
    }
  }

  if (selectedOpenCode && orchestrateEnabled && !opencodeAgentActive) {
    p.note(
      `${color.yellow("⊘")} Skipped bundled OpenCode Superpowers install because the user declined SPOC Orchestrator registration`,
      "OpenCode Superpowers",
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
          "OpenCode Superpowers",
        );
      }
    } else {
      const result = installBundledOpencodeSuperpowers({ autoConfirmReplacement: false });
      p.note(result.summary, "OpenCode Superpowers");
    }
  }

  // ── Print enabled slash commands ──────────────────────────────────────────
  const slashList = AGENT_IDS.map((id) => `  /${AGENT_DEFINITIONS[id].promptName}`).join("\n");
  p.note(slashList, "Enabled Slash Commands");

  p.outro(
    color.green("Done!") +
      " You can re-run this setup at any time with " +
      color.cyan("npm run init"),
  );
}
