import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const scriptPath = resolve(import.meta.dirname, "../opencode/superpowers/skills/to-diagram/scripts/manage-diagram.mjs");

function run(command: string, filePath: string, ...args: string[]) {
  const result = spawnSync("node", [scriptPath, command, filePath, ...args], {
    encoding: "utf-8",
    cwd: import.meta.dirname,
  });
  return result;
}

const VALID_DIAGRAM = `%% plan: test-plan
%% status: T001=done, T002=inProgress, T003=backlog, T004=backlog, T005=blocked
%% ready: T003
%% blocked: T005
%% next-action: Start T003

%% node: T001
%% title: Design schema
%% status: done
%% skill: quick-dev
%% scope: db/
%% acceptance: Migration runs
%% verify: npm run migrate

%% node: T002
%% title: Build API
%% status: inProgress
%% skill: tdd
%% scope: src/api/
%% acceptance: CRUD works
%% verify: npm test

%% node: T003
%% title: Write tests
%% status: backlog
%% skill: tdd
%% scope: test/
%% acceptance: Tests pass
%% verify: npm test
%% blocked-by: T001

%% node: T004
%% title: Build UI
%% status: backlog
%% skill: code-agent
%% scope: src/ui/
%% acceptance: UI renders
%% verify: npm test
%% blocked-by: T002

%% node: T005
%% title: Deploy
%% status: blocked
%% skill: quick-dev
%% scope: infra/
%% acceptance: Deployed
%% verify: npm run deploy
%% blocked-by: T003, T004

flowchart TD
    classDef done fill:#22c55e,color:#fff
    classDef inProgress fill:#f59e0b,color:#fff
    classDef blocked fill:#ef4444,color:#fff
    classDef backlog fill:#94a3b8,color:#fff

    T001[Design schema]:::done --> T002[Build API]:::inProgress
    T001 --> T003[Write tests]:::backlog
    T002 --> T004[Build UI]:::backlog
    T003 --> T005[Deploy]:::blocked
    T004 --> T005
`;

let tempDir: string;
let diagramPath: string;

