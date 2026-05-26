/**
 * SPOC plugin for OpenCode.ai
 *
 * Injects SPOC bootstrap context via system prompt transform.
 * Skills are discovered via OpenCode's native skill tool from symlinked directory.
 */

import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOOP_STATE_FILE = "loop-state.json";
const COMPLETION_TAG_PATTERN = /<promise>(.*?)<\/promise>/is;
const DEFAULT_COMPLETION_PROMISE = "DONE";

// Simple frontmatter extraction (avoid dependency on skills-core for bootstrap)
const extractAndStripFrontmatter = (content) => {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, content };

  const frontmatterStr = match[1];
  const body = match[2];
  const frontmatter = {};

  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line
        .slice(colonIdx + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      frontmatter[key] = value;
    }
  }

  return { frontmatter, content: body };
};

// Normalize a path: trim whitespace, expand ~, resolve to absolute
const normalizePath = (p, homeDir) => {
  if (!p || typeof p !== "string") return null;
  let normalized = p.trim();
  if (!normalized) return null;
  if (normalized.startsWith("~/")) {
    normalized = path.join(homeDir, normalized.slice(2));
  } else if (normalized === "~") {
    normalized = homeDir;
  }
  return path.resolve(normalized);
};

// Get SPOC data dir (matches src/utils/paths.ts logic)
const getSpocDataDir = () => {
  const envDir = process.env.SPOC_DATA_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), ".spoc");
};



// Read loop state from a project directory
const readLoopState = (projectDir) => {
  const stateFile = path.join(projectDir, LOOP_STATE_FILE);
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
};

// Write loop state
const writeLoopState = (projectDir, state) => {
  const stateFile = path.join(projectDir, LOOP_STATE_FILE);
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n", "utf-8");
};

// Clear loop state
const clearLoopState = (projectDir) => {
  const stateFile = path.join(projectDir, LOOP_STATE_FILE);
  try {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    return true;
  } catch {
    return false;
  }
};

// Find active loop across all SPOC projects
const findActiveLoop = () => {
  const dataDir = getSpocDataDir();
  const metaPath = path.join(dataDir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;

  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    if (!meta.projects) return null;

    for (const project of meta.projects) {
      const projectDir = path.join(dataDir, "projects", project.id);
      const state = readLoopState(projectDir);
      if (state && state.active) {
        return { slug: project.id, projectDir, state };
      }
    }
  } catch {}
  return null;
};

// Build continuation prompt based on strategy
const buildContinuationPrompt = (state) => {
  const maxLabel =
    typeof state.maxIterations === "number" ? String(state.maxIterations) : "unbounded";

  if (state.strategy === "reset") {
    return `[SYSTEM DIRECTIVE - SPOC LOOP ITERATION ${state.iteration}/${maxLabel}]

Start fresh on the following task. Previous attempts did not complete successfully.

IMPORTANT:
- Do NOT rely on previous context or partial work
- Approach the task from scratch with a clean perspective
- When FULLY complete, output: <promise>${state.completionPromise}</promise>
- Do not stop until the task is truly done

Task:
${state.prompt}`;
  }

  return `[SYSTEM DIRECTIVE - SPOC LOOP ITERATION ${state.iteration}/${maxLabel}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off
- When FULLY complete, output: <promise>${state.completionPromise}</promise>
- Do not stop until the task is truly done

Original task:
${state.prompt}`;
};

