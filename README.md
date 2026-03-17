# cc-dag

MCP server for agentic DAG-based project management. Tracks projects, their documentation, statuses, and inter-project dependencies as a directed acyclic graph.

## Quick Start

```bash
npm install
npm run build

# Interactive setup wizard — configures IDEs and agents
node dist/index.js init

# Start the MCP server
node dist/index.js
```

On first run, cc-dag creates `~/.cc-dag/` to store project data and configuration.

### MCP Client Configuration

The `node dist/index.js init` wizard can automatically write the MCP entry for supported IDEs (VS Code/Copilot, GitHub Copilot CLI, Claude Code, OpenCode). You can also configure it manually:

```json
{
  "mcpServers": {
    "cc-dag": {
      "command": "node",
      "args": ["/absolute/path/to/cc-dag/dist/index.js"]
    }
  }
}
```

## CLI Commands

| Command | Description |
|---|---|
| `node dist/index.js init` | Interactive setup wizard — select IDEs, enable/disable agents, write MCP configs |
| `node dist/index.js config` | Reconfigure an existing installation (same wizard, preserves existing choices) |
| `node dist/index.js` | Start the MCP server (stdio transport) |

## Data Directory

By default, all project data is stored in `~/.cc-dag/`.

Override with the `CC_DAG_DATA_DIR` environment variable:

```bash
CC_DAG_DATA_DIR=/path/to/custom/dir node dist/index.js
```

Or in your MCP client config:

```json
{
  "mcpServers": {
    "cc-dag": {
      "command": "node",
      "args": ["/absolute/path/to/cc-dag/dist/index.js"],
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

# Run tests
npm run test
```

## MCP Tools

### Project Management

| Tool | Description |
|---|---|
| `init_project` | Initialize a new project in the DAG with templates for overview, tasks, dependencies, and knowledge docs |
| `update_project_doc` | Update a project document (`overview`, `tasks`, `dependencies`, `knowledge`) |
| `update_project_status` | Change a project's status (`draft` / `active` / `completed` / `archived`) |
| `manage_dependency` | Add or remove dependency edges between projects with cycle detection |
| `list_projects` | List all projects in the DAG with their status and dependency edges |
| `get_project` | Get a project's metadata or a specific document (overview, tasks, dependencies, knowledge) |

### Plans

| Tool | Description |
|---|---|
| `create_project_plan` | Create a structured plan for feature work within a project |
| `list_project_plans` | List all plans for a project with their status and metadata |
| `get_project_plan` | Get a plan's metadata and body content |
| `update_project_plan_meta` | Update a plan's title, status, or other metadata |
| `update_project_plan_body` | Replace a plan's body content |

### Knowledge

| Tool | Description |
|---|---|
| `create_project_knowledge_entry` | Create a structured knowledge entry for durable project memory |
| `list_project_knowledge_entries` | List all knowledge entries for a project with their metadata |
| `get_project_knowledge_entry` | Get a knowledge entry's metadata and body content |
| `update_project_knowledge_meta` | Update a knowledge entry's title, kind, or other metadata |
| `update_project_knowledge_body` | Replace a knowledge entry's body content |

### Workspace Integration

| Tool | Description |
|---|---|
| `update_project_paths` | Add, remove, or set workspace directory paths for a project (maps local directories to cc-dag projects) |
| `resolve_project_context` | Resolve project context from a workspace directory path — returns assembled overview, active tasks, knowledge, and plans |
| `sync_agents_md` | Generate and write an `AGENTS.md` file to a project's workspace directories (coding discipline rules + codebase analysis + project context) |

## MCP Resources

| Resource | Description |
|---|---|
| `cc-dag://projects` | List all tracked projects |
| `cc-dag://projects/{slug}` | Get details for a specific project |
| `cc-dag://projects/{slug}/plans` | List all plans for a project |
| `cc-dag://projects/{slug}/plans/{planId}` | Get a plan's body content |
| `cc-dag://projects/{slug}/plans/{planId}/meta` | Get a plan's metadata |
| `cc-dag://projects/{slug}/knowledge` | List all knowledge entries for a project |
| `cc-dag://projects/{slug}/knowledge/{entryId}` | Get a knowledge entry's body content |
| `cc-dag://projects/{slug}/knowledge/{entryId}/meta` | Get a knowledge entry's metadata |
| `cc-dag://skills/*` | Agent skill guides (init-project, update-docs, explore-dag, orchestrate) |

## MCP Prompts (Slash Commands)

Prompts are registered as slash commands and can be individually enabled/disabled via `node dist/index.js config`.

| Prompt | Description |
|---|---|
| `/cc-dag-orchestrate` | Top-level router — classifies intent and delegates to specialist workflows |
| `/cc-dag-init` | Guided new-project setup |
| `/cc-dag-brainstorm` | Planning and task breakdown |
| `/cc-dag-execute` | Execute the next concrete task |
| `/cc-dag-sync` | Reconcile docs with reality (sync knowledge) |

### Orchestrator Agent

The `/cc-dag-orchestrate` prompt is the recommended entry point. It classifies intent and routes automatically across workflows:
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
│   ├── cli/              # CLI subcommands (init, config) with interactive TUI
│   ├── agents/           # Agent definitions (names, hints for prompt registration)
│   ├── prompts/          # MCP prompt (slash command) handlers
│   ├── tools/            # MCP tool handlers
│   ├── resources/        # MCP resource handlers
│   └── utils/            # DAG logic, paths, templates, errors, workspace matching
├── templates/            # Mustache-style templates for new projects
├── skills/               # Agent skill markdown guides
├── test/                 # Vitest test suite
└── ~/.cc-dag/            # Runtime data (created on first run)
    ├── config.json       # Agent/IDE configuration
    ├── meta.json         # Root DAG graph
    └── projects/         # Per-project directories
        └── {slug}/
            ├── meta.json       # Project metadata (name, description, workspace paths)
            ├── overview.md
            ├── tasks.md
            ├── dependencies.md
            ├── knowledge.md
            ├── AGENTS.md       # Generated guardrail doc (via sync_agents_md)
            ├── plans/          # Structured plans for feature work
            │   └── {planId}.md
            └── knowledge/      # Structured knowledge entries
                └── {entryId}.md
```
