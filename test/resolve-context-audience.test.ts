import { describe, expect, it, beforeEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readKnowledgeIndex, type KnowledgeMeta } from "../src/utils/project-memory.js";

/**
 * Tests for audience-based filtering in context assembly.
 *
 * The filtering logic applied in handleContext (dag-commands.ts) is:
 *   If audience is provided, include entries where:
 *     !entry.audience || entry.audience === audience || entry.audience === "universal"
 */

function filterByAudience(entries: KnowledgeMeta[], audience?: string): KnowledgeMeta[] {
  if (!audience) return entries;
  return entries.filter(
    (e) => !e.audience || e.audience === audience || e.audience === "universal",
  );
}

function makeProjectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "spoc-audience-test-"));
  mkdirSync(join(dir, "knowledge"), { recursive: true });
  return dir;
}

function makeKnowledgeEntry(overrides: Partial<KnowledgeMeta> & { id: string; title: string }): KnowledgeMeta {
  return {
    normalizedId: overrides.id,
    kind: "pattern",
    keywords: [],
    summary: "",
    file: `knowledge/${overrides.id}.md`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("audience filtering in context assembly", () => {
  let projectDir: string;
  let entries: KnowledgeMeta[];

  beforeEach(() => {
    projectDir = makeProjectDir();

    entries = [
      makeKnowledgeEntry({ id: "e1", title: "Entry 1", audience: "orchestrator" }),
      makeKnowledgeEntry({ id: "e2", title: "Entry 2", audience: "implementer" }),
      makeKnowledgeEntry({ id: "e3", title: "Entry 3", audience: "designer" }),
      makeKnowledgeEntry({ id: "e4", title: "Entry 4", audience: "universal" }),
      makeKnowledgeEntry({ id: "e5", title: "Entry 5" }), // no audience field
    ];

    // Write index to disk so readKnowledgeIndex works
    writeFileSync(
      join(projectDir, "knowledge", "index.json"),
      JSON.stringify({ entries }),
    );
    // Write .md files
    for (const e of entries) {
      writeFileSync(join(projectDir, e.file), `# ${e.title}\n`);
    }
  });

  it("without audience filter, all entries are returned", () => {
    const result = filterByAudience(entries, undefined);
    expect(result).toHaveLength(5);
  });

  it("with audience=orchestrator, returns orchestrator + universal + unset", () => {
    const result = filterByAudience(entries, "orchestrator");
    expect(result.map((e) => e.id).sort()).toEqual(["e1", "e4", "e5"]);
  });

  it("with audience=implementer, returns implementer + universal + unset", () => {
    const result = filterByAudience(entries, "implementer");
    expect(result.map((e) => e.id).sort()).toEqual(["e2", "e4", "e5"]);
  });

  it("entries with audience=designer are excluded when audience=implementer", () => {
    const result = filterByAudience(entries, "implementer");
    expect(result.find((e) => e.id === "e3")).toBeUndefined();
  });

  it("entries without audience field are always included", () => {
    for (const aud of ["orchestrator", "implementer", "designer"]) {
      const result = filterByAudience(entries, aud);
      expect(result.find((e) => e.id === "e5")).toBeDefined();
    }
  });

  it("readKnowledgeIndex returns entries with audience field preserved", async () => {
    // Write .meta.json files so the index isn't considered stale
    for (const e of entries) {
      const metaPath = join(projectDir, "knowledge", `${e.id}.meta.json`);
      writeFileSync(metaPath, JSON.stringify(e));
    }

    const index = await readKnowledgeIndex(projectDir);
    const orchestratorEntry = index.entries.find((e) => e.id === "e1");
    expect(orchestratorEntry?.audience).toBe("orchestrator");

    const noAudienceEntry = index.entries.find((e) => e.id === "e5");
    expect(noAudienceEntry?.audience).toBeUndefined();
  });
});
