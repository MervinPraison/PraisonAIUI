# Replay

**PraisonAI Replay** shows a recorded agent run as a story: who did what, when, why, and
at what cost. It works for finished runs and for runs that are still going.

## Record a run, then open it

```bash
praisonai replay view agents.yaml      # records the run and opens Replay on it
```

or from Python:

```python
from praisonai.replay import record

with record(live=True):
    team.start()
```

Every recorded run is a file `<id>.jsonl` in the traces folder. Replay reads it from
`$PRAISONAI_TRACES_DIR`, else `$PRAISON_HOME/traces`, else `~/.praison/traces`.

To open aiui on Replay yourself:

```bash
aiui run "$(python -c 'import praisonaiui.replay_app as m; print(m.__file__)')" \
    --style dashboard --host 127.0.0.1 --port 8090
# then open http://127.0.0.1:8090/replay?run=<id>
```

`/#/replay?run=<id>` works too. In a full dashboard, Replay is in the sidebar under
**Control**.

## Watch a run live: the Run button

For learning, demos and debugging, open a page with a **Run** button. Each click records
a new run, and the page draws it as it happens:

```python
from praisonai.replay import watch

watch(flow, input="solar sails")   # an Agent, AgentTeam, AgentFlow or agents.yaml
```

```bash
praisonai replay watch agents.yaml
```

On the **Map**, each step and agent shows where the run is: dashed means not reached,
blue (pulsing) means running now, green means done and red means failed. After a run,
**▶ Play** moves through it again one step at a time, and the map rewinds with it. One
run goes at a time. Each run of a team starts its tasks afresh; an Agent keeps its chat
history between runs.

## Show progress inside your own app

`create_replay_app()` is the same view as a small ASGI app, without the dashboard. Mount
it in any FastAPI or Starlette app:

```python
from praisonai.replay import record, replay_app

app.mount("/replay", replay_app())         # read-only: shows recorded runs

# wherever your app starts work:
with record(run_id, live=True):
    team.start()
```

Then show one run, live, in your page, for example in an `<iframe>`:

```html
<iframe src="/replay/?run=RUN_ID" style="width:100%;height:640px"></iframe>
```

| URL | Shows |
|---|---|
| `/replay/` | The run list and the selected run |
| `/replay/?run=<id>` | Only that run, no list. A run that has not started yet is waited for. |

`replay_app(team)` adds the Run box to the mounted page. Without the PraisonAI wrapper,
pass any `run(input, run_id)` callable to `praisonaiui.features.replay.create_replay_app`;
it must record the run under `run_id`. For a page you build yourself, the view is one
module:

```html
<div id="progress"></div>
<script type="module">
  import { render } from "/replay/replay.js";
  render(document.getElementById("progress"), { base: "/replay", run: "RUN_ID", approve: false });
</script>
```

`render()` options: `base` (where the API is mounted), `run` (show only this run),
`runner` (`{input, placeholder, ask}` to show the Run box) and `approve` (`false` hides
the approve and deny buttons; the embedded app has no approvals API, so answer approvals
where your app asks for them).

Anyone who can reach the mounted app can read the runs, and with a runner can start one.
Keep it on localhost or behind your app's login. `POST /api/replay/run` only accepts
`Content-Type: application/json`, so another website cannot start a run from a visitor's
browser.

## What you see

