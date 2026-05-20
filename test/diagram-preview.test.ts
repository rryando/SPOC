import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCli } from "../src/cli/index.js";
import { listDiagramFiles, readDiagram } from "../src/preview/diagram-discovery.js";
import { watchDiagramFiles } from "../src/preview/diagram-watcher.js";
import { createPreviewServer } from "../src/preview/server.js";
import { _resetPreviewServerState, registerDiagramPreview } from "../src/tools/diagram-preview.js";

describe("diagram-discovery", () => {
  let plansDir: string;

  beforeEach(() => {
    plansDir = mkdtempSync(resolve(tmpdir(), "spoc-preview-test-"));
    mkdirSync(plansDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(plansDir, { recursive: true, force: true });
  });

  it("discovers .diagram.mmd files from plans directory", async () => {
    writeFileSync(resolve(plansDir, "alpha.diagram.mmd"), "graph TD\n  A-->B", "utf-8");
    writeFileSync(resolve(plansDir, "beta.diagram.mmd"), "graph LR\n  X-->Y", "utf-8");
    writeFileSync(resolve(plansDir, "not-a-diagram.md"), "# Plan", "utf-8");

    const result = await listDiagramFiles(plansDir);

    expect(result.diagrams).toHaveLength(2);
    const ids = result.diagrams.map((d) => d.planId).sort();
    expect(ids).toEqual(["alpha", "beta"]);
    for (const d of result.diagrams) {
      expect(d.path).toContain(".diagram.mmd");
      expect(d.modifiedAt).toBeTruthy();
    }
  });

  it("returns empty list for missing directory", async () => {
    const result = await listDiagramFiles("/nonexistent/plans/dir");
    expect(result.diagrams).toEqual([]);
  });

  it("reads diagram by plan ID with content, path, planId, and updatedAt", async () => {
    const content = "graph TD\n  A-->B\n  B-->C";
    writeFileSync(resolve(plansDir, "my-plan.diagram.mmd"), content, "utf-8");

    const payload = await readDiagram(plansDir, "my-plan");

    expect(payload.planId).toBe("my-plan");
    expect(payload.content).toBe(content);
    expect(payload.path).toContain("my-plan.diagram.mmd");
    expect(payload.updatedAt).toBeTruthy();
  });

  it("throws for nonexistent plan ID", async () => {
    await expect(readDiagram(plansDir, "nonexistent")).rejects.toThrow();
  });
});

describe("diagram-watcher", () => {
  let plansDir: string;

  beforeEach(() => {
    plansDir = mkdtempSync(resolve(tmpdir(), "spoc-watcher-test-"));
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(resolve(plansDir, "test.diagram.mmd"), "graph TD\n  A-->B", "utf-8");
  });

  afterEach(() => {
    rmSync(plansDir, { recursive: true, force: true });
  });

  it("fires one debounced callback after file change", async () => {
    const onChange = vi.fn();

    const watcher = watchDiagramFiles(plansDir, onChange, { debounceMs: 50 });

    // Give watcher time to initialize
    await new Promise((r) => setTimeout(r, 50));

    // Simulate file change
    writeFileSync(resolve(plansDir, "test.diagram.mmd"), "graph TD\n  A-->C", "utf-8");

    // Wait past debounce
    await new Promise((r) => setTimeout(r, 200));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("test");

    watcher.close();
  });

  it("handles missing directory gracefully", () => {
    const onChange = vi.fn();
    const watcher = watchDiagramFiles("/nonexistent/dir", onChange);
    // Should not throw
    watcher.close();
  });
});

function httpGet(
  url: string,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      })
      .on("error", reject);
  });
}

