// ---------------------------------------------------------------------------
// Command Registry — foundational type system and registry for CLI commands
// ---------------------------------------------------------------------------

export type ParamType = "string" | "number" | "boolean";

export interface ParamDef {
  type: ParamType;
  required?: boolean;
  positional?: number;
  default?: unknown;
  description: string;
  enum?: string[];
}

export type CLIResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string; hint?: string; usage?: string; param?: string };

export interface CommandFlags {
  json: boolean;
  lean: boolean;
  dryRun: boolean;
}

export interface CommandDef {
  path: string;
  description: string;
  params: Record<string, ParamDef>;
  handler: (params: Record<string, unknown>, flags: CommandFlags) => Promise<CLIResult>;
}

export const ERROR_CODES = {
  MISSING_PARAM: "missing_param",
  INVALID_TYPE: "invalid_type",
  INVALID_ENUM: "invalid_enum",
  UNKNOWN_FLAG: "unknown_flag",
  UNKNOWN_COMMAND: "unknown_command",
  TOKEN_EXPIRED: "token_expired",
  TOKEN_CONSUMED: "token_consumed",
  TOKEN_MISMATCH: "token_mismatch",
  PROJECT_NOT_FOUND: "project_not_found",
  ENTITY_NOT_FOUND: "entity_not_found",
} as const;

// ---------------------------------------------------------------------------
// Registry internals
// ---------------------------------------------------------------------------

const commands = new Map<string, CommandDef>();

export function defineCommand(def: CommandDef): void {
  if (!def.path || def.path.trim().length === 0) {
    throw new Error("Command path must be non-empty");
  }
  if (commands.has(def.path)) {
    throw new Error(`Duplicate command path: "${def.path}"`);
  }
  commands.set(def.path, def);
}

export function getCommand(path: string): CommandDef | undefined {
  return commands.get(path);
}

export function listCommands(): CommandDef[] {
  return [...commands.values()];
}

export function suggestCommand(input: string): string | undefined {
  let best: string | undefined;
  let bestDist = 4; // threshold: distance must be <= 3
  for (const path of commands.keys()) {
    const d = levenshtein(input, path);
    if (d < bestDist) {
      bestDist = d;
      best = path;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Levenshtein distance (simple DP implementation)
// ---------------------------------------------------------------------------

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0) as number[]);
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
