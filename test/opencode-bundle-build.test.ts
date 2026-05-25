import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const bundleRoot = resolve(root, "opencode/spoc");
const skillsRoot = resolve(bundleRoot, "skills");
const runtimeManifestPath = resolve(root, "opencode/spoc/bundle-runtime.json");

function expectRelativePathInBundle(relativePath: string, label: string) {
  const looksWindowsAbsolute = /^[A-Za-z]:[\\/]/.test(relativePath) || /^\\\\/.test(relativePath);

  expect(relativePath, `runtime path escapes bundle root: ${label}`).not.toBe("");
  expect(
    isAbsolute(relativePath) || looksWindowsAbsolute,
    `runtime path escapes bundle root: ${label}`,
  ).toBe(false);
  expect(
    relativePath.replace(/\\/g, "/"),
    `runtime path escapes bundle root: ${label}`,
  ).not.toMatch(/^\.\.(?:\/|$)/);
}

function expectBundledPath(targetPath: string, expectedRoot: string, label: string) {
  expectRelativePathInBundle(relative(expectedRoot, targetPath), label);
}

function writeRuntimeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

function runBundleBuild(env: NodeJS.ProcessEnv) {
  return spawnSync("node", [resolve(root, "scripts/build-opencode-bundle.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
  });
}

function expandHome(filePath: string) {
  if (filePath === "~") {
    return homedir();
  }

  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return resolve(homedir(), filePath.slice(2));
  }

  return filePath;
}

function listSourceSkillNames(sourceRoot: string) {
  // sourceRoot IS the skills root — skill dirs live directly inside it
  if (!existsSync(sourceRoot)) {
    return [];
  }

  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((skillName) => existsSync(resolve(sourceRoot, skillName, "SKILL.md")))
    .filter((skillName) => !SPOC_NATIVE_SKILL_NAMES.has(skillName))
    .sort();
}

// SPOC-native skills authored in this repo; they live in the bundle under skills/
// but are not declared in bundle-runtime.json and are not sourced from the upstream
// SPOC bundle install. Must stay in sync with preservedOutputFiles in
// scripts/build-opencode-bundle.mjs.
const SPOC_NATIVE_SKILL_NAMES = new Set(["loop", "caveman-commit", "caveman-review"]);

function listTopLevelAgentPaths(sourceRoot: string) {
  const sourceAgentsRoot = resolve(sourceRoot, "agents");

  if (!existsSync(sourceAgentsRoot)) {
    return [];
  }

  return readdirSync(sourceAgentsRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => `agents/${entry.name}`)
    .sort();
}

