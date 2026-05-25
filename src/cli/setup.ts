import * as p from "@clack/prompts";
import color from "picocolors";
import {
  configExists,
  extractModelPreFills,
  type ModelTierConfig,
  readConfig,
  readOpenCodeConfig,
  type SpocConfig,
  writeConfig,
} from "./config.js";
import {
  applyAgentModelConfig,
  displayPath,
  opencodeHasAgent,
  writeOpencodeAgent,
} from "./instructions.js";
import {
  detectSpocBundleInstall,
  installSpocBundle,
} from "./bundle-installer.js";

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

  // ── Model configuration ───────────────────────────────────────────────────
  const openCodeConfig = await readOpenCodeConfig();
  const preFills = extractModelPreFills(openCodeConfig);

  if (openCodeConfig) {
    p.note(
      `Found models:\n  model: ${preFills.heavy || "(not set)"}\n  small_model: ${preFills.light || "(not set)"}`,
      "OpenCode Config",
    );
  } else {
    p.note(
      "No opencode config found at ~/.config/opencode/opencode.json\nEnter model identifiers manually below.",
      "OpenCode Config",
    );
  }

  const heavyModel = await p.text({
    message: "Heavy model (reasoning, synthesis)",
    placeholder: "e.g. github-copilot/claude-opus-4.6",
    initialValue: preFills.heavy,
  });

  if (p.isCancel(heavyModel)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  p.note(
    "Used by: software-engineer, docs-researcher, spoc-docs, oncall-ops, system-architect, plan, general",
    "Heavy tier agents",
  );

  const standardModel = await p.text({
    message: "Standard model (general purpose)",
    placeholder: "e.g. github-copilot/claude-sonnet-4.6",
    initialValue: preFills.standard,
  });

  if (p.isCancel(standardModel)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  p.note("Used by: build, SPOC Orchestrator, SPOC Caveman", "Standard tier agents");

  const lightModel = await p.text({
    message: "Light/fast model (read-only, exploration)",
    placeholder: "e.g. github-copilot/claude-haiku-4.5",
    initialValue: preFills.light,
  });

  if (p.isCancel(lightModel)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  p.note("Used by: explore, code-reviewer, tech-architect, qa-analyst", "Light tier agents");

  // T004 will wire modelConfig into agent registration calls below.
  const modelConfig: ModelTierConfig = {
    heavy: heavyModel as string,
    standard: standardModel as string,
    light: lightModel as string,
  };

  // Step 3.5e — Optional per-agent customization
  const customizeAgents = await p.confirm({
    message: "Customize model for individual agents?",
    initialValue: false,
  });

  if (p.isCancel(customizeAgents)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  if (customizeAgents) {
    // Agent tier mapping for display
    const agentTiers: Array<{ name: string; tier: "heavy" | "standard" | "light" }> = [
      { name: "software-engineer", tier: "heavy" },
      { name: "docs-researcher", tier: "heavy" },
      { name: "spoc-docs", tier: "heavy" },
      { name: "oncall-ops", tier: "heavy" },
      { name: "system-architect", tier: "heavy" },
      { name: "plan", tier: "heavy" },
      { name: "general", tier: "heavy" },
      { name: "build", tier: "standard" },
      { name: "explore", tier: "light" },
      { name: "code-reviewer", tier: "light" },
      { name: "tech-architect", tier: "light" },
      { name: "qa-analyst", tier: "light" },
    ];

    p.note(
      "Press Enter to keep the tier default. Type a model ID to override.",
      "Per-Agent Customization",
    );

    const perAgent: Record<string, string> = {};

    for (const agent of agentTiers) {
      const tierModel = modelConfig[agent.tier];
      const override = await p.text({
        message: `${agent.name} [${agent.tier}: ${tierModel}]`,
        placeholder: "Enter to keep default",
        initialValue: "",
      });

      if (p.isCancel(override)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (override && (override as string).trim() !== "") {
        perAgent[agent.name] = (override as string).trim();
      }
    }

    if (Object.keys(perAgent).length > 0) {
      modelConfig.perAgent = perAgent;
    }
  }

  // ── Build config ──────────────────────────────────────────────────────────
  const config: SpocConfig = {
    version: "1",
    ides: ["opencode"],
  };

  // ── Write SPOC config ───────────────────────────────────────────────────
  const s = p.spinner();
  s.start("Writing configuration…");
  writeConfig(config);
  s.stop("Configuration saved.");

  // ── Register OpenCode agent (orchestrate always enabled) ──────────────────
  const selectedOpenCode = true;
  const orchestrateEnabled = true;
  let opencodeAgentActive = false;

  if (selectedOpenCode && orchestrateEnabled) {
    const alreadyHasAgent = opencodeHasAgent();
    opencodeAgentActive = alreadyHasAgent;

    if (alreadyHasAgent) {
      // Already registered — re-apply silently to keep the entry and prompt up to date
      const agentResult = writeOpencodeAgent(modelConfig);
      opencodeAgentActive = true;
      p.note(
        [
          `${color.green("✔")} Updated agent entries in ${color.dim(displayPath(agentResult.configPath))}`,
          `${color.green("✔")} Refreshed orchestrator prompt at ${color.dim(displayPath(agentResult.promptPath))}`,
          `${color.green("✔")} Refreshed Caveman prompt at ${color.dim(displayPath(agentResult.cavemanPromptPath))}`,
        ].join("\n"),
        "OpenCode Agent",
      );
    } else {
      const shouldRegister = await p.confirm({
        message: `Register ${color.cyan("SPOC - (Orchestrator)")} and ${color.cyan("SPOC - Caveman")} as primary agents in OpenCode? (Tab-switchable alongside Build/Plan)`,
        initialValue: true,
      });

      if (p.isCancel(shouldRegister)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (shouldRegister) {
        const agentResult = writeOpencodeAgent(modelConfig);
        opencodeAgentActive = true;
        const verb = agentResult.action === "created" ? "Created" : "Updated";
        p.note(
          [
            `${color.green("✔")} ${verb} agent entries in ${color.dim(displayPath(agentResult.configPath))}`,
            `${color.green("✔")} Wrote orchestrator prompt to ${color.dim(displayPath(agentResult.promptPath))}`,
            `${color.green("✔")} Wrote Caveman prompt to ${color.dim(displayPath(agentResult.cavemanPromptPath))}`,
            "",
            `Switch to ${color.cyan("SPOC - (Orchestrator)")} or ${color.cyan("SPOC - Caveman")} with ${color.bold("Tab")} in OpenCode.`,
            `${color.dim("Caveman = same capabilities, ~65% fewer output tokens.")}`,
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
      `${color.yellow("⊘")} Skipped bundled OpenCode SPOC Bundle install because the user declined SPOC Orchestrator registration`,
      "OpenCode SPOC Bundle",
    );
  }

  if (selectedOpenCode && orchestrateEnabled && opencodeAgentActive) {
    const detection = detectSpocBundleInstall();

    if (detection.state === "foreign-existing") {
      const shouldReplace = await p.confirm({
        message:
          "Replace the active OpenCode SPOC bundle setup with the bundled SPOC-customized version? Future spoc config runs will keep it synced.",
        initialValue: true,
      });

      if (p.isCancel(shouldReplace)) {
        p.cancel("Setup cancelled.");
        process.exit(0);
      }

      if (shouldReplace) {
        const result = installSpocBundle({ autoConfirmReplacement: true });
        p.note(result.summary, "OpenCode SPOC Bundle");
      } else {
        p.note(
          `${color.yellow("⊘")} Skipped OpenCode bundled SPOC Bundle install`,
          "OpenCode SPOC Bundle",
        );
      }
    } else {
      const result = installSpocBundle({ autoConfirmReplacement: false });
      p.note(result.summary, "OpenCode SPOC Bundle");
    }
  }

  // ── Apply model config to all agent entries ────────────────────────────────
  // Runs after bundle install to overwrite hardcoded manifest models
  // with the user's configured tier values.
  if (selectedOpenCode && opencodeAgentActive) {
    applyAgentModelConfig(modelConfig);
  }

  p.outro(
    color.green("Done!") +
      " You can re-run this setup at any time with " +
      color.cyan("npm run init"),
  );
}
