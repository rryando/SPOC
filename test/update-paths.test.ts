import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDataDir } from "./helpers/temp-data-dir.js";
import { createTestServer, invokeJsonTool } from "./helpers/test-server.js";

function readProjectMeta(dataDir: string, slug: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(dataDir, "projects", slug, "meta.json"), "utf-8")
  );
}

describe("update_project_paths", () => {
  it("adds workspace paths to a project", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Test Project",
          description: "A test project",
          workspacePaths: [],
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "test-project",
          action: "add",
          paths: ["/Users/ryan/test-project"],
        });

        const meta = readProjectMeta(dataDir, "test-project");
        expect(meta.workspacePaths).toEqual(["/Users/ryan/test-project"]);
      } finally {
        await server.close();
      }
    });
  });

  it("deduplicates added paths", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Dedup Test",
          description: "test",
          workspacePaths: [],
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "dedup-test",
          action: "add",
          paths: ["/path/a", "/path/b"],
        });
        await invokeJsonTool(server, "update_project_paths", {
          slug: "dedup-test",
          action: "add",
          paths: ["/path/b", "/path/c"],
        });

        const meta = readProjectMeta(dataDir, "dedup-test");
        expect(meta.workspacePaths).toEqual(["/path/a", "/path/b", "/path/c"]);
      } finally {
        await server.close();
      }
    });
  });

  it("strips trailing slashes on add", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Trailing Test",
          description: "test",
          workspacePaths: [],
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "trailing-test",
          action: "add",
          paths: ["/path/to/project/"],
        });

        const meta = readProjectMeta(dataDir, "trailing-test");
        expect(meta.workspacePaths).toEqual(["/path/to/project"]);
      } finally {
        await server.close();
      }
    });
  });

  it("removes workspace paths", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Remove Test",
          description: "test",
          workspacePaths: [],
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "remove-test",
          action: "add",
          paths: ["/path/a", "/path/b"],
        });
        await invokeJsonTool(server, "update_project_paths", {
          slug: "remove-test",
          action: "remove",
          paths: ["/path/a"],
        });

        const meta = readProjectMeta(dataDir, "remove-test");
        expect(meta.workspacePaths).toEqual(["/path/b"]);
      } finally {
        await server.close();
      }
    });
  });

  it("sets workspace paths (replaces all)", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Set Test",
          description: "test",
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "set-test",
          action: "add",
          paths: ["/old/path"],
        });
        await invokeJsonTool(server, "update_project_paths", {
          slug: "set-test",
          action: "set",
          paths: ["/new/path/a", "/new/path/b"],
        });

        const meta = readProjectMeta(dataDir, "set-test");
        expect(meta.workspacePaths).toEqual(["/new/path/a", "/new/path/b"]);
      } finally {
        await server.close();
      }
    });
  });

  it("rejects relative paths", async () => {
    await withTempDataDir(async () => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Relative Test",
          description: "test",
        });

        await expect(
          invokeJsonTool(server, "update_project_paths", {
            slug: "relative-test",
            action: "add",
            paths: ["relative/path"],
          })
        ).rejects.toThrow("INVALID_WORKSPACE_PATH");
      } finally {
        await server.close();
      }
    });
  });

  it("clears all paths with set empty array", async () => {
    await withTempDataDir(async (dataDir) => {
      const server = createTestServer();
      try {
        await invokeJsonTool(server, "init_project", {
          name: "Clear Test",
          description: "test",
        });

        await invokeJsonTool(server, "update_project_paths", {
          slug: "clear-test",
          action: "add",
          paths: ["/some/path"],
        });
        await invokeJsonTool(server, "update_project_paths", {
          slug: "clear-test",
          action: "set",
          paths: [],
        });

        const meta = readProjectMeta(dataDir, "clear-test");
        expect(meta.workspacePaths).toEqual([]);
      } finally {
        await server.close();
      }
    });
  });
});
