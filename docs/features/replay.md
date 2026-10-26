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

## What you see

| Part | What it shows |
|---|---|
| **Runs** | Recorded runs, newest first. A run that is still being written has a **Live** badge. |
| **Timeline** (default) | One lane per agent, plus **Manager** and **You**. Time runs left to right. LLM calls and tool calls are blocks in their agent's lane. Arrows show hand-offs, delegation, routing and approval requests. Parallel branches get their own sub-lanes. A call or step repeated back to back is one block marked ×N. Tasks and steps run across the top. |
| **Map** | The team or flow as a graph, drawn from the graph recorded at the start of the run. Older recordings without a graph get a "who talked to whom" map built from the events. Nodes you have not reached yet have a dashed outline; the node the cursor is on has a bold one. |
| **What happened** | One plain sentence per step, for example *"Researcher asked web_search for 'solar sail facts' — 1.2 s, $0.002."* Hovering or focusing a sentence highlights its block, and the other way round. |
| **Details** | Three tabs for the selected step. **What happened**: when, who, how long, cost, tokens, output. **Why**: only what the recording holds, such as the input given to a tool, the context passed in a hand-off and its reason, the manager's task snapshot, the route a step chose, and an approval's decision and where an automatic approval came from. **Raw JSON**: the events themselves. |
| **Cost & latency** | Adds a bar under each block (taller and darker means more cost, or more time) and per-agent totals in the lane labels. |

Shapes always carry meaning as well as colour: agents are circles, tools are rounded
rectangles, you are a diamond and the manager is a square.

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

The scrubber under the timeline does the same with a mouse or touch. On a live run the
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
| `GET /api/replay/runs/{id}/events?after_seq=N` | `{events, graph, run}`; `after_seq` keeps only events with a larger `sequence_num` |
| `GET /api/replay/runs/{id}/stream` | Server-sent events: `event: ctx` per trace event (with `id:` = `sequence_num`), `ping` every 15 s, `end` once the run has finished and gone quiet for 2 s. Honours `after_seq` and `Last-Event-ID`. |

Run ids must match `^[A-Za-z0-9._-]+$`. Replay is read-only: it never writes trace
files. Half-written last lines, unknown fields and unknown event types are skipped
safely, and schema 1.0 recordings still open.

The **Traces** page reads the same files: each run is a trace, and its spans come from
matching start and end events.
