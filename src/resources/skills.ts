import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PACKAGE_ROOT } from "../utils/paths.js";

const SKILLS_DIR = resolve(PACKAGE_ROOT, "skills");

interface SkillFrontmatter {
  name: string;
  description: string;
}

/**
 * Parse YAML frontmatter from a skill markdown file.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatter: { name: "unknown", description: "" },
      body: content,
    };
  }

  const yamlBlock = match[1];
  const body = match[2];

  const nameMatch = yamlBlock.match(/^name:\s*(.+)$/m);
  const descMatch = yamlBlock.match(/^description:\s*(.+)$/m);

  return {
    frontmatter: {
      name: nameMatch?.[1]?.trim() ?? "unknown",
      description: descMatch?.[1]?.trim() ?? "",
    },
    body,
  };
}

/**
 * List all skill files in the skills directory.
 */
function listSkills(): Array<{ name: string; description: string; filename: string }> {
  try {
    const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
    return files.map((f) => {
      const content = readFileSync(resolve(SKILLS_DIR, f), "utf-8");
      const { frontmatter } = parseFrontmatter(content);
      return {
        name: frontmatter.name,
        description: frontmatter.description,
        filename: f,
      };
    });
  } catch {
    return [];
  }
}

export function registerSkillResources(server: McpServer) {
  // Static: list all skills
  server.resource(
    "skills-list",
    "spoc://skills",
    {
      description: "List of available agent skills for this MCP server",
      mimeType: "application/json",
    },
    async (uri) => {
      const skills = listSkills();
      const list = skills.map(({ name, description }) => ({ name, description }));
      return {
        contents: [
          { uri: uri.href, text: JSON.stringify(list, null, 2), mimeType: "application/json" },
        ],
      };
    },
  );

  // Template: individual skill
  server.resource(
    "skill-detail",
    new ResourceTemplate("spoc://skills/{name}", { list: undefined }),
    { description: "Full skill instructions (markdown)", mimeType: "text/markdown" },
    async (uri, variables) => {
      const skillName = variables.name as string;
      const skills = listSkills();
      const skill = skills.find((s) => s.name === skillName || s.filename === `${skillName}.md`);

      if (!skill) {
        throw new Error(
          `Skill "${skillName}" not found. Available: ${skills.map((s) => s.name).join(", ")}`,
        );
      }

      const content = readFileSync(resolve(SKILLS_DIR, skill.filename), "utf-8");
      return {
        contents: [{ uri: uri.href, text: content, mimeType: "text/markdown" }],
      };
    },
  );
}
