import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { persistProposals } from "../src/utils/graphify-knowledge.js";
import type { KnowledgeProposal } from "../src/utils/graphify.js";

function makeProposal(title: string, kind: KnowledgeProposal["kind"] = "architecture"): KnowledgeProposal {
  return {
    title,
    kind,
    summary: `Summary for ${title}`,
    keywords: ["test"],
    sourceFiles: [{ path: "src/foo.ts" }],
  };
}

function setupProjectDir(dataDir: string, slug: string): string {
  const projectDir = resolve(dataDir, "projects", slug);
  const knowledgeDir = resolve(projectDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(resolve(knowledgeDir, "index.json"), JSON.stringify({ entries: [] }), "utf-8");
  return projectDir;
}

describe("persistProposals", () => {
  it("returns { created: 0, skipped: 0 } for empty proposals", async () => {
    await withTempDataDir(async (dir) => {
      setupProjectDir(dir, "myproject");
      const result = await persistProposals("myproject", []);
      expect(result).toEqual({ created: 0, skipped: 0 });
    });
  });

  it("creates knowledge entries from proposals", async () => {
    await withTempDataDir(async (dir) => {
      setupProjectDir(dir, "myproject");
      const proposals = [makeProposal("God Node Analysis")];
      const result = await persistProposals("myproject", proposals);

      expect(result).toEqual({ created: 1, skipped: 0 });

      const knowledgeDir = resolve(dir, "projects", "myproject", "knowledge");
      const index = JSON.parse(await readFile(resolve(knowledgeDir, "index.json"), "utf-8"));
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0].id).toBe("god-node-analysis");
      expect(index.entries[0].title).toBe("God Node Analysis");
      expect(index.entries[0].kind).toBe("architecture");
      expect(index.entries[0].keywords).toEqual(["test"]);
      expect(index.entries[0].summary).toBe("Summary for God Node Analysis");
      expect(index.entries[0].sourceFiles).toEqual([{ path: "src/foo.ts" }]);

      const meta = JSON.parse(await readFile(resolve(knowledgeDir, "god-node-analysis.meta.json"), "utf-8"));
      expect(meta.id).toBe("god-node-analysis");
      expect(meta.title).toBe("God Node Analysis");

      const body = await readFile(resolve(knowledgeDir, "god-node-analysis.md"), "utf-8");
      expect(body).toContain("God Node Analysis");
      expect(body).toContain("Summary for God Node Analysis");
    });
  });

  it("skips duplicates by derived ID", async () => {
    await withTempDataDir(async (dir) => {
      setupProjectDir(dir, "myproject");

      // First call creates
      await persistProposals("myproject", [makeProposal("Existing Entry")]);
      // Second call with same title skips
      const result = await persistProposals("myproject", [makeProposal("Existing Entry")]);

      expect(result).toEqual({ created: 0, skipped: 1 });

      const knowledgeDir = resolve(dir, "projects", "myproject", "knowledge");
      const index = JSON.parse(await readFile(resolve(knowledgeDir, "index.json"), "utf-8"));
      expect(index.entries).toHaveLength(1);
    });
  });

  it("handles multiple proposals with mixed create and skip", async () => {
    await withTempDataDir(async (dir) => {
      setupProjectDir(dir, "myproject");

      // Create one first
      await persistProposals("myproject", [makeProposal("Already There")]);

      // Now pass 3: one duplicate, two new
      const result = await persistProposals("myproject", [
        makeProposal("Already There"),
        makeProposal("New Module", "module"),
        makeProposal("New Pattern", "pattern"),
      ]);

      expect(result).toEqual({ created: 2, skipped: 1 });

      const knowledgeDir = resolve(dir, "projects", "myproject", "knowledge");
      const index = JSON.parse(await readFile(resolve(knowledgeDir, "index.json"), "utf-8"));
      expect(index.entries).toHaveLength(3);
    });
  });
});
