---
name: spoc-dashboard
description: Use when starting or managing the SPOC Plan Dashboard — an optional multi-plan browser for viewing all plans across projects with live status and diagrams.
---

# Skill: spoc-dashboard

## When

User explicitly requests multi-plan overview or project-wide status browsing.

## Flow

```mermaid
flowchart TD
    A[User requests multi-plan view] --> B{Dashboard running?}
    B -->|yes| C[Share URL from ~/.spoc/.dashboard-info]
    B -->|no| D[bash start-server.sh]
    D --> E[Browse plans at localhost:7777]
    E --> F[User done?]
    F -->|yes| G[bash stop-server.sh]
    F -->|no| E
```

## Commands

```bash
# Start
bash ~/.config/opencode/skills/spoc/spoc-dashboard/start-server.sh

# Stop
bash ~/.config/opencode/skills/spoc/spoc-dashboard/stop-server.sh
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SPOC_DASHBOARD_PORT` | `7777` | HTTP server port |
| `SPOC_DASHBOARD_HOST` | `127.0.0.1` | Bind address |
| `SPOC_DATA_DIR` | `~/.spoc` | DAG data directory |

## Features

- Plan list across all projects, live Mermaid diagrams, status-colored nodes
- Markdown rendering, SSE hot-reload, retro TUI dark theme

## Constraints

- Do NOT auto-start — only on explicit user request
- Single-plan diagrams use visual companion, never dashboard
- Check for `<spoc_dashboard>` tag in system prompt — if present, already running
