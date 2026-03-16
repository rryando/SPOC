import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("init_project", () => {
  it("creates structured indexes and current focus overview section", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();

      try {
        await invokeJsonTool(server, "init_project", {
          name: "Structured Memory",
          description: "Tracks project memory in structured documents.",
        });

        const projectDir = resolve(dataDir, "projects", "structured-memory");

        expect(
          JSON.parse(readFileSync(resolve(projectDir, "plans", "index.json"), "utf-8"))
        ).toEqual({ plans: [] });
        expect(
          JSON.parse(readFileSync(resolve(projectDir, "knowledge", "index.json"), "utf-8"))
        ).toEqual({ entries: [] });
        const overview = readFileSync(resolve(projectDir, "overview.md"), "utf-8");

        expect(overview).toContain("## Current Focus");
        expect(overview).not.toContain("| Field | Value |");
      } finally {
        await server.close();
      }
    });
  });
});
