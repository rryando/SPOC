import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KnowledgeProposal } from "./graphify.js";
import { getProjectDir } from "./paths.js";

interface KnowledgeMetaEntry {
  id: string;
  normalizedId: string;
  title: string;
  kind: string;
  keywords: string[];
  summary: string;
  sourceFiles?: Array<{ path: string; anchor?: string }>;
  file: string;
  createdAt: string;
  updatedAt: string;
}

interface KnowledgeIndex {
  entries: KnowledgeMetaEntry[];
}

function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function readJsonSafe<T>(filePath: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function persistProposals(
  slug: string,
  proposals: KnowledgeProposal[],
): Promise<{ created: number; skipped: number }> {
  const projectDir = getProjectDir(slug);
  const knowledgeDir = join(projectDir, "knowledge");
  await mkdir(knowledgeDir, { recursive: true });

  const indexPath = join(knowledgeDir, "index.json");
  const index: KnowledgeIndex = (await readJsonSafe<KnowledgeIndex>(indexPath)) ?? { entries: [] };

  const existingIds = new Set(index.entries.map((e) => e.id));

  let created = 0;
  let skipped = 0;

  for (const proposal of proposals) {
    const id = slugifyTitle(proposal.title);

    if (existingIds.has(id)) {
      skipped++;
      continue;
    }

    const ts = new Date().toISOString();
    const bodyFile = join("knowledge", `${id}.md`);

    const meta: KnowledgeMetaEntry = {
      id,
      normalizedId: id,
      title: proposal.title,
      kind: proposal.kind,
      keywords: proposal.keywords,
      summary: proposal.summary,
      sourceFiles: proposal.sourceFiles,
      file: bodyFile,
      createdAt: ts,
      updatedAt: ts,
    };

    await writeJson(join(knowledgeDir, `${id}.meta.json`), meta);
    await writeFile(
      join(knowledgeDir, `${id}.md`),
      `# ${proposal.title}\n\n${proposal.summary}\n`,
      "utf-8",
    );

    index.entries.push(meta);
    existingIds.add(id);
    created++;
  }

  await writeJson(indexPath, index);

  return { created, skipped };
}
