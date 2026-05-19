/**
 * Lifecycle integration tests proving cross-tool behavior:
 * 1. Write-gate: propose → token → applied write
 * 2. Task transition → plan state → diagram state
 * 3. Bundle lint → deploy flow in temp config directories
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearWriteProposals,
  createWriteProposal,
  disableWriteGateBypass,
  enableWriteGateBypass,
} from "../src/utils/write-gate.js";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function parseResult(result: unknown): any {
  return JSON.parse(
    (result as any).content.find((c: any) => c.type === "text").text,
  );
}

function writeFile(rootPath: string, relativePath: string, content: string) {
  const outputPath = resolve(rootPath, relativePath);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, content);
}

// =============================================================================
// Flow 1: Write-gate propose → confirm token → applied write
// =============================================================================
describe("lifecycle: write-gate propose → apply → gated write", () => {
  afterEach(() => {
    clearWriteProposals();
    enableWriteGateBypass();
  });

  it("full propose_dag_write → apply_dag_write → update_project_doc flow", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        // Setup project with bypass on
        await invokeJsonTool(server, "init_project", {
          name: "Write Gate Flow",
          description: "E2E write gate test",
        });

        // Disable bypass — now writes require tokens
        disableWriteGateBypass();

        // Step 1: propose a write via the MCP tool
        const proposal = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "write-gate-flow",
            summary: "Update overview doc",
            operations: ["tool:update_project_doc"],
            ttlMs: 60_000,
          }),
        );

        expect(proposal.token).toBeDefined();
        expect(proposal.slug).toBe("write-gate-flow");
        expect(proposal.expiresAt).toBeDefined();
        expect(proposal.consumedAt).toBeNull();

        // Step 2: apply the write token via MCP tool
        const applied = parseResult(
          await invokeJsonTool(server, "apply_dag_write", {
            token: proposal.token,
            slug: "write-gate-flow",
          }),
        );

        expect(applied.consumed).toBe(true);
        expect(applied.operations).toContain("tool:update_project_doc");

        // Step 3: now the gated write should succeed (bypass still disabled,
        // but token was consumed — the tool needs a fresh token per call)
        // Re-propose for the actual doc update
        const proposal2 = createWriteProposal({
          slug: "write-gate-flow",
          summary: "Update overview",
          operations: ["tool:update_project_doc"],
          ttlMs: 60_000,
        });

        await invokeJsonTool(server, "update_project_doc", {
          slug: "write-gate-flow",
          doc: "overview",
          content: "# Updated Overview\nIntegration test content.",
          confirmationToken: proposal2.token,
        });

        // Verify doc was actually written
        enableWriteGateBypass();
        const docResult = await invokeJsonTool(server, "get_project", {
          slug: "write-gate-flow",
          doc: "overview",
        });
        const docText = (docResult as any).content.find((c: any) => c.type === "text").text;
        expect(docText).toContain("Updated Overview");
      } finally {
        enableWriteGateBypass();
        await server.close();
      }
    });
  });

  it("rejects reuse of consumed token", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Token Reuse",
          description: "Test consumed token rejection",
        });

        disableWriteGateBypass();

        const proposal = parseResult(
          await invokeJsonTool(server, "propose_dag_write", {
            slug: "token-reuse",
            summary: "Test reuse",
            operations: ["tool:update_project_doc"],
            ttlMs: 60_000,
          }),
        );

        // First apply succeeds
        await invokeJsonTool(server, "apply_dag_write", {
          token: proposal.token,
          slug: "token-reuse",
        });

        // Second apply with same token fails
        await expect(
          invokeJsonTool(server, "apply_dag_write", {
            token: proposal.token,
            slug: "token-reuse",
          }),
        ).rejects.toThrow(/already consumed/i);
      } finally {
        enableWriteGateBypass();
        await server.close();
      }
    });
  });
});

// =============================================================================
// Flow 2: Task transition → plan auto-done → diagram class update
// =============================================================================
describe("lifecycle: task transition → plan state → diagram state", () => {
  it("completing all plan tasks transitions plan to done and updates diagram", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        // Setup project + plan + tasks + diagram
        await invokeJsonTool(server, "init_project", {
          name: "Lifecycle Plan",
          description: "E2E plan lifecycle",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "lifecycle-plan",
          title: "Feature Plan",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "lifecycle-plan",
          title: "Task Alpha",
          status: "backlog",
          planId: "feature-plan",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "lifecycle-plan",
          title: "Task Beta",
          status: "backlog",
          planId: "feature-plan",
        });

        // Write a diagram .mmd file that references these tasks
        const planDir = resolve(dataDir, "projects", "lifecycle-plan", "plans");
        const diagramPath = resolve(planDir, "feature-plan.diagram.mmd");
        const diagramContent = `%% node: T001
%% status: backlog
%% node: T002
%% status: backlog
flowchart TD
  T001[Task Alpha]:::backlog
  T002[Task Beta]:::backlog

  classDef done fill:#4caf50,stroke:#388e3c;
  classDef inProgress fill:#ff9800,stroke:#f57c00;
  classDef backlog fill:#9e9e9e,stroke:#616161;

  class T001 backlog
  class T002 backlog
`;
        mkdirSync(dirname(diagramPath), { recursive: true });
        writeFileSync(diagramPath, diagramContent);

        // Transition first task to done (with diagramNodeId to exercise diagram path)
        const result1 = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "lifecycle-plan",
            taskId: "task-alpha",
            status: "done",
            diagramNodeId: "T001",
          }),
        );
        expect(result1.newStatus).toBe("done");
        // Plan should NOT be done yet (task-beta still backlog)
        expect(result1.planUpdate).toBeNull();
        // Diagram node T001 should be updated
        expect(result1.diagramUpdate).not.toBeNull();
        expect(result1.diagramUpdate.nodeId).toBe("T001");
        expect(result1.diagramUpdate.newStatus).toBe("done");

        // Transition second task to done
        const result2 = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "lifecycle-plan",
            taskId: "task-beta",
            status: "done",
            diagramNodeId: "T002",
          }),
        );
        expect(result2.newStatus).toBe("done");
        // Plan should auto-transition to done
        expect(result2.planUpdate).not.toBeNull();
        expect(result2.planUpdate.newStatus).toBe("done");

        // Diagram node T002 must be updated — no conditional
        expect(result2.diagramUpdate).not.toBeNull();
        expect(result2.diagramUpdate.nodeId).toBe("T002");
        expect(result2.diagramUpdate.newStatus).toBe("done");

        // Verify .mmd file was actually mutated on disk
        const finalDiagram = readFileSync(diagramPath, "utf-8");
        expect(finalDiagram).toContain("T001[Task Alpha]:::done");
        expect(finalDiagram).toContain("T002[Task Beta]:::done");

        // Verify plan metadata directly
        const planResult = parseResult(
          await invokeJsonTool(server, "get_project_plan", {
            slug: "lifecycle-plan",
            planId: "feature-plan",
          }),
        );
        expect(planResult.meta.status).toBe("done");
      } finally {
        await server.close();
      }
    });
  });

  it("partial task completion does not auto-done the plan", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Partial Plan",
          description: "E2E partial plan",
        });

        await invokeJsonTool(server, "create_project_plan", {
          slug: "partial-plan",
          title: "Partial Feature",
          status: "in_progress",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "partial-plan",
          title: "Done Task",
          status: "backlog",
          planId: "partial-feature",
        });

        await invokeJsonTool(server, "create_project_task", {
          slug: "partial-plan",
          title: "Pending Task",
          status: "backlog",
          planId: "partial-feature",
        });

        // Complete only one
        const result = parseResult(
          await invokeJsonTool(server, "transition_project_task", {
            slug: "partial-plan",
            taskId: "done-task",
            status: "done",
          }),
        );

        expect(result.planUpdate).toBeNull();

        // Plan still in_progress
        const planResult = parseResult(
          await invokeJsonTool(server, "get_project_plan", {
            slug: "partial-plan",
            planId: "partial-feature",
          }),
        );
        expect(planResult.meta.status).toBe("in_progress");
      } finally {
        await server.close();
      }
    });
  });
});

// =============================================================================
// Flow 3: Bundle lint → deploy to temp config
// =============================================================================
describe("lifecycle: bundle lint → deploy flow", () => {
  const root = resolve(import.meta.dirname, "..");
  const linterScript = resolve(root, "scripts/lint-bundle.mjs");
  const deployScript = resolve(root, "scripts/deploy-opencode-superpowers.mjs");

  function setupBundle(tempRoot: string) {
    const bundleRoot = resolve(tempRoot, "bundle");
    const manifest = {
      bundleId: "spoc-opencode-superpowers",
      installMode: "opencode-superpowers",
      sourceRoot: "opencode/superpowers",
      skills: { source: "skills", destination: "skills/superpowers" },
      agents: [],
      ownedPaths: ["skills/superpowers", "plugins/superpowers.js"],
      plugin: {
        required: true,
        source: ".opencode/plugins/superpowers.js",
        destination: "plugins/superpowers.js",
      },
      config: { requiredMerges: [] },
    };
    // Also create a bundle-runtime.json for lint
    const bundleRuntime = {
      sourceRoot: "~/.config/opencode/skills/superpowers",
      skills: { alpha: ["SKILL.md"] },
      agents: [],
      plugin: [],
    };
    writeFile(bundleRoot, "manifest.json", JSON.stringify(manifest, null, 2));
    writeFile(
      bundleRoot,
      "bundle-runtime.json",
      JSON.stringify(bundleRuntime, null, 2),
    );
    writeFile(bundleRoot, "skills/alpha/SKILL.md", "# Alpha skill");
    writeFile(
      bundleRoot,
      ".opencode/plugins/superpowers.js",
      "// plugin code",
    );
    return bundleRoot;
  }

  it("lint passes → deploy dry-run → deploy actual → verify files", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "lifecycle-bundle-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundle(tempRoot);

      // Step 1: lint bundle
      const lintProc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(tempRoot, "no-config"),
        },
        encoding: "utf-8",
      });

      expect(lintProc.status).toBe(0);
      const lintResult = JSON.parse(lintProc.stdout);
      expect(lintResult.summary.errors).toBe(0);

      // Step 2: deploy dry-run
      const dryProc = spawnSync("node", [deployScript], {
        cwd: root,
        env: {
          ...process.env,
          DEPLOY_BUNDLE_ROOT: bundleRoot,
          DEPLOY_CONFIG_ROOT: configRoot,
        },
        encoding: "utf-8",
      });

      expect(dryProc.status).toBe(0);
      const dryResult = JSON.parse(dryProc.stdout);
      expect(dryResult.dryRun).toBe(true);
      expect(dryResult.filesAdded.length).toBeGreaterThan(0);
      // Not yet written
      expect(existsSync(resolve(configRoot, "skills/superpowers/alpha/SKILL.md"))).toBe(false);

      // Step 3: deploy actual
      const deployProc = spawnSync("node", [deployScript], {
        cwd: root,
        env: {
          ...process.env,
          DEPLOY_BUNDLE_ROOT: bundleRoot,
          DEPLOY_CONFIG_ROOT: configRoot,
          DEPLOY_DRY_RUN: "false",
        },
        encoding: "utf-8",
      });

      expect(deployProc.status).toBe(0);
      const deployResult = JSON.parse(deployProc.stdout);
      expect(deployResult.dryRun).toBe(false);
      expect(deployResult.filesAdded).toContain("skills/superpowers/alpha/SKILL.md");

      // Step 4: verify files actually deployed
      expect(existsSync(resolve(configRoot, "skills/superpowers/alpha/SKILL.md"))).toBe(true);
      expect(
        readFileSync(resolve(configRoot, "skills/superpowers/alpha/SKILL.md"), "utf-8"),
      ).toBe("# Alpha skill");
      expect(existsSync(resolve(configRoot, "plugins/superpowers.js"))).toBe(true);

      // Step 5: re-lint with config present — should detect no drift
      const relintProc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: configRoot,
        },
        encoding: "utf-8",
      });

      expect(relintProc.status).toBe(0);
      const relintResult = JSON.parse(relintProc.stdout);
      // After fresh deploy, lint comparing bundle to config should show no errors
      expect(relintResult.summary.errors).toBe(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("lint detects drift when config differs from bundle", () => {
    const tempRoot = mkdtempSync(resolve(tmpdir(), "lifecycle-drift-"));
    const configRoot = resolve(tempRoot, "config");

    try {
      const bundleRoot = setupBundle(tempRoot);

      // Deploy first
      spawnSync("node", [deployScript], {
        cwd: root,
        env: {
          ...process.env,
          DEPLOY_BUNDLE_ROOT: bundleRoot,
          DEPLOY_CONFIG_ROOT: configRoot,
          DEPLOY_DRY_RUN: "false",
        },
        encoding: "utf-8",
      });

      // Manually modify deployed file to simulate drift
      writeFileSync(
        resolve(configRoot, "skills/superpowers/alpha/SKILL.md"),
        "# Modified by user",
      );

      // Lint should detect drift — config root for lint is skills/superpowers
      const lintProc = spawnSync("node", [linterScript], {
        cwd: root,
        env: {
          ...process.env,
          BUNDLE_LINT_BUNDLE_ROOT: bundleRoot,
          BUNDLE_LINT_CONFIG_ROOT: resolve(configRoot, "skills/superpowers"),
        },
        encoding: "utf-8",
      });

      expect(lintProc.status).toBe(0);
      const lintResult = JSON.parse(lintProc.stdout);
      // Should have at least a warning about config drift
      const driftIssues = lintResult.issues.filter(
        (i: any) => i.kind === "config-drift",
      );
      expect(driftIssues.length).toBeGreaterThan(0);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