export const SpocPlugin = async ({ client, directory }) => {
  const inFlightSessions = new Set();
  const homeDir = os.homedir();
  const spocSkillsDir = path.resolve(__dirname, "../skills/spoc");
  const envConfigDir = normalizePath(process.env.OPENCODE_CONFIG_DIR, homeDir);
  const configDir = envConfigDir || path.join(homeDir, ".config/opencode");

  // Cache bootstrap content at plugin load (file doesn't change during session)
  const cachedBootstrap = (() => {
    const skillPath = path.join(spocSkillsDir, "using-superpowers", "SKILL.md");
    if (!fs.existsSync(skillPath)) return null;

    const fullContent = fs.readFileSync(skillPath, "utf8");
    const { content } = extractAndStripFrontmatter(fullContent);

    const toolMapping = `**Tool Mapping for OpenCode:**
When skills reference tools you don't have, substitute OpenCode equivalents:
- \`TodoWrite\` → \`todowrite\`
- \`Task\` tool with subagents → Use OpenCode's subagent system (@mention)
- \`Skill\` tool → OpenCode's native \`skill\` tool
- \`Read\`, \`Write\`, \`Edit\`, \`Bash\` → Your native tools

**Skills location:**
SPOC skills are in \`${configDir}/skills/spoc/\`
Use OpenCode's native \`skill\` tool to list and load skills.`;

    return `<EXTREMELY_IMPORTANT>
You have SPOC skills loaded.

**IMPORTANT: The using-superpowers skill content is included below. It is ALREADY LOADED - you are currently following it. Do NOT use the skill tool to load "using-superpowers" again - that would be redundant.**

${content}

${toolMapping}
</EXTREMELY_IMPORTANT>`;
  })();

  return {
    // Use system prompt transform to inject bootstrap (fixes #226 agent reset bug)
    "experimental.chat.system.transform": async (_input, output) => {
      if (cachedBootstrap) {
        (output.system ||= []).push(cachedBootstrap);
      }

      // Inject the workspace directory so SPOC and other agents always know
      // which project directory OpenCode was opened in. This is the reliable
      // source of truth — process.cwd() of MCP servers may differ.
      if (directory) {
        (output.system ||= []).push(`<env>\n  Working directory: ${directory}\n</env>`);
      }


    },

    event: async ({ event, client }) => {
      const props = event.properties;

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID;
        if (!sessionID) return;
        if (inFlightSessions.has(sessionID)) return;

        inFlightSessions.add(sessionID);
        try {
          const loop = findActiveLoop();
          if (!loop || !loop.state.active) return;

          const { state, projectDir } = loop;

          // Only handle the loop's session
          if (state.sessionId && state.sessionId !== sessionID) return;

          // Detect completion in session messages
          let completionDetected = false;
          try {
            const response = await client.session.messages({
              path: { id: sessionID },
              query: { directory },
            });

            const messages = Array.isArray(response)
              ? response
              : response?.data && Array.isArray(response.data)
                ? response.data
                : [];

            const scopedMessages =
              typeof state.messageCountAtStart === "number"
                ? messages.slice(state.messageCountAtStart)
                : messages;

            const assistantMsgs = scopedMessages.filter((m) => m.info?.role === "assistant");
            const pattern = new RegExp(
              `<promise>\\s*${state.completionPromise.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</promise>`,
              "is",
            );

            for (let i = assistantMsgs.length - 1; i >= 0; i--) {
              const parts = assistantMsgs[i].parts || [];
              for (const part of parts) {
                if (part.type === "text" && part.text && pattern.test(part.text)) {
                  completionDetected = true;
                  break;
                }
              }
              if (completionDetected) break;
            }
          } catch {}

          if (completionDetected) {
            clearLoopState(projectDir);
            await client.tui
              ?.showToast?.({
                body: {
                  title: "SPOC Loop Complete!",
                  message: `Task completed after ${state.iteration} iteration(s)`,
                  variant: "success",
                  duration: 5000,
                },
              })
              .catch(() => {});
            return;
          }

          // Check max iterations
          if (typeof state.maxIterations === "number" && state.iteration >= state.maxIterations) {
            clearLoopState(projectDir);
            await client.tui
              ?.showToast?.({
                body: {
                  title: "SPOC Loop Stopped",
                  message: `Max iterations (${state.maxIterations}) reached without completion`,
                  variant: "warning",
                  duration: 5000,
                },
              })
              .catch(() => {});
            return;
          }

          // Increment iteration
          state.iteration += 1;
          writeLoopState(projectDir, state);

          // Show toast
          await client.tui
            ?.showToast?.({
              body: {
                title: "SPOC Loop",
                message: `Iteration ${state.iteration}/${typeof state.maxIterations === "number" ? state.maxIterations : "unbounded"}`,
                variant: "info",
                duration: 2000,
              },
            })
            .catch(() => {});

          // Inject continuation prompt
          const continuationPrompt = buildContinuationPrompt(state);

          // Inherit agent/model from last message
          let agent, model, tools;
          try {
            const msgs = await client.session.messages({ path: { id: sessionID } });
            const messageList = Array.isArray(msgs) ? msgs : msgs?.data || [];
            for (let i = messageList.length - 1; i >= 0; i--) {
              const info = messageList[i]?.info;
              if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
                agent = info.agent;
                model =
                  info.model ??
                  (info.providerID && info.modelID
                    ? { providerID: info.providerID, modelID: info.modelID }
                    : undefined);
                tools = info.tools;
                break;
              }
            }
          } catch {}

          await client.session.promptAsync({
            path: { id: sessionID },
            body: {
              ...(agent !== undefined ? { agent } : {}),
              ...(model ? { model: { providerID: model.providerID, modelID: model.modelID } } : {}),
              ...(model?.variant ? { variant: model.variant } : {}),
              ...(tools ? { tools } : {}),
              parts: [{ type: "text", text: continuationPrompt }],
            },
            query: { directory },
          });
        } finally {
          inFlightSessions.delete(sessionID);
        }
      }

      // Handle session deletion — clear loop if it's the loop session
      if (event.type === "session.deleted") {
        const sessionID = props?.sessionID;
        if (!sessionID) return;
        const loop = findActiveLoop();
        if (loop && loop.state.sessionId === sessionID) {
          clearLoopState(loop.projectDir);
        }
      }

      // Handle session error — clear loop
      if (event.type === "session.error") {
        const sessionID = props?.sessionID;
        if (!sessionID) return;
        const loop = findActiveLoop();
        if (loop && loop.state.sessionId === sessionID) {
          clearLoopState(loop.projectDir);
        }
      }
    },
  };
};
