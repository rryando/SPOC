/**
 * Convert a project name to a URL-safe slug.
 * "My Cool Project" → "my-cool-project"
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
