/**
 * Path-segment-aware workspace matching for project context resolution.
 */

/**
 * Normalize a workspace path: strip trailing slashes (preserving root "/").
 */
export function normalizeWorkspacePath(p: string): string {
  if (p === "/") return p;
  return p.replace(/\/+$/, "");
}

/**
 * Check if `queryPath` is inside (or equal to) `storedPath`.
 * Uses path-segment-aware comparison to prevent "/Users/ryan" matching "/Users/ryan.ryn".
 */
export function matchWorkspace(queryPath: string, storedPath: string): boolean {
  const q = normalizeWorkspacePath(queryPath);
  const s = normalizeWorkspacePath(storedPath);
  return q === s || q.startsWith(`${s}/`);
}

export interface WorkspaceProject {
  slug: string;
  workspacePaths: string[];
}

/** Discriminated union result for findBestMatch. */
export type FindMatchResult =
  | { kind: "match"; slug: string; matchedPath: string }
  | { kind: "none" }
  | { kind: "ambiguous"; slugs: string[] };

/**
 * Find the best matching project for a query path.
 * Returns the project with the longest matching workspace path (most specific).
 * Returns { kind: "none" } if no match, { kind: "ambiguous", slugs } if multiple
 * projects match at the same prefix length.
 */
export function findBestMatch(queryPath: string, projects: WorkspaceProject[]): FindMatchResult {
  let bestLength = -1;
  let bestSlug: string | null = null;
  let bestPath: string | null = null;
  let ambiguousSlugs: string[] = [];

  for (const project of projects) {
    for (const wp of project.workspacePaths) {
      if (matchWorkspace(queryPath, wp)) {
        const normalized = normalizeWorkspacePath(wp);
        if (normalized.length > bestLength) {
          bestLength = normalized.length;
          bestSlug = project.slug;
          bestPath = normalized;
          ambiguousSlugs = [project.slug];
        } else if (normalized.length === bestLength && project.slug !== bestSlug) {
          if (!ambiguousSlugs.includes(project.slug)) {
            ambiguousSlugs.push(project.slug);
          }
        }
      }
    }
  }

  if (bestSlug === null || bestPath === null) {
    return { kind: "none" };
  }

  if (ambiguousSlugs.length > 1) {
    return { kind: "ambiguous", slugs: ambiguousSlugs };
  }

  return { kind: "match", slug: bestSlug, matchedPath: bestPath };
}
