/**
 * Shared content extraction helpers for assembling project context.
 * Used by both `arcs context` and `arcs sync-agents-md` commands.
 */

/**
 * Extract meaningful overview content from overview.md, stripping template boilerplate.
 * Returns null if the overview is still the default template (no real content).
 *
 * Strips: leading H1, blockquote, status/repo blocks, then checks if remaining
 * content is just empty section headers.
 *
 * NOTE: Coupled to the template format in project.md.tmpl. Guarded by
 * test/content-assembly.test.ts — edits to the template or this function
 * must preserve the null/non-null contract on unmodified vs. populated
 * renders, or that test will fail.
 */
export function extractOverviewContent(raw: string): string | null {
  const lines = raw.split("\n");
  let startIdx = 0;

  // Skip leading H1
  if (lines[startIdx]?.startsWith("# ")) startIdx++;
  // Skip blank lines after H1
  while (startIdx < lines.length && lines[startIdx]?.trim() === "") startIdx++;
  // Skip blockquote
  if (lines[startIdx]?.startsWith("> ")) startIdx++;
  // Skip blank lines after blockquote
  while (startIdx < lines.length && lines[startIdx]?.trim() === "") startIdx++;
  // Skip status/repo blocks
  while (
    startIdx < lines.length &&
    (lines[startIdx]?.startsWith("**Status:**") ||
      lines[startIdx]?.startsWith("**Repo:**") ||
      lines[startIdx]?.trim() === "")
  ) {
    startIdx++;
  }

  const remaining = lines.slice(startIdx).join("\n").trim();

  // Check if it's just empty section headers with no content beneath them
  const withoutHeaders = remaining.replace(/^##\s+.+$/gm, "").trim();

  if (withoutHeaders === "") return null;
  return remaining;
}

/**
 * Extract in-progress task lines (matching `- [/]` pattern) in file order.
 */
export function extractInProgressTasks(raw: string): string[] {
  return raw.split("\n").filter((line) => /^- \[\/\]/.test(line.trim()));
}

/**
 * Extract backlog task lines (matching `- [ ]` pattern) in file order.
 */
export function extractBacklogTasks(raw: string): string[] {
  return raw.split("\n").filter((line) => /^- \[ \]/.test(line.trim()));
}

/**
 * Remove leading markdown checkbox syntax from a task line.
 */
export function stripTaskCheckbox(line: string): string {
  return line.replace(/^- \[[ x/]\]\s*/, "").trim();
}

/**
 * Extract meaningful dependencies content from dependencies.md, stripping template boilerplate.
 * Returns null if the content is still the default template.
 *
 * Strips leading H1 (`# Dependencies — {name}`). Downgrades `## Upstream` /
 * `## Downstream` to `###` so they nest correctly under the `## Dependencies`
 * header in assembled documents. Returns null if the only non-blank content
 * under each header is `- None yet` / `- None` or nothing.
 *
 * NOTE: Coupled to the template format in dependency.md.tmpl. Guarded by
 * test/content-assembly.test.ts — edits to the template or this function
 * must preserve the null/non-null contract, or that test will fail.
 */
export function extractDependenciesContent(raw: string): string | null {
  const lines = raw.split("\n");
  let startIdx = 0;

  // Skip leading H1
  if (lines[startIdx]?.startsWith("# ")) startIdx++;
  // Skip blank lines after H1
  while (startIdx < lines.length && lines[startIdx]?.trim() === "") startIdx++;

  const remaining = lines.slice(startIdx).join("\n").trim();

  if (remaining === "") return null;

  // Check if it's just empty template: only headers and "- None yet" / "- None" lines
  const withoutHeaders = remaining.replace(/^##\s+.+$/gm, "").trim();
  const withoutNoneYet = withoutHeaders
    .split("\n")
    .filter(
      (line) => line.trim() !== "" && line.trim() !== "- None yet" && line.trim() !== "- None",
    )
    .join("")
    .trim();

  if (withoutNoneYet === "") return null;

  // Downgrade ## Upstream / ## Downstream to ### for embedding under ## Dependencies
  return remaining.replace(/^## (Upstream|Downstream)/gm, "### $1");
}
