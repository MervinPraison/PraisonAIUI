---
nav_title: Run ledger and artifacts
---

# Layout data: run ledger and artifacts

Two built-in records serve data that only the selectable [layouts](layouts.md) read. Each lives in
its own feature module and mounts only while a layout that needs it is on offer:

| Record | Module | Serves layouts | Routes |
|---|---|---|---|
| `builtin.run-ledger` | `features/run_ledger.py` | `command`, `mission` | `/api/runs*` |
| `builtin.artifacts` | `features/artifacts.py` | `chat-canvas` | `/api/artifacts*` |

## When they are mounted

- Under `style: app` every layout is on offer by default, so both records are on.
- `layout.available` (YAML) or `aiui.set_layout(available=[...])` narrows the offer. With
  `available: [chat-canvas]` only `builtin.artifacts` mounts, and with `available: [mission]` only
  `builtin.run-ledger` does.
- Under any other style (`dashboard`, the standalone default, or `chat`) no layout is on offer.
  Both records are then `disabled` with the reason `no layout needs it` in
  `/api/plugins?origin=builtin`. Their modules are never imported and their routes answer 404.
- `extensions.enabled: [builtin.run-ledger]` mounts a record whatever the layouts are.
- `extensions.disabled` always wins.

`builtin.artifacts` owns one page, `artifacts` (`shell_only`, `kind: native`,
`layouts: [chat-canvas]`): every chat's artifacts, newest first, with their versions. The React
page is `layout-features/artifacts/ArtifactsPage` (chunk `lf-artifacts`), registered lazily by the
browser built-in `builtin.artifacts` (`src/frontend/src/builtin/artifacts.ts`) only while the
manifest lists the page. The shell shows it in the nav while Chat and Canvas is the frame, and its
URL (where Share links land, `/artifacts?session=…&artifact=…&v=…`) renders under any layout. Like
every `shell_only` page it reaches the app shell manifest only, never `/api/pages` or the
dashboard. `builtin.run-ledger` adds no page.

Every route is authenticated in all three auth modes, like any other `/api/*` route. None is
public.

## Run ledger

The ledger keeps one record per chat run: its session, agent, start and end, status
(`running`, `waiting`, `completed`, `failed`, `cancelled`), its steps (`reasoning`, `tool`,
`text`, `approval`, `handoff`), and the tokens, cost and model of the run's usage records. It adds
no wire event. A client reads the ledger after `run_completed`.

| Route | Returns |
|---|---|
| `GET /api/runs?after=&agent=&session_id=&limit=` | `{runs: RunSummary[], count}`, newest first (`limit` 1–500, default 50) |
| `GET /api/runs/{run_id}` | `RunDetail` with its steps, or 404 |
| `GET /api/runs/kpis?window=today\|24h\|7d` | `RunKpis`; any other window is 400 |
| `GET /api/runs/agents` | `{agents: AgentStatus[]}`, running and waiting agents first |

The shapes are the ones in `src/frontend/src/sdk/layoutTypes.ts`: camelCase keys, times in epoch
milliseconds.

`RunKpis` holds:

- `runs` and `runsDelta`, the change against the previous window of the same length;
- `successRate`, from 0 to 1, with cancelled runs left out;
- `cost` and `budget`;
- `p50Ms` and `p95Ms`, the latency of completed runs.

`budget` is `finops.daily_cost_budget_usd` from the runtime config (Settings, FinOps & Budgets),
multiplied by 7 for the `7d` window. It is left out when that value is unset or 0, or when
`finops.enabled` is `false`.

**Tokens and cost per run.** `usage.track_usage()` takes `run_id=`. When it is not given, it uses
the run the calling task is serving, from the `praisonaiui.features.chat.current_run_id` context
variable. The chat sets that variable for the whole run, and `PraisonAIProvider` passes it on.
`POST /api/usage/track` accepts `run_id` in its body. A provider that records usage without a run
id is joined to the run by session and time window instead, and the run then carries
`approximate: true`.

**Storage.** Finished runs are held in memory (the newest 1000) and appended to
`<data dir>/runs/ledger.jsonl`. The data dir is `PRAISONAI_HOME`, else `AIUI_DATA_DIR`, else
`~/.praisonaiui`.
The append runs on a single writer thread, so the chat broadcast never waits on the disk. The
file is read back the first time a `/api/runs*` route is called, and it is compacted once it holds
more than twice the ring size.

### Observing chat events

The ledger is fed by a hook that any server-side code can use:

```python
from praisonaiui.features.chat import add_event_observer

def on_event(session_id: str, event: dict) -> None:
    if event["type"] == "run_closed":
        print(event["run_id"], event["status"])  # completed | failed | cancelled

remove = add_event_observer(on_event)   # call remove() to stop observing
```

The observer sees every event that `ChatManager.broadcast` sends, whether or not a client is
connected. After each run it also gets one `run_closed` event, which clients never see. By the
time it arrives, the provider has finished and its usage is tracked. Observers run inline on the
event loop, so they must be quick and must not change `event`. An observer that raises is logged
and skipped.

## Artifacts

The browser derives artifacts from the chat: fenced code, tables, file and media elements, and
A2UI surfaces. The extraction rules live only in the client. The server stores what the client
sends: the index for each session, so the nav can count artifacts across sessions, and the
versions the user edited.

| Route | Does |
|---|---|
| `GET /api/artifacts?session_id=&limit=` | The latest version of every key, newest first, without content: `{artifacts, count, sessions}` |
| `GET /api/artifacts/{session_id}` | Every version, with content: `{sessionId, artifacts}` |
| `PUT /api/artifacts/{session_id}/{key}` | Upserts a derived version, or adds a user edit: `{artifact}` |
| `DELETE /api/artifacts/{session_id}/{key}[?version=N]` | Removes one key, or one version of it |
| `DELETE /api/artifacts/{session_id}` | Removes the whole session |

Deleting a chat (`DELETE /sessions/{id}`, which the chat, the Sessions page and
`aiui sessions delete` use) also deletes its artifacts.

The body of a `PUT` is an `Artifact`. `kind` is one of `code`, `table`, `markdown`, `file`,
`image`, `pdf`, `video` or `a2ui`.

- With `edited: true`, or with no `version`, the `PUT` adds the next version.
- With a `version`, it replaces that version. If the user edited that version, the `PUT` is
  refused with 409.

The limits are 512 KB of content for each version, 50 versions for each key (unedited versions
are dropped first), and 500 keys for each session.

`url` must be a relative or same-origin path, or an `http:`, `https:`, `blob:` or `data:image/`
URL, the same rule chat markdown uses. The server first normalises the URL the way a browser
does: it drops tab, CR and LF, and strips leading and trailing control characters and spaces. So
`java\nscript:` is refused like `javascript:`. The normalised form is the one stored.

Each session is one JSON file under `<data dir>/artifacts/`, named by a hash of the session id.
Each write goes to a temporary file that is then renamed into place.
