import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("init_project", () => {
  it("creates structured indexes and lean doc scaffolds", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      try {
        await invokeJsonTool(server, "init_project", {
          name: "Structured Memory",
          description: "Tracks project memory in structured documents.",
        });

        const projectDir = resolve(dataDir, "projects", "structured-memory");

        // --- Structured indexes ---
        expect(
          JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))
        ).toEqual({ plans: [] });
        expect(
          JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))
        ).toEqual({ entries: [] });

        // --- overview.md ---
        const overview = readFileSync(resolve(projectDir, "overview.md"), "utf-8");
        expect(overview).toContain("## Current Focus");
        expect(overview).not.toContain("| Field | Value |");
        expect(overview).not.toContain("<!--");
        expect(overview).not.toContain("**Repo:**");

        // --- tasks.md ---
        const tasks = readFileSync(resolve(projectDir, "tasks.md"), "utf-8");
        expect(tasks).toContain("## Backlog");
        expect(tasks).not.toContain("<!--");

        // --- dependencies.md ---
        const deps = readFileSync(resolve(projectDir, "dependencies.md"), "utf-8");
        expect(deps).toContain("## Upstream");
        expect(deps).not.toContain("| Project | Status | Notes |");
        expect(deps).toContain("- None");

        // --- knowledge.md ---
        const knowledge = readFileSync(resolve(projectDir, "knowledge.md"), "utf-8");
        expect(knowledge).toContain("# Knowledge");
        expect(knowledge).not.toContain("<!--");
      } finally {
        await server.close();
      }
    });
  });
});
