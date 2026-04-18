import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectResources } from "../../src/resources/projects.js";
import { registerAuditKnowledge } from "../../src/tools/audit-knowledge.js";
import { registerDeleteProject } from "../../src/tools/delete-project.js";
import { registerGetProject } from "../../src/tools/get-project.js";
import { registerProjectDiff } from "../../src/tools/project-diff.js";
import { registerInitProject } from "../../src/tools/init-project.js";
import { registerProjectKnowledgeTools } from "../../src/tools/project-knowledge.js";
import { registerProjectPlanTools } from "../../src/tools/project-plans.js";
import { registerProjectTaskTools } from "../../src/tools/project-tasks.js";
import { registerResolveContext } from "../../src/tools/resolve-context.js";
import { registerSearchKnowledge } from "../../src/tools/search-knowledge.js";
import { registerSyncAgentsMd } from "../../src/tools/sync-agents-md.js";
import { registerUpdateDoc } from "../../src/tools/update-doc.js";
import { registerUpdatePaths } from "../../src/tools/update-paths.js";

type ToolRegistration = (server: McpServer) => void;

const defaultRegistrations: ToolRegistration[] = [
  registerInitProject,
  registerGetProject,
  registerUpdateDoc,
  registerProjectPlanTools,
  registerProjectKnowledgeTools,
  registerAuditKnowledge,
  registerSearchKnowledge,
  registerProjectTaskTools,
  registerUpdatePaths,
  registerResolveContext,
  registerSyncAgentsMd,
  registerDeleteProject,
  registerProjectDiff,
];

async function withConnectedClient<T>(
  server: McpServer,
  run: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ name: "spoc-test-client", version: "1.0.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    return await run(client);
  } finally {
    await client.close();
  }
}

function createServerWithRegistrations(extraRegistrations: ToolRegistration[] = []): McpServer {
  const server = new McpServer({
    name: "spoc-test-server",
    version: "1.0.0",
  });

  for (const register of [...defaultRegistrations, ...extraRegistrations]) {
    register(server);
  }

  // Register resources
  registerProjectResources(server);

  return server;
}

export function createTestServer(): McpServer {
  return createServerWithRegistrations();
}

export function createTestServerWithRegistrations(
  ...extraRegistrations: ToolRegistration[]
): McpServer {
  return createServerWithRegistrations(extraRegistrations);
}

export async function invokeJsonTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  return withConnectedClient(server, async (client) => {
    const result = await client.callTool({ name, arguments: args });

    if (result.isError) {
      const text =
        "content" in result && Array.isArray(result.content)
          ? result.content
              .filter((item): item is { type: "text"; text: string } => item.type === "text")
              .map((item) => item.text)
              .join("\n")
          : `Tool ${name} returned an error.`;
      throw new Error(text);
    }

    return result;
  });
}

export async function readResourceText(server: McpServer, uri: string): Promise<string> {
  return withConnectedClient(server, async (client) => {
    const result = await client.readResource({ uri });
    const first = result.contents[0];
    if (!first || !("text" in first)) {
      throw new Error(`No text content for resource ${uri}`);
    }
    return first.text as string;
  });
}
