import http from "node:http";
import { listDiagramFiles, readDiagram } from "./diagram-discovery.js";
import { watchDiagramFiles } from "./diagram-watcher.js";
import { renderPreviewHtml } from "./static.js";

export interface PreviewServerOptions {
  plansDir: string;
  host?: string;
  port?: number;
}

export interface PreviewServer {
  port: number;
  host: string;
  close(): Promise<void>;
}

type SSEClient = {
  planId: string;
  res: http.ServerResponse;
};

export async function createPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4077;
  const { plansDir } = options;

  const sseClients: SSEClient[] = [];

  // Watcher broadcasts SSE events
  const watcher = watchDiagramFiles(
    plansDir,
    async (planId) => {
      try {
        const payload = await readDiagram(plansDir, planId);
        const data = JSON.stringify(payload);
        for (const client of sseClients) {
          if (client.planId === planId) {
            client.res.write(`data: ${data}\n\n`);
          }
        }
      } catch {
        // File may have been deleted
      }
    },
    { debounceMs: 250 },
  );

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${host}`);
    const pathname = url.pathname;

    try {
      if (pathname === "/" && req.method === "GET") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderPreviewHtml());
        return;
      }

      if (pathname === "/diagrams" && req.method === "GET") {
        const data = await listDiagramFiles(plansDir);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
        return;
      }

      const diagramMatch = pathname.match(/^\/diagram\/([^/]+)$/);
      if (diagramMatch && req.method === "GET") {
        const planId = diagramMatch[1];
        try {
          const payload = await readDiagram(plansDir, planId);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(payload));
        } catch {
          res.writeHead(404, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "Diagram not found" }));
        }
        return;
      }

      const eventsMatch = pathname.match(/^\/events\/([^/]+)$/);
      if (eventsMatch && req.method === "GET") {
        const planId = eventsMatch[1];
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.flushHeaders();

        const client: SSEClient = { planId, res };
        sseClients.push(client);

        req.on("close", () => {
          const idx = sseClients.indexOf(client);
          if (idx !== -1) sseClients.splice(idx, 1);
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    } catch {
      res.writeHead(500);
      res.end("Internal server error");
    }
  });

  return new Promise<PreviewServer>((resolve, reject) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use. Choose a different port.`));
      } else {
        reject(err);
      }
    });

    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      resolve({
        port: actualPort,
        host,
        async close() {
          watcher.close();
          for (const client of sseClients) {
            client.res.end();
          }
          sseClients.length = 0;
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
