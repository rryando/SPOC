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

The dashboard is a silent presentation layer — start it automatically when a diagram is first created, not as a separate user-facing action. Users should not need to manage the dashboard themselves.

**Detection:** Check the system prompt for a `<spoc_dashboard>` tag containing the URL. If present, the dashboard is already running — just reference the URL when presenting diagrams.

**Auto-start:** If no `<spoc_dashboard>` tag is present and you need to show a diagram, start the dashboard silently:
```bash
bash ~/.config/opencode/skills/superpowers/spoc-dashboard/start-server.sh
```
Then present the URL to the user alongside the diagram context (e.g., "Review the plan diagram at http://localhost:7777").

**Fallback:** If the start script fails, fall back to presenting the Mermaid block inline in chat. Do not ask the user to troubleshoot the dashboard.

**Stopping:** `bash ~/.config/opencode/skills/superpowers/spoc-dashboard/stop-server.sh` — only when user explicitly requests it.
