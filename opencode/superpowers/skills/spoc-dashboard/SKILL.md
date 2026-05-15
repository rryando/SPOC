---
name: spoc-dashboard
description: Use when starting or managing the SPOC Plan Dashboard — a local web server that visualizes running plan diagrams, task status, and markdown details with live hot-reload.
---

# SPOC Dashboard

## Overview

The SPOC Plan Dashboard is a local web server that visualizes your active plans as live Mermaid diagrams with task status, markdown details, and hot-reload on DAG changes. It reads directly from the SPOC DAG (`~/.spoc/`) and serves a retro TUI-styled web UI.

## When to Use

- Starting the dashboard to monitor plan progress visually
- Showing a stakeholder the current state of active plans
- Checking diagram status during a long execution run
- Stopping a running dashboard server

## Starting the Dashboard

```bash
# From the skill directory (after SPOC install)
bash ~/.config/opencode/skills/superpowers/spoc-dashboard/start-server.sh
```

The server starts on port `7777` by default (configurable via `SPOC_DASHBOARD_PORT`).
It prints the URL and writes it to `~/.spoc/.dashboard-info`.

When the dashboard is running, the SPOC orchestrator automatically injects the URL
into every session's system prompt so agents can mention it to users.

## Stopping the Dashboard

```bash
bash ~/.config/opencode/skills/superpowers/spoc-dashboard/stop-server.sh
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `SPOC_DASHBOARD_PORT` | `7777` | HTTP server port |
| `SPOC_DASHBOARD_HOST` | `127.0.0.1` | Bind address |
| `SPOC_DATA_DIR` | `~/.spoc` | SPOC DAG data directory |

## Features

- **Plan list** — browse all plans across all SPOC projects
- **Live Mermaid diagrams** — renders the `## Diagram` section from each plan body
- **Status encoding** — diagram nodes colored by task status (done/inProgress/blocked/backlog)
- **Markdown details** — full plan body rendered below the diagram
- **Hot reload** — SSE-based live updates when DAG files change
- **Retro TUI aesthetic** — dark terminal theme with monospace fonts

## Agent Instructions

When a user asks about plan progress or wants to see diagrams:
1. Check if `~/.spoc/.dashboard-info` exists — if so, dashboard is already running
2. If not running, offer to start it: `bash <skill-dir>/start-server.sh`
3. Share the URL with the user
4. To stop: `bash <skill-dir>/stop-server.sh`
