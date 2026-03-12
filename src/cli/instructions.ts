import color from "picocolors";

// ---------------------------------------------------------------------------
// IDE MCP Configuration Instructions
// ---------------------------------------------------------------------------

export type IdeId = "vscode" | "copilot-cli" | "claude-code" | "opencode";

interface IdeInfo {
  label: string;
  hint: string;
  instructions: string;
}

const IDE_MAP: Record<IdeId, IdeInfo> = {
  vscode: {
    label: "VS Code (Copilot)",
    hint: "GitHub Copilot MCP in VS Code",
    instructions: `Add to your VS Code ${color.bold("settings.json")} (${color.dim("Cmd+Shift+P → Preferences: Open User Settings (JSON)")}):

${color.cyan(`"mcp": {
  "servers": {
    "cc-dag": {
      "command": "npx",
      "args": ["cc-dag"]
    }
  }
}`)}`,
  },

  "copilot-cli": {
    label: "GitHub Copilot CLI",
    hint: "gh copilot with MCP support",
    instructions: `Add to ${color.bold("~/.config/github-copilot/mcp.json")}:

${color.cyan(`{
  "mcpServers": {
    "cc-dag": {
      "command": "npx",
      "args": ["cc-dag"]
    }
  }
}`)}`,
  },

  "claude-code": {
    label: "Claude Code",
    hint: "Anthropic Claude Code CLI",
    instructions: `Run:

  ${color.cyan("claude mcp add cc-dag -- npx cc-dag")}

Or add to ${color.bold("~/.claude/claude_desktop_config.json")}:

${color.cyan(`{
  "mcpServers": {
    "cc-dag": {
      "command": "npx",
      "args": ["cc-dag"]
    }
  }
}`)}`,
  },

  opencode: {
    label: "OpenCode",
    hint: "OhMyOpenCode editor",
    instructions: `Add to your project's ${color.bold(".opencode/mcp.yaml")} or ${color.bold("~/.opencode/mcp.yaml")}:

${color.cyan(`mcpServers:
  cc-dag:
    command: npx
    args:
      - cc-dag`)}`,
  },
};

export const IDE_IDS: IdeId[] = ["vscode", "copilot-cli", "claude-code", "opencode"];

/**
 * Returns the multiselect option for a given IDE id.
 */
export function ideOption(id: IdeId): { value: IdeId; label: string; hint: string } {
  const info = IDE_MAP[id];
  return { value: id, label: info.label, hint: info.hint };
}

/**
 * Prints the MCP configuration instructions for the given IDEs.
 */
export function printInstructions(ides: IdeId[]): string {
  const sections = ides.map((id) => {
    const info = IDE_MAP[id];
    return `${color.bold(color.underline(info.label))}\n\n${info.instructions}`;
  });
  return sections.join("\n\n" + color.dim("─".repeat(60)) + "\n\n");
}