describe("manage-diagram.mjs", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(resolve(tmpdir(), "manage-diagram-test-"));
    diagramPath = resolve(tempDir, "test.diagram.mmd");
    writeFileSync(diagramPath, VALID_DIAGRAM);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("inspect", () => {
    it("parses nodes, edges, and metadata", () => {
      const result = run("inspect", diagramPath);
      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.planId).toBe("test-plan");
      expect(output.nodes).toHaveLength(5);
      expect(output.nodes[0]).toEqual({ id: "T001", label: "Design schema", status: "done" });
      expect(output.edges).toHaveLength(5);
      expect(output.edges[0]).toEqual({ from: "T001", to: "T002" });
      expect(output.metadataBlocks.T001.title).toBe("Design schema");
      expect(output.statusComment).toContain("T001=done");
      expect(output.readyComment).toContain("T003");
    });
  });

  describe("ready", () => {
    it("computes ready nodes from topology", () => {
      const result = run("ready", diagramPath);
      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      // T003 has only T001 as dep and T001 is done → ready
      // T004 has T002 as dep and T002 is inProgress → not ready
      expect(output).toEqual(["T003"]);
    });
  });

  describe("validate", () => {
    it("passes a valid diagram", () => {
      const result = run("validate", diagramPath);
      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(true);
      expect(output.errors).toEqual([]);
    });

    it("fails on missing metadata field", () => {
      const broken = VALID_DIAGRAM.replace("%% verify: npm run migrate\n", "");
      writeFileSync(diagramPath, broken);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: string) => e.includes("verify") && e.includes("T001"))).toBe(true);
    });

    it("fails on missing required field in a non-last metadata block", () => {
      // Remove verify from T003 (middle block) — regression for diagram-lifecycle-canary bug
      const broken = VALID_DIAGRAM.replace(
        "%% verify: npm test\n%% blocked-by: T001",
        "%% blocked-by: T001",
      );
      writeFileSync(diagramPath, broken);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: string) => e.includes("verify") && e.includes("T003"))).toBe(true);
    });

    it("fails on stale status comment", () => {
      const broken = VALID_DIAGRAM.replace("T001=done", "T001=backlog");
      writeFileSync(diagramPath, broken);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: string) => e.includes("Status comment mismatch"))).toBe(true);
    });

    it("fails on metadata order mismatch", () => {
      // Swap T001 and T002 metadata blocks
      const broken = VALID_DIAGRAM
        .replace(
          "%% node: T001\n%% title: Design schema\n%% status: done\n%% skill: quick-dev\n%% scope: db/\n%% acceptance: Migration runs\n%% verify: npm run migrate\n\n%% node: T002",
          "%% node: T002\n%% title: Build API\n%% status: inProgress\n%% skill: tdd\n%% scope: src/api/\n%% acceptance: CRUD works\n%% verify: npm test\n\n%% node: T001\n%% title: Design schema\n%% status: done\n%% skill: quick-dev\n%% scope: db/\n%% acceptance: Migration runs\n%% verify: npm run migrate\n\n%% node: T002_REMOVED",
        );
      // Simpler approach: just reorder
      const lines = VALID_DIAGRAM.split("\n");
      // Find T001 and T002 blocks and swap
      const reordered = VALID_DIAGRAM
        .replace(
          `%% node: T001
%% title: Design schema
%% status: done
%% skill: quick-dev
%% scope: db/
%% acceptance: Migration runs
%% verify: npm run migrate

%% node: T002
%% title: Build API
%% status: inProgress
%% skill: tdd
%% scope: src/api/
%% acceptance: CRUD works
%% verify: npm test`,
          `%% node: T002
%% title: Build API
%% status: inProgress
%% skill: tdd
%% scope: src/api/
%% acceptance: CRUD works
%% verify: npm test

%% node: T001
%% title: Design schema
%% status: done
%% skill: quick-dev
%% scope: db/
%% acceptance: Migration runs
%% verify: npm run migrate`,
        );
      writeFileSync(diagramPath, reordered);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: string) => e.includes("not ordered"))).toBe(true);
    });

    it("fails when ready comment lists nonexistent node ID", () => {
      const broken = VALID_DIAGRAM.replace("%% ready: T003", "%% ready: T999");
      writeFileSync(diagramPath, broken);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors.some((e: string) => e.includes("T999") && e.includes("not found"))).toBe(true);
    });

    it("fails on stateDiagram-v2", () => {
      writeFileSync(diagramPath, `%% plan: test\nstateDiagram-v2\n  [*] --> Draft\n`);

      const result = run("validate", diagramPath);
      expect(result.status).not.toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.ok).toBe(false);
      expect(output.errors[0]).toContain("stateDiagram-v2");
    });
  });

  describe("status", () => {
    it("errors when target node has no :::class suffix in graph", () => {
      // Remove :::backlog from T003 declaration
      const broken = VALID_DIAGRAM.replace("T003[Write tests]:::backlog", "T003[Write tests]");
      writeFileSync(diagramPath, broken);

      const result = run("status", diagramPath, "T003", "done");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("T003");
    });

    it("updates plan-level status comment after node status change", () => {
      const result = run("status", diagramPath, "T002", "done");
      expect(result.status).toBe(0);

      const updated = readFileSync(diagramPath, "utf-8");
      expect(updated).toContain("T002=done");
      expect(updated).not.toContain("T002=inProgress");
    });

    it("updates one node without changing topology and recomputes ready", () => {
      // Mark T002 as done — T004 should become ready
      const result = run("status", diagramPath, "T002", "done");
      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.updated).toBe(true);
      expect(output.nodeId).toBe("T002");
      expect(output.status).toBe("done");
      expect(output.ready).toContain("T003");
      expect(output.ready).toContain("T004");

      // Verify file was updated
      const updated = readFileSync(diagramPath, "utf-8");
      expect(updated).toContain("T002[Build API]:::done");
      expect(updated).not.toContain("T002[Build API]:::inProgress");
    });
  });

  describe("sort-metadata", () => {
    it("orders metadata blocks deterministically by node ID", () => {
      // Write with T003 before T002
      const disordered = VALID_DIAGRAM
        .replace(
          `%% node: T002
%% title: Build API
%% status: inProgress
%% skill: tdd
%% scope: src/api/
%% acceptance: CRUD works
%% verify: npm test

%% node: T003
%% title: Write tests
%% status: backlog
%% skill: tdd
%% scope: test/
%% acceptance: Tests pass
%% verify: npm test
%% blocked-by: T001`,
          `%% node: T003
%% title: Write tests
%% status: backlog
%% skill: tdd
%% scope: test/
%% acceptance: Tests pass
%% verify: npm test
%% blocked-by: T001

%% node: T002
%% title: Build API
%% status: inProgress
%% skill: tdd
%% scope: src/api/
%% acceptance: CRUD works
%% verify: npm test`,
        );
      writeFileSync(diagramPath, disordered);

      const result = run("sort-metadata", diagramPath);
      expect(result.status).toBe(0);

      const output = JSON.parse(result.stdout);
      expect(output.sorted).toBe(true);
      expect(output.order).toEqual(["T001", "T002", "T003", "T004", "T005"]);

      // Verify the file now has T002 before T003
      const content = readFileSync(diagramPath, "utf-8");
      const t002Idx = content.indexOf("%% node: T002");
      const t003Idx = content.indexOf("%% node: T003");
      expect(t002Idx).toBeLessThan(t003Idx);
    });
  });
});
