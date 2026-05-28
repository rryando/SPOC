import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const buildScriptPath = resolve(root, "scripts/build-opencode-bundle.mjs");
const bundlePruningTestPath = resolve(root, "test/opencode-bundle-pruning.test.ts");
const installerTestPath = resolve(root, "test/opencode-bundle-installer.test.ts");

/**
 * Extract skill file entries (e.g. "skills/loop/SKILL.md") from the
 * preservedOutputFiles set in the build script. This is the source of truth.
 */
function extractPreservedSkillFiles(source: string): string[] {
  const matches = [...source.matchAll(/"(skills\/[^"]+\/SKILL\.md)"/g)];
  return matches.map((m) => m[1]).sort();
}

/**
 * Extract string literals from `const arcsNativeSkillFiles = [...]`.
 */
function extractArcsNativeSkillFiles(source: string): string[] {
  const arrayMatch = source.match(/const\s+arcsNativeSkillFiles\s*=\s*\[([^\]]*)\]/s);
  if (!arrayMatch) {
    throw new Error("Could not find arcsNativeSkillFiles in source");
  }
  const matches = [...arrayMatch[1].matchAll(/"([^"]+)"/g)];
  return matches.map((m) => m[1]).sort();
}

describe("ARCS-native skill parity across sync points", () => {
  const buildSource = readFileSync(buildScriptPath, "utf-8");
  const preservedSkillFiles = extractPreservedSkillFiles(buildSource);

  it("keeps arcsNativeSkillFiles in opencode-bundle-pruning.test.ts aligned with preservedOutputFiles", () => {
    const testSource = readFileSync(bundlePruningTestPath, "utf-8");
    const files = extractArcsNativeSkillFiles(testSource);

    expect(
      files,
      [
        "arcsNativeSkillFiles in test/opencode-bundle-pruning.test.ts is out of sync",
        `with preservedOutputFiles in scripts/build-opencode-bundle.mjs.`,
        `Expected: ${JSON.stringify(preservedSkillFiles)}`,
        `Got:      ${JSON.stringify(files)}`,
      ].join("\n"),
    ).toEqual(preservedSkillFiles);
  });

  it("keeps arcsNativeSkillFiles in opencode-bundle-installer.test.ts aligned with preservedOutputFiles", () => {
    const testSource = readFileSync(installerTestPath, "utf-8");

    // Verify the constant exists with the expected name
    const hasConstant = /const\s+arcsNativeSkillFiles\s*=/.test(testSource);
    expect(
      hasConstant,
      [
        "Could not find `const arcsNativeSkillFiles` in test/opencode-bundle-installer.test.ts.",
        "If it was renamed, update this parity test accordingly.",
      ].join("\n"),
    ).toBe(true);

    const files = extractArcsNativeSkillFiles(testSource);

    expect(
      files,
      [
        "arcsNativeSkillFiles in test/opencode-bundle-installer.test.ts is out of sync",
        `with preservedOutputFiles in scripts/build-opencode-bundle.mjs.`,
        `Expected: ${JSON.stringify(preservedSkillFiles)}`,
        `Got:      ${JSON.stringify(files)}`,
      ].join("\n"),
    ).toEqual(preservedSkillFiles);
  });

  it("has every ARCS-native skill present on disk", () => {
    for (const skillFile of preservedSkillFiles) {
      const diskPath = resolve(root, "opencode/arcs", skillFile);
      expect(
        existsSync(diskPath),
        [`ARCS-native skill file missing on disk: ${skillFile}`, `Expected at: ${diskPath}`].join(
          "\n",
        ),
      ).toBe(true);
    }
  });
});