describe("preview-server", () => {
  let plansDir: string;

  beforeEach(() => {
    plansDir = mkdtempSync(resolve(tmpdir(), "spoc-server-test-"));
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(resolve(plansDir, "demo.diagram.mmd"), "graph TD\n  A-->B", "utf-8");
  });

  afterEach(() => {
    rmSync(plansDir, { recursive: true, force: true });
  });

  it("GET / returns HTML with Mermaid CDN", async () => {
    const server = await createPreviewServer({ plansDir, host: "127.0.0.1", port: 0 });
    try {
      const res = await httpGet(`http://127.0.0.1:${server.port}/`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body).toContain("mermaid");
    } finally {
      await server.close();
    }
  });

  it("GET /diagrams returns diagram list", async () => {
    const server = await createPreviewServer({ plansDir, host: "127.0.0.1", port: 0 });
    try {
      const res = await httpGet(`http://127.0.0.1:${server.port}/diagrams`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.diagrams).toHaveLength(1);
      expect(data.diagrams[0].planId).toBe("demo");
    } finally {
      await server.close();
    }
  });

  it("GET /diagram/:planId returns diagram payload", async () => {
    const server = await createPreviewServer({ plansDir, host: "127.0.0.1", port: 0 });
    try {
      const res = await httpGet(`http://127.0.0.1:${server.port}/diagram/demo`);
      expect(res.status).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.planId).toBe("demo");
      expect(data.content).toContain("graph TD");
    } finally {
      await server.close();
    }
  });

  it("GET /diagram/:planId returns 404 for unknown plan", async () => {
    const server = await createPreviewServer({ plansDir, host: "127.0.0.1", port: 0 });
    try {
      const res = await httpGet(`http://127.0.0.1:${server.port}/diagram/unknown`);
      expect(res.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it("SSE delivers update when diagram file changes", async () => {
    const server = await createPreviewServer({ plansDir, host: "127.0.0.1", port: 0 });
    try {
      // Connect to SSE
      const diagramPath = resolve(plansDir, "demo.diagram.mmd");
      const sseData = await new Promise<string>((promiseResolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("SSE timeout")), 3000);
        http
          .get(`http://127.0.0.1:${server.port}/events/demo`, (res) => {
            res.on("data", (chunk) => {
              const str = chunk.toString();
              if (str.includes("data:")) {
                clearTimeout(timeout);
                promiseResolve(str);
                res.destroy();
              }
            });
            res.on("error", () => {}); // ignore destroy error
          })
          .on("error", reject);

        // Trigger file change after brief delay
        setTimeout(() => {
          writeFileSync(diagramPath, "graph TD\n  A-->C", "utf-8");
        }, 100);
      });

      expect(sseData).toContain("demo");
      expect(sseData).toContain("A-->C");
    } finally {
      await server.close();
    }
  });
});

describe("cli-preview-routing", () => {
  it("handleCli routes 'preview' command and returns true", async () => {
    // Mock process.exit and console to prevent actual exit
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Without --project, it will call process.exit(1)
    try {
      await handleCli(["preview"]);
    } catch (e: any) {
      expect(e.message).toBe("exit");
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("handleCli returns false for unknown commands", async () => {
    const result = await handleCli(["unknown-cmd"]);
    expect(result).toBe(false);
  });
});

describe("mcp-diagram-preview-tool", () => {
  let plansDir: string;
  let originalDataDir: string | undefined;

  beforeEach(() => {
    originalDataDir = process.env.SPOC_DATA_DIR;
    const dataDir = mkdtempSync(resolve(tmpdir(), "spoc-mcp-preview-"));
    process.env.SPOC_DATA_DIR = dataDir;

    // Create a fake project with plans dir
    const projectDir = resolve(dataDir, "projects", "test-proj");
    plansDir = resolve(projectDir, "plans");
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(
      resolve(projectDir, "meta.json"),
      JSON.stringify({
        slug: "test-proj",
        name: "Test Project",
        workspacePaths: [],
      }),
      "utf-8",
    );
    writeFileSync(resolve(plansDir, "example.diagram.mmd"), "graph TD\n  X-->Y", "utf-8");
    writeFileSync(
      resolve(dataDir, "meta.json"),
      JSON.stringify({
        version: "1.0",
        projects: [{ slug: "test-proj" }],
      }),
      "utf-8",
    );
  });

  afterEach(async () => {
    await _resetPreviewServerState();
    if (originalDataDir === undefined) {
      delete process.env.SPOC_DATA_DIR;
    } else {
      process.env.SPOC_DATA_DIR = originalDataDir;
    }
  });

  it("start, status, stop lifecycle", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

    const server = new McpServer({ name: "test", version: "1.0.0" });
    registerDiagramPreview(server);

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);

    try {
      // Start
      const startRes = await client.callTool({
        name: "preview_diagram_server",
        arguments: { action: "start", slug: "test-proj", port: 0 },
      });
      const startData = JSON.parse((startRes as any).content[0].text);
      expect(startData.running).toBe(true);
      expect(startData.port).toBeGreaterThan(0);

      // Status
      const statusRes = await client.callTool({
        name: "preview_diagram_server",
        arguments: { action: "status" },
      });
      const statusData = JSON.parse((statusRes as any).content[0].text);
      expect(statusData.running).toBe(true);

      // Stop
      const stopRes = await client.callTool({
        name: "preview_diagram_server",
        arguments: { action: "stop" },
      });
      const stopData = JSON.parse((stopRes as any).content[0].text);
      expect(stopData.running).toBe(false);
    } finally {
      await client.close();
    }
  });

  it("second start with different slug returns error", async () => {
    const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");

    const server = new McpServer({ name: "test", version: "1.0.0" });
    registerDiagramPreview(server);

    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([client.connect(ct), server.connect(st)]);

    try {
      // Start first
      await client.callTool({
        name: "preview_diagram_server",
        arguments: { action: "start", slug: "test-proj", port: 0 },
      });

      // Try start with different slug
      const res2 = await client.callTool({
        name: "preview_diagram_server",
        arguments: { action: "start", slug: "other-proj" },
      });
      expect((res2 as any).isError).toBe(true);
      const text = (res2 as any).content[0].text;
      expect(text).toContain("already running");
      expect(text).toContain("test-proj");
    } finally {
      await client.close();
    }
  });
});
