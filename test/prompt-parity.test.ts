import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ORCHESTRATE_PROMPT_TEXT } from "../src/cli/spoc-orchestrate.js";
import { ORCHESTRATE_CAVEMAN_PROMPT_TEXT } from "../src/cli/spoc-orchestrate-caveman.js";

const STALE_MSG =
  "Prompt .txt is stale — run `node scripts/build-opencode-bundle.mjs` to regenerate";

const promptsDir = resolve(import.meta.dirname, "../opencode/spoc/prompts");

/**
 * The build script prepends an HTML-comment banner before the prompt text.
 * Strip it to get the canonical content for comparison.
 */
function stripBanner(content: string): string {
  return content.replace(/^<!--[\s\S]*?-->\n\n/, "");
}

describe("prompt parity — .txt mirrors TypeScript source", () => {
  it("spoc-orchestrate.txt matches ORCHESTRATE_PROMPT_TEXT", () => {
    const txtContent = readFileSync(resolve(promptsDir, "spoc-orchestrate.txt"), "utf-8");
    const body = stripBanner(txtContent);
    // Build script writes: banner + text + "\n"
    expect(body, STALE_MSG).toBe(`${ORCHESTRATE_PROMPT_TEXT}\n`);
  });

  it("spoc-orchestrate-caveman.txt matches ORCHESTRATE_CAVEMAN_PROMPT_TEXT", () => {
    const txtContent = readFileSync(resolve(promptsDir, "spoc-orchestrate-caveman.txt"), "utf-8");
    const body = stripBanner(txtContent);
    expect(body, STALE_MSG).toBe(`${ORCHESTRATE_CAVEMAN_PROMPT_TEXT}\n`);
  });
});
