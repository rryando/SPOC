import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PACKAGE_ROOT } from "./paths.js";

/**
 * Renders a mustache-style template by replacing {{variable}} placeholders.
 * NOTE: Template reading remains synchronous — templates are local package
 * assets read once during `arcs project init`, not on the hot path.
 */
export function renderTemplate(templatePath: string, variables: Record<string, string>): string {
  const template = readFileSync(templatePath, "utf-8");
  return renderString(template, variables);
}

/**
 * Renders a template string with {{variable}} substitution.
 */
export function renderString(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return variables[key] ?? match;
  });
}

/**
 * Resolves a template path relative to the package's templates/ dir.
 */
export function getTemplatePath(templateName: string): string {
  return resolve(PACKAGE_ROOT, "templates", templateName);
}
