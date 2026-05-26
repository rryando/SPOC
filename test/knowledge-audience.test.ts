import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { knowledgeMetaSchema } from "../src/utils/json-schemas.js";
import {
  createKnowledgeEntry,
  KNOWLEDGE_AUDIENCES,
  type KnowledgeMeta,
  readKnowledgeIndex,
  updateKnowledgeEntry,
} from "../src/utils/project-memory.js";

const tempDirs: string[] = [];

function makeProjectDir(): string {
  const dir = mkdtempSync(resolve(tmpdir(), "spoc-knowledge-audience-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("knowledge audience field", () => {
  it("KNOWLEDGE_AUDIENCES contains exactly 4 values", () => {
    expect(KNOWLEDGE_AUDIENCES).toHaveLength(4);
    expect(KNOWLEDGE_AUDIENCES).toEqual(["orchestrator", "implementer", "designer", "universal"]);
  });

  it("KnowledgeMeta without audience field is valid (backward compat)", () => {
    const meta: Omit<KnowledgeMeta, "audience"> = {
      id: "test",
      normalizedId: "test",
      title: "Test",
      kind: "lesson",
      keywords: ["test"],
      summary: "A test entry",
      file: "knowledge/test.md",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    // Should parse without audience (optional field)
    const result = knowledgeMetaSchema.safeParse(meta);
    expect(result.success).toBe(true);
  });

  it("KnowledgeMeta with audience='implementer' is valid", () => {
    const meta = {
      id: "test",
      normalizedId: "test",
      title: "Test",
      kind: "lesson",
      audience: "implementer",
      keywords: ["test"],
      summary: "A test entry",
      file: "knowledge/test.md",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const result = knowledgeMetaSchema.safeParse(meta);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audience).toBe("implementer");
    }
  });

  it("audience field is persisted and read back correctly", async () => {
    const projectDir = makeProjectDir();

    const entry = await createKnowledgeEntry(projectDir, {
      id: "audience-test",
      title: "Audience Test",
      kind: "pattern",
      audience: "designer",
      keywords: ["test"],
      summary: "Testing audience persistence",
    });

    expect(entry.audience).toBe("designer");

    // Read back from index
    const index = await readKnowledgeIndex(projectDir);
    const found = index.entries.find((e) => e.id === "audience-test");
    expect(found).toBeDefined();
    expect(found!.audience).toBe("designer");

    // Read back from meta.json file directly
    const metaPath = join(projectDir, "knowledge", "audience-test.meta.json");
    const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect(raw.audience).toBe("designer");
  });

  it("entry without audience does not have the field in persisted JSON", async () => {
    const projectDir = makeProjectDir();

    const entry = await createKnowledgeEntry(projectDir, {
      id: "no-audience",
      title: "No Audience",
      kind: "lesson",
      keywords: ["test"],
    });

    expect(entry.audience).toBeUndefined();

    const metaPath = join(projectDir, "knowledge", "no-audience.meta.json");
    const raw = JSON.parse(readFileSync(metaPath, "utf-8"));
    expect("audience" in raw).toBe(false);
  });

  it("audience can be updated via updateKnowledgeEntry", async () => {
    const projectDir = makeProjectDir();

    await createKnowledgeEntry(projectDir, {
      id: "update-audience",
      title: "Update Audience",
      kind: "gotcha",
      keywords: ["test"],
    });

    const updated = await updateKnowledgeEntry(projectDir, {
      id: "update-audience",
      audience: "orchestrator",
    });

    expect(updated.audience).toBe("orchestrator");

    const index = await readKnowledgeIndex(projectDir);
    const found = index.entries.find((e) => e.id === "update-audience");
    expect(found!.audience).toBe("orchestrator");
  });

  it("Zod schema accepts audience field", () => {
    const valid = knowledgeMetaSchema.safeParse({
      id: "x",
      normalizedId: "x",
      title: "X",
      kind: "pattern",
      audience: "universal",
      keywords: [],
      summary: "",
      file: "knowledge/x.md",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    });
    expect(valid.success).toBe(true);
  });
});
