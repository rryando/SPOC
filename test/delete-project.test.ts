import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

describe("delete_project", () => {
  it("deletes project directory and removes from root meta", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Doomed Project",
          description: "Will be deleted",
        });

        const projectDir = resolve(dataDir, "projects", "doomed-project");
        expect(existsSync(projectDir)).toBe(true);

        await invokeJsonTool(server, "delete_project", {
          slug: "doomed-project",
        });

        // Project directory should be gone
        expect(existsSync(projectDir)).toBe(false);

        // Root meta should no longer contain the project
        const rootMeta = JSON.parse(readFileSync(resolve(dataDir, "meta.json"), "utf-8"));
        expect(rootMeta.projects.find((p: any) => p.id === "doomed-project")).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });

  it("cleans up dependency edges pointing to the deleted project", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        // Create two projects: A depends on B
        await invokeJsonTool(server, "init_project", {
          name: "Project A",
          description: "Depends on B",
        });
        await invokeJsonTool(server, "init_project", {
          name: "Project B",
          description: "Upstream",
        });

        // Add dependency: A depends on B
        // Use manage_dependency tool — need to register it
        // Actually, let's write the dep directly into root meta
        const metaPath = resolve(dataDir, "meta.json");
        const rootMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const projA = rootMeta.projects.find((p: any) => p.id === "project-a");
        projA.dependsOn = ["project-b"];
        const { writeFileSync } = await import("node:fs");
        writeFileSync(metaPath, JSON.stringify(rootMeta, null, 2), "utf-8");

        // Delete project B
        await invokeJsonTool(server, "delete_project", {
          slug: "project-b",
        });

        // Verify project A no longer depends on project B
        const updatedMeta = JSON.parse(readFileSync(metaPath, "utf-8"));
        const updatedA = updatedMeta.projects.find((p: any) => p.id === "project-a");
        expect(updatedA.dependsOn).toEqual([]);

        // Verify project B is gone
        expect(updatedMeta.projects.find((p: any) => p.id === "project-b")).toBeUndefined();
      } finally {
        await server.close();
      }
    });
  });

  it("returns error for non-existent project", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await expect(
          invokeJsonTool(server, "delete_project", {
            slug: "no-such-project",
          }),
        ).rejects.toThrow("PROJECT_NOT_FOUND");
      } finally {
        await server.close();
      }
    });
  });
});
