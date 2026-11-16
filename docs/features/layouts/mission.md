---
nav_title: Mission Control
---

# Mission Control layout

Mission Control (`mission`) is the operations view of the app shell: every agent's status,
today's runs and cost, and what waits on you, before anything else. It is one of the built-in
[selectable layouts](../layouts.md) (ADR 0003, record `builtin.layout-mission`).

```yaml
style: app
layout: mission                                   # or, with an environment badge:
layout: {default: mission, options: {mission: {environment: prod}}}
```

```python
aiui.set_style("app")
aiui.set_layout("mission", options={"mission": {"environment": "prod"}})
```

A viewer can also pick it from the palette ("Switch layout: Mission Control") or Settings →
Appearance, and `?layout=mission` previews it for one tab.

## What is on screen

| Where | Desktop (1024 px and up) | Phone (under 768 px) |
|---|---|---|
| Top | Site title, the `environment` badge, search (opens the command palette), provider health, the approvals bell with its count, theme | Site title with health and environment, search, the approvals bell (44 px buttons) |
| Navigation | A 216 px column: the layout's primary pages with counts (agents, runs today, waiting approvals as a warning badge), the other pages folded under 11px uppercase group headers, "More pages ⌘K"; the top bar's pill is the one status indicator ("Connected") | Bottom tabs: the first four primary pages (Overview, Agents, Approvals with its badge, Chat) and More, which opens a sheet with the rest of the nav and the recent chats |
| Home (`/overview`) | The ops overview: approval request cards, today's KPI strip, the agents (waiting first), recent runs | Approval cards first, then the KPI strip and "Tap an agent to open its chat" |
| Chat | The ops column (KPI strip, agent cards, the selected agent's sessions and New chat) beside the chat; a chat header with the session title, Running / Waiting for approval, the agent, run id and start time, Open runs and Stop run | The chat, with the approval banner above it |
| Any page | The approval banner while something waits; the page renders in the frame's outlet under a title row | The approval banner, then the page |

Tablet widths use the desktop frame without the ops column.

### Approvals everywhere

Mission sets `meta.approvals: 'frame'`, so `builtin.approvals` stops toasting while Mission is on
screen: the frame shows every pending approval itself.

- **Banner**, on every page except the overview (which lists them) and the approvals page: the
  oldest pending approval ("Coder needs your approval to continue", the exact call, its risk, how
  long it has waited, how many more wait) with Review, Deny and Approve. When nothing is listed in
  `/api/approvals` but a run is paused on a gate in the open chat, the banner shows that gate on
  the other pages with Open chat. The banner is a region named by its title, and only the title
  is live: a screen reader announces it when an approval appears, not each tick of the timer.
- **Nav badge and bell**: the number of pending approvals.
- **Agent card**: an agent with a pending approval (listed, or a gate in the open chat) shows as
  "Waiting for approval" with the call and a waiting timer, and is listed first.
- **Overview**: one request card per pending approval ("Needs approval · Coder wants to run a
  command", the call, the reason, Deny / Approve, in the banner's order).
- **Thread**: the chat draws gates as approval cards (`meta.chat.approvals: 'card'`).

<kbd>⌘</kbd>/<kbd>Ctrl</kbd> <kbd>J</kbd> moves focus to the banner's Approve button;
<kbd>⌘</kbd>/<kbd>Ctrl</kbd> <kbd>N</kbd> starts a new chat. In a browser tab most browsers keep
<kbd>⌘</kbd>/<kbd>Ctrl</kbd> <kbd>N</kbd> for a new window and the page never sees it; use the
ops column's New chat button there (the shortcut works in an installed app window).

### Run timeline

Above each answer the chat shows the run's steps (`meta.chat.turnHeader`): Think, each tool by
name, Answer, Handoff → *agent* and Approval pending, each as wide as the time it took, with its
duration (a waiting gate counts up as `0:42`). The steps are derived in the browser from the
turn's own parts and their timing, so the timeline needs no server call.

## Data it reads

| Data | Source | When it is missing |
|---|---|---|
| KPIs (runs today and the change, success rate, cost against the FinOps daily budget, p50 / p95 latency), agent status, recent runs | The `runs` layout data kind. Until a browser built-in provides it, the mission board reads the run ledger's routes itself (`GET /api/runs/kpis?window=today`, `/api/runs/agents`, `/api/runs?limit=10`), every 5 s while the tab is visible and on approval events, and stops when Mission is switched away | `builtin.run-ledger` off (the routes answer 404): "Run history is off on this server", no counts in the nav |
| Pending approvals | The `approvals` layout data kind (`builtin.approvals`, its own `/api/approvals/stream`) | No banner, no badge |
| Sessions and the open chat | The `sessions` and `chat` kinds (`builtin.chat`) | No session list or chat header details |
| Health pill | `GET /api/provider/health` every 30 s | "Status unknown" |

See [layout data](../layout-data.md) for the run ledger's routes and gating: it is mounted while
`command` or `mission` is on offer.

## Chat presentation

| `meta.chat` | Value |
|---|---|
| `sessions` | `frame` (the ops column draws the agent's sessions) |
| `thread` | `dense` |
| `approvals` | `card` |
| `turnHeader` | the run timeline (`RunTimeline`, from the mission board's entry) |

## Code and chunks

| Piece | Path | Chunk | Loaded |
|---|---|---|---|
| Descriptor | `src/frontend/src/builtin/layouts/mission.ts` | boot (a few lines) | always (registers the layout; downloads nothing) |
| Frame | `src/frontend/src/app-layouts/mission/` | `layout-mission` | when Mission is on screen |
| Mission board | `src/frontend/src/layout-features/mission-board/` | `lf-mission-board` (one chunk) | with `import()` the first time the frame shows a board part (the run feed, the ops column, the overview, the banner or the run timeline); cached after that |

The frame imports only the SDK, `components/ui`, `lib` and the layout kit, and the board only with
`import()` of its one entry, `mission-board/index.ts` (R17), so the board builds as a single chunk:
one request, not one per part. Budgets (`.size-limit.mjs`, gzip): `layout-mission` 13.2 kB (kit included),
`lf-mission-board` 11.8 kB. Every board part sits behind its own error boundary: a part that fails to load
or render disappears and the frame keeps working.

## The ops overview page

The home of Mission is `overview`. While no catalog page replaces it, the frame shows the ops
overview there itself. The `ops-overview` page record (`shell_only`, `layouts: [mission]`,
`replaces: overview`) is **(planned)**: once the catalog carries it, `/overview` resolves to it under
Mission (shell `resolveRoutePage`) and the frame shows the same board for it.