describe("opencode bundle builder", () => {
  it("copies only declared runtime files, preserves metadata, and deletes stale output files", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");

    try {
      const runtimeManifest = {
        sourceRoot,
        skills: {
          planner: ["SKILL.md", "notes.md"],
        },
        agents: ["agents/helper.md"],
        plugin: [".opencode/plugins/runtime.js"],
      };

      writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
      // sourceRoot IS the skills directory — write skill dirs directly into it
      writeRuntimeFile(sourceRoot, "planner/SKILL.md", "skill");
      writeRuntimeFile(sourceRoot, "planner/notes.md", "notes");
      writeRuntimeFile(sourceRoot, "planner/ignored.md", "ignore me");
      writeRuntimeFile(sourceRoot, "agents/helper.md", "agent");
      writeRuntimeFile(sourceRoot, ".opencode/plugins/runtime.js", "plugin");

      writeRuntimeFile(outputRoot, "manifest.json", "keep manifest");
      writeRuntimeFile(outputRoot, "bundle-runtime.json", "keep runtime manifest");
      writeRuntimeFile(outputRoot, "skills/planner/stale.md", "remove me");
      writeRuntimeFile(outputRoot, "skills/planner/ignored.md", "remove me too");
      writeRuntimeFile(outputRoot, "extra/nested.txt", "remove nested");

      const result = runBundleBuild({
        SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
        SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
        SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
      });

      expect(result.status).toBe(0);
      expect(readFileSync(resolve(outputRoot, "skills/planner/SKILL.md"), "utf-8")).toBe("skill");
      expect(readFileSync(resolve(outputRoot, "skills/planner/notes.md"), "utf-8")).toBe("notes");
      expect(readFileSync(resolve(outputRoot, "agents/helper.md"), "utf-8")).toBe("agent");
      expect(readFileSync(resolve(outputRoot, ".opencode/plugins/runtime.js"), "utf-8")).toBe(
        "plugin",
      );
      expect(existsSync(resolve(outputRoot, "skills/planner/ignored.md"))).toBe(false);
      expect(existsSync(resolve(outputRoot, "skills/planner/stale.md"))).toBe(false);
      expect(existsSync(resolve(outputRoot, "extra/nested.txt"))).toBe(false);
      expect(readFileSync(resolve(outputRoot, "manifest.json"), "utf-8")).toBe("keep manifest");
      expect(readFileSync(resolve(outputRoot, "bundle-runtime.json"), "utf-8")).toBe(
        "keep runtime manifest",
      );
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails loudly when a declared runtime file is missing", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-missing-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");

    try {
      const runtimeManifest = {
        sourceRoot,
        skills: {
          planner: ["SKILL.md", "missing.md"],
        },
        agents: [],
        plugin: [],
      };

      writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
      writeRuntimeFile(sourceRoot, "planner/SKILL.md", "skill");

      const result = runBundleBuild({
        SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
        SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
        SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Missing declared runtime file");
      expect(result.stderr).toContain("skills/planner/missing.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails when a source skill is missing from the runtime manifest", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-missing-skill-entry-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");

    try {
      const runtimeManifest = {
        sourceRoot,
        skills: {
          planner: ["SKILL.md"],
        },
        agents: [],
        plugin: [],
      };

      writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
      writeRuntimeFile(sourceRoot, "planner/SKILL.md", "planner");
      writeRuntimeFile(sourceRoot, "reviewer/SKILL.md", "reviewer");

      const result = runBundleBuild({
        SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
        SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
        SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Missing runtime manifest skill entry");
      expect(result.stderr).toContain("reviewer");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("fails when a source agent is missing from the runtime manifest", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-missing-agent-entry-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");

    try {
      const runtimeManifest = {
        sourceRoot,
        skills: {},
        agents: ["agents/helper.md"],
        plugin: [],
      };

      writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
      writeRuntimeFile(sourceRoot, "agents/helper.md", "helper");
      writeRuntimeFile(sourceRoot, "agents/reviewer.md", "reviewer");

      const result = runBundleBuild({
        SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
        SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
        SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Missing runtime manifest agent entry");
      expect(result.stderr).toContain("agents/reviewer.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects declared runtime paths that are absolute or escape the output root", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-invalid-path-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");
    const invalidPathCases = [
      {
        label: "posix escape",
        manifest: {
          sourceRoot,
          skills: {
            planner: ["../escape.md"],
          },
          agents: [],
          plugin: [],
        },
        expectedPath: "skills/planner/../escape.md",
      },
      {
        label: "absolute agent path",
        manifest: {
          sourceRoot,
          skills: {},
          agents: [resolve(tempRoot, "outside.md")],
          plugin: [],
        },
        expectedPath: resolve(tempRoot, "outside.md").replace(/\\/g, "/"),
      },
    ];

    try {
      for (const invalidPathCase of invalidPathCases) {
        writeFileSync(runtimeManifestPath, JSON.stringify(invalidPathCase.manifest, null, 2));

        const result = runBundleBuild({
          SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
          SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
          SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
        });

        expect(result.status, invalidPathCase.label).not.toBe(0);
        expect(result.stderr, invalidPathCase.label).toContain("Invalid declared runtime path");
        expect(result.stderr, invalidPathCase.label).toContain(invalidPathCase.expectedPath);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects skill namespace traversal that can target preserved root files", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-invalid-skill-name-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");
    const invalidPathCases = [
      {
        manifest: {
          sourceRoot,
          skills: {
            "../..": ["manifest.json"],
          },
          agents: [],
          plugin: [],
        },
        expectedPath: "skills/../../manifest.json",
      },
      {
        manifest: {
          sourceRoot,
          skills: {
            planner: ["../manifest.json"],
          },
          agents: [],
          plugin: [],
        },
        expectedPath: "skills/planner/../manifest.json",
      },
    ];

    try {
      for (const invalidPathCase of invalidPathCases) {
        writeFileSync(runtimeManifestPath, JSON.stringify(invalidPathCase.manifest, null, 2));

        const result = runBundleBuild({
          SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
          SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
          SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Invalid declared runtime path");
        expect(result.stderr).toContain(invalidPathCase.expectedPath);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects reserved path segments in agents and plugin entries", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-invalid-agent-plugin-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");
    const invalidPathCases = [
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: ["agents/../manifest.json"],
          plugin: [],
        },
        expectedPath: "agents/../manifest.json",
      },
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: [],
          plugin: [".opencode/plugins/../manifest.json"],
        },
        expectedPath: ".opencode/plugins/../manifest.json",
      },
    ];

    try {
      for (const invalidPathCase of invalidPathCases) {
        writeFileSync(runtimeManifestPath, JSON.stringify(invalidPathCase.manifest, null, 2));

        const result = runBundleBuild({
          SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
          SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
          SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Invalid declared runtime path");
        expect(result.stderr).toContain(invalidPathCase.expectedPath);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects agent and plugin entries outside their category roots", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-invalid-category-root-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");
    const invalidPathCases = [
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: ["manifest.json"],
          plugin: [],
        },
        expectedPath: "manifest.json",
      },
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: ["skills/foo/SKILL.md"],
          plugin: [],
        },
        expectedPath: "skills/foo/SKILL.md",
      },
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: [],
          plugin: ["manifest.json"],
        },
        expectedPath: "manifest.json",
      },
      {
        manifest: {
          sourceRoot,
          skills: {},
          agents: [],
          plugin: ["skills/foo/SKILL.md"],
        },
        expectedPath: "skills/foo/SKILL.md",
      },
    ];

    try {
      for (const invalidPathCase of invalidPathCases) {
        writeFileSync(runtimeManifestPath, JSON.stringify(invalidPathCase.manifest, null, 2));

        const result = runBundleBuild({
          SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
          SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
          SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
        });

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Invalid declared runtime path");
        expect(result.stderr).toContain(invalidPathCase.expectedPath);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("rejects nested agent entries outside the agents/*.md contract", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "opencode-bundle-build-nested-agent-"));
    const sourceRoot = resolve(tempRoot, "source");
    const outputRoot = resolve(tempRoot, "output");
    const runtimeManifestPath = resolve(tempRoot, "bundle-runtime.json");

    try {
      const runtimeManifest = {
        sourceRoot,
        skills: {},
        agents: ["agents/reviews/reviewer.md"],
        plugin: [],
      };

      writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
      writeRuntimeFile(sourceRoot, "agents/reviews/reviewer.md", "reviewer");

      const result = runBundleBuild({
        SPOC_BUNDLE_SOURCE_ROOT: sourceRoot,
        SPOC_BUNDLE_OUTPUT_ROOT: outputRoot,
        SPOC_BUNDLE_RUNTIME_MANIFEST: runtimeManifestPath,
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Invalid declared runtime path");
      expect(result.stderr).toContain("agents/reviews/reviewer.md");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

describe("opencode bundle runtime manifest", () => {
  it("ships the curated manifest shape for runtime bundling", () => {
    const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf-8"));

    expect(runtimeManifest).toEqual({
      sourceRoot: "~/.config/opencode/skills/spoc",
      skills: {
        aesthetic: ["SKILL.md", "CATALOG.md"],
        "architecture-review": ["SKILL.md"],
        "auditing-a-feature": ["SKILL.md"],
        brainstorming: [
          "SKILL.md",
          "spec-document-reviewer-prompt.md",
          "visual-companion.md",
          "scripts/frame-template.html",
          "scripts/helper.js",
          "scripts/server.js",
          "scripts/start-server.sh",
          "scripts/stop-server.sh",
        ],
        "code-agent": ["SKILL.md"],
        "dispatching-parallel-agents": ["SKILL.md"],
        "executing-plans": ["SKILL.md"],
        "finishing-a-development-branch": ["SKILL.md"],
        "knowledge-curation": ["SKILL.md"],
        "performance-diagnosis": ["SKILL.md"],
        "quick-dev": ["SKILL.md"],
        "receiving-code-review": ["SKILL.md"],
        "requesting-code-review": ["SKILL.md", "code-reviewer.md"],
        "spoc-dashboard": [
          "SKILL.md",
          "package.json",
          "server.js",
          "index.html",
          "start-server.sh",
          "stop-server.sh",
        ],
        "subagent-driven-development": [
          "SKILL.md",
          "code-quality-reviewer-prompt.md",
          "implementer-prompt.md",
          "spec-reviewer-prompt.md",
        ],
        "systematic-debugging": [
          "SKILL.md",
          "condition-based-waiting.md",
          "condition-based-waiting-example.ts",
          "defense-in-depth.md",
          "find-polluter.sh",
          "phases-reference.md",
          "root-cause-tracing.md",
        ],
        "test-driven-development": [
          "SKILL.md",
          "tdd-rationalizations-and-examples.md",
          "testing-anti-patterns.md",
        ],
        "to-diagram": ["SKILL.md", "scripts/manage-diagram.mjs"],
        "using-superpowers": ["SKILL.md"],
        "verification-before-completion": ["SKILL.md"],
        "writing-plans": ["SKILL.md", "plan-document-reviewer-prompt.md"],
        "writing-skills": [
          "SKILL.md",
          "anthropic-best-practices.md",
          "cso-and-naming.md",
          "graphviz-conventions.dot",
          "rationalization-hardening.md",
          "render-graphs.js",
          "skill-structure-reference.md",
          "testing-skills-with-subagents.md",
        ],
      },
      agents: [],
      plugin: [],
      excludePatterns: [
        "**/references/**",
        "**/examples/**",
        "**/CREATION-LOG.md",
        "**/test-pressure-*.md",
      ],
    });
  });

  it("lists only bundled files that exist in the tree", () => {
    const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf-8"));

    for (const [skillName, skillFiles] of Object.entries<string[]>(runtimeManifest.skills)) {
      for (const skillFile of skillFiles) {
        const skillPath = resolve(skillsRoot, skillName, skillFile);

        expectBundledPath(skillPath, resolve(skillsRoot, skillName), `${skillName}/${skillFile}`);
        expect(existsSync(skillPath), `missing skill runtime file: ${skillName}/${skillFile}`).toBe(
          true,
        );
      }
    }

    for (const agentFile of runtimeManifest.agents) {
      const agentPath = resolve(bundleRoot, agentFile);

      expectBundledPath(agentPath, bundleRoot, agentFile);
      expect(existsSync(agentPath), `missing runtime agent file: ${agentFile}`).toBe(true);
    }

    for (const pluginFile of runtimeManifest.plugin) {
      const pluginPath = resolve(bundleRoot, pluginFile);

      expectBundledPath(pluginPath, bundleRoot, pluginFile);
      expect(existsSync(pluginPath), `missing runtime plugin file: ${pluginFile}`).toBe(true);
    }
  });

  it("explicitly lists every upstream skill and top-level agent", () => {
    const runtimeManifest = JSON.parse(readFileSync(runtimeManifestPath, "utf-8"));
    const sourceRoot = resolve(
      dirname(runtimeManifestPath),
      expandHome(runtimeManifest.sourceRoot),
    );

    expect(Object.keys(runtimeManifest.skills).sort()).toEqual(listSourceSkillNames(skillsRoot));
    expect([...runtimeManifest.agents].sort()).toEqual(listTopLevelAgentPaths(sourceRoot));
  });

  it("rejects cross-platform path escapes before existence checks", () => {
    expect(() => expectRelativePathInBundle("../escape.txt", "posix escape")).toThrow();
    expect(() => expectRelativePathInBundle("..\\escape.txt", "windows escape")).toThrow();
    expect(() => expectRelativePathInBundle("C:\\escape.txt", "absolute windows path")).toThrow();
    expect(() => expectRelativePathInBundle("\\\\server\\share\\escape.txt", "unc path")).toThrow();
  });
});
