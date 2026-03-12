# cc-dag

MCP server for agentic DAG-based project management. Tracks projects, their documentation, statuses, and inter-project dependencies as a directed acyclic graph.

## Quick Start

```bash
npx cc-dag
```

On first run, cc-dag creates `~/.cc-dag/` to store project data.

## Installation

```bash
# Run directly (no install)
npx cc-dag

# Or install globally
npm install -g cc-dag
cc-dag
```

### MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop, Cursor):

```json
{
  "mcpServers": {
    "cc-dag": {
      "command": "npx",
      "args": ["cc-dag"]
    }
  }
}
```

## Data Directory

By default, all project data is stored in `~/.cc-dag/`.

Override with the `CC_DAG_DATA_DIR` environment variable:

```bash
CC_DAG_DATA_DIR=/path/to/custom/dir npx cc-dag
```

Or in your MCP client config:

```json
{
  "mcpServers": {
    "cc-dag": {
      "command": "npx",
      "args": ["cc-dag"],
      "env": {
        "CC_DAG_DATA_DIR": "/path/to/custom/dir"
      }
    }
  }
}
```

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) v18+

### Setup

```bash
npm install
```

### Build & Run

```bash
# Build TypeScript
npm run build

# Run the MCP server (stdio transport)
npm run start

# Watch mode during development
npm run dev
```

## MCP Tools

| Tool | Description |
|---|---|
| `init_project` | Initialize a new project in the DAG with templates for overview, tasks, dependencies, and knowledge docs |
| `update_project_doc` | Update a project document (`overview`, `tasks`, `dependencies`, `knowledge`) |
| `update_project_status` | Change a project's status (`draft` → `active` → `completed` → `archived`) |
| `manage_dependency` | Add or remove dependency edges between projects with cycle detection |
| `list_projects` | List all projects in the DAG with their status and dependency edges |
| `get_project` | Get a project's metadata or a specific document (overview, tasks, dependencies, knowledge) |

## MCP Resources

| Resource | Description |
|---|---|
| `cc-dag://projects` | List all tracked projects |
| `cc-dag://projects/{slug}` | Get details for a specific project |
| `cc-dag://skills/*` | Agent skill guides (init-project, update-docs, explore-dag, orchestrate) |

## Orchestrator Agent

cc-dag includes an orchestration prompt: `/cc-dag-orchestrate`.

Use it as the default entry point when you want the agent to classify intent and route automatically across workflows:
- **INIT** (new project setup)
- **BRAINSTORM** (planning and task breakdown)
- **EXECUTE** (do the next concrete task)
- **SYNC** (reconcile docs with reality)
- **EXPLORE** (inspect DAG/project state)
- **MULTI** (chain multiple workflows in sequence)

Compared to invoking specialist prompts directly, the orchestrator handles routing and phase transitions for you, while still using the same underlying cc-dag tools and document conventions.

## Project Structure

```
├── src/
│   ├── index.ts          # Server entrypoint (shebang + bootstrap)
│   ├── tools/            # MCP tool handlers
│   ├── resources/        # MCP resource handlers
│   └── utils/            # DAG logic, paths, templates, errors
├── templates/            # Mustache-style templates for new projects
├── skills/               # Agent skill markdown guides
└── ~/.cc-dag/            # Runtime data (created on first run)
    ├── meta.json         # Root DAG graph
    └── projects/         # Per-project directories
```
