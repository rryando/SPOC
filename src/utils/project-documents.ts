/**
 * Shared constants for the structured project document model.
 */

export const PROJECT_DOC_FILES = {
  overview: "overview.md",
  tasks: "tasks.md",
  dependencies: "dependencies.md",
  knowledge: "knowledge.md",
} as const;

export type ProjectDocType = keyof typeof PROJECT_DOC_FILES;

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  status: string;
  repoUrl?: string;
  createdAt: string;
  workspacePaths: string[];
}