| Part | What it shows |
|---|---|
| **Runs** | Recorded runs, newest first. A run that is still being written has a **Live** badge. |
| **Timeline** (default) | One lane per agent, plus **Manager** and **You**. Time runs left to right. LLM calls and tool calls are blocks in their agent's lane. Arrows show hand-offs, delegation, routing and approval requests. Parallel branches get their own sub-lanes. A call or step repeated back to back is one block marked ×N. Tasks and steps run across the top. |
| **Map** | The team or flow as a graph, drawn from the graph recorded at the start of the run and fitted to the page (−, Fit and + zoom; drag to pan). Agents that took part but are not in the graph, for example after a hand-off to an agent outside the team, appear in an **Outside the team** group with their hand-offs. Older recordings without a graph get a "who talked to whom" map built from the events. Each node shows its state at the cursor: dashed means not reached, blue means running, green means done (×N when it ran more than once) and red means failed; the node the cursor is on has a bold outline. |
| **What happened** | One plain sentence per step, for example *"Researcher asked web_search for 'solar sail facts' — 1.2 s, $0.002."* Hovering or focusing a sentence highlights its block, and the other way round. |
| **Details** | Three tabs for the selected step. **What happened**: when, who, how long, cost, tokens, output. **Why**: only what the recording holds, such as the input given to a tool, the context passed in a hand-off and its reason, the manager's task snapshot, the route a step chose, and an approval's decision and where an automatic approval came from. **Raw JSON**: the events themselves. |
| **Cost & latency** | Adds a bar under each block (taller and darker means more cost, or more time) and per-agent totals in the lane labels. |

Shapes always carry meaning as well as colour: agents are circles, tools are rounded
rectangles, you are a diamond and the manager is a square. In each lane, LLM calls sit on
the top row and that agent's tool calls on a thinner row under them, so a long LLM call
never hides its tools. Labels that do not fit end in "…"; hover or focus a block to see the
whole label.

The **Theme** menu follows your system's light or dark setting by default; choose Light or
Dark to override it. On a phone the run list, timeline and steps stack in one column.

## Moving through a run

Replay opens at the end of the run, so you see everything. Move the cursor to replay it:
anything after the cursor is drawn as an outline.

| Key | Action |
|---|---|
| ← → | Previous / next step |
| ↑ ↓ | Previous / next step in the step list; previous / next node in the map |
| Home / End | First / last step |
| Enter or Space | Open the focused block or node |
| ← → in the tabs | Switch between What happened, Why and Raw JSON |

The scrubber under the timeline does the same with a mouse or touch, and **▶ Play** steps
through on its own. On a live run the
cursor follows new events; if you step back, **Jump to live** takes you to the latest.

## Approving from Replay

When an agent asks for approval and the run uses aiui's approval store, a **Waiting for
you** card appears above the timeline:

- **Approve** or **Deny**, with an optional reason.
- **Edit arguments…** opens the arguments as JSON (taken from the server, not the redacted
  recording when the server has them). The JSON must be an object; mistakes are shown
  as you type. **Approve with these arguments** sends them as `modified_args`.

These buttons call `POST /api/approvals/{id}/approve` and `/deny`. The agent waits until
you answer, and is denied if nobody answers before the approval timeout.

## Sharing a run as one file

`praisonai replay export RUN --format html` writes a single HTML file with the run and
this viewer inside. It needs no server and no network. Approvals cannot be answered from
an exported file.

## HTTP API

| Endpoint | Returns |
|---|---|
| `GET /api/replay/runs` | `[{run_id, session_id, path, started_at, ended_at?, status, kind, name, agents, events, cost_usd, live}]`, newest first |
| `GET /api/replay/runs/{id}/events?after_seq=N` | `{events, graph, run}`; `after_seq` keeps only events with a larger `sequence_num`; `wait=1` answers `{events: [], graph: null, run: null}` instead of 404 for a run that has not started yet |
| `GET /api/replay/runs/{id}/stream` | Server-sent events: `event: ctx` per trace event (with `id:` = `sequence_num`), `ping` every 15 s, `end` once the run has finished and gone quiet for 2 s. Honours `after_seq` and `Last-Event-ID`. |

With a runner (`create_replay_app(run=...)`), `POST /api/replay/run` with
`{"input": "..."}` starts a run and returns `{run_id}` (409 while one is going).

Run ids must match `^[A-Za-z0-9._-]+$`. Replay never writes trace files itself. Half-written last lines, unknown fields and unknown event types are skipped
safely, and schema 1.0 recordings still open.

The **Traces** page reads the same files: each run is a trace, and its spans come from
matching start and end events.
