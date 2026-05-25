---
name: spoc-dashboard
description: Use when starting or managing the SPOC Plan Dashboard — an optional multi-plan browser for viewing all plans across projects with live status and diagrams.
---

# SPOC Dashboard (Optional Multi-Plan Browser)

## Overview

The SPOC Plan Dashboard is an **optional** local web server for browsing plans across all SPOC projects. It renders Mermaid diagrams, task status, and markdown details with live hot-reload. It reads directly from the SPOC DAG (`~/.spoc/`) and serves a retro TUI-styled web UI.

**Primary diagram rendering** for individual plans goes through the visual companion (brainstorming server). The dashboard serves a different purpose: multi-plan overview and project-wide status browsing.

## When to Use

- User explicitly asks for a multi-plan overview or project-wide status
- Comparing plan statuses across multiple projects
- Showing a stakeholder the full picture of all active plans
- Browsing all plans in one place

## When NOT to Use

- Presenting a single plan diagram — use visual companion instead
- Auto-starting for diagram creation — visual companion handles that
- Any scenario where only one plan is being discussed

## Starting the Dashboard

```bash
# Only when user explicitly requests multi-plan overview
bash ~/.config/opencode/skills/spoc/spoc-dashboard/start-server.sh
```

The server starts on port `7777` by default (configurable via `SPOC_DASHBOARD_PORT`).
It prints the URL and writes it to `~/.spoc/.dashboard-info`.

## Stopping the Dashboard

```bash
bash ~/.config/opencode/skills/spoc/spoc-dashboard/stop-server.sh
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

The dashboard is an **optional multi-plan browser**. Do NOT auto-start it.

**Do NOT** start the dashboard when creating or presenting diagrams — that is the visual companion's job.

**Only mention** the dashboard if:
- User asks for multi-plan overview or project-wide status
- User wants to compare plans across projects
- User explicitly asks to start the dashboard

**Detection:** Check the system prompt for a `<spoc_dashboard>` tag containing the URL. If present, the dashboard is already running — mention it only when relevant to multi-plan browsing.

**Starting:** Only when user explicitly requests multi-plan overview:
```bash
bash ~/.config/opencode/skills/spoc/spoc-dashboard/start-server.sh
```

**Single-plan diagrams:** Always use visual companion, never dashboard.

**Stopping:** `bash ~/.config/opencode/skills/spoc/spoc-dashboard/stop-server.sh` — only when user explicitly requests it.
