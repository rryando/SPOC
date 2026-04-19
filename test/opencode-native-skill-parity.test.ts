import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const buildScriptPath = resolve(root, "scripts/build-opencode-superpowers-bundle.mjs");
const bundleBuildTestPath = resolve(root, "test/opencode-bundle-build.test.ts");
const bundlePruningTestPath = resolve(root, "test/opencode-bundle-pruning.test.ts");
const installerTestPath = resolve(root, "test/opencode-superpowers-installer.test.ts");

/**
 * Extract skill file entries (e.g. "skills/loop/SKILL.md") from the
 * preservedOutputFiles set in the build script. This is the source of truth.
 */
function extractPreservedSkillFiles(source: string): string[] {
  const matches = [...source.matchAll(/"(skills\/[^"]+\/SKILL\.md)"/g)];
  return matches.map((m) => m[1]).sort();
}

/**
 * Extract skill names from `const SPOC_NATIVE_SKILL_NAMES = new Set([...])`.
 */
function extractSpocNativeSkillNames(source: string): string[] {
  const setMatch = source.match(
    /const\s+SPOC_NATIVE_SKILL_NAMES\s*=\s*new\s+Set\(\[([^\]]*)\]\)/s,
  );
  if (!setMatch) {
    throw new Error("Could not find SPOC_NATIVE_SKILL_NAMES in source");
  }
  const matches = [...setMatch[1].matchAll(/"([^"]+)"/g)];
  return matches.map((m) => m[1]).sort();
}

/**
 * Extract string literals from `const spocNativeSkillFiles = [...]`.
 */
function extractSpocNativeSkillFiles(source: string): string[] {
  const arrayMatch = source.match(
    /const\s+spocNativeSkillFiles\s*=\s*\[([^\]]*)\]/s,
  );
  if (!arrayMatch) {
    throw new Error("Could not find spocNativeSkillFiles in source");
  }
  const matches = [...arrayMatch[1].matchAll(/"([^"]+)"/g)];
  return matches.map((m) => m[1]).sort();
}

/**
 * Derive skill names from skill file paths: "skills/foo/SKILL.md" → "foo".
 */
function skillFileToName(skillFile: string): string {
  return skillFile.split("/")[1];
}

describe("SPOC-native skill parity across sync points", () => {
  const buildSource = readFileSync(buildScriptPath, "utf-8");
  const preservedSkillFiles = extractPreservedSkillFiles(buildSource);
  const preservedSkillNames = preservedSkillFiles.map(skillFileToName).sort();

  it("keeps SPOC_NATIVE_SKILL_NAMES in opencode-bundle-build.test.ts aligned with preservedOutputFiles", () => {
    const testSource = readFileSync(bundleBuildTestPath, "utf-8");
    const names = extractSpocNativeSkillNames(testSource);

    expect(names, [
      "SPOC_NATIVE_SKILL_NAMES in test/opencode-bundle-build.test.ts is out of sync",
      `with preservedOutputFiles in scripts/build-opencode-superpowers-bundle.mjs.`,
      `Expected: ${JSON.stringify(preservedSkillNames)}`,
      `Got:      ${JSON.stringify(names)}`,
    ].join("\n")).toEqual(preservedSkillNames);
  });

  it("keeps spocNativeSkillFiles in opencode-bundle-pruning.test.ts aligned with preservedOutputFiles", () => {
    const testSource = readFileSync(bundlePruningTestPath, "utf-8");
    const files = extractSpocNativeSkillFiles(testSource);

    expect(files, [
      "spocNativeSkillFiles in test/opencode-bundle-pruning.test.ts is out of sync",
      `with preservedOutputFiles in scripts/build-opencode-superpowers-bundle.mjs.`,
      `Expected: ${JSON.stringify(preservedSkillFiles)}`,
      `Got:      ${JSON.stringify(files)}`,
    ].join("\n")).toEqual(preservedSkillFiles);
  });

  it("keeps spocNativeSkillFiles in opencode-superpowers-installer.test.ts aligned with preservedOutputFiles", () => {
    const testSource = readFileSync(installerTestPath, "utf-8");

    // Verify the constant exists with the expected name
    const hasConstant = /const\s+spocNativeSkillFiles\s*=/.test(testSource);
    expect(hasConstant, [
      "Could not find `const spocNativeSkillFiles` in test/opencode-superpowers-installer.test.ts.",
      "If it was renamed, update this parity test accordingly.",
    ].join("\n")).toBe(true);

    const files = extractSpocNativeSkillFiles(testSource);

    expect(files, [
      "spocNativeSkillFiles in test/opencode-superpowers-installer.test.ts is out of sync",
      `with preservedOutputFiles in scripts/build-opencode-superpowers-bundle.mjs.`,
      `Expected: ${JSON.stringify(preservedSkillFiles)}`,
      `Got:      ${JSON.stringify(files)}`,
    ].join("\n")).toEqual(preservedSkillFiles);
  });

  it("has every SPOC-native skill present on disk", () => {
    for (const skillFile of preservedSkillFiles) {
      const diskPath = resolve(root, "opencode/superpowers", skillFile);
      expect(existsSync(diskPath), [
        `SPOC-native skill file missing on disk: ${skillFile}`,
        `Expected at: ${diskPath}`,
      ].join("\n")).toBe(true);
    }
  });
});
