# ADR 0001: PraisonAI Replay view, a clean-room design

- **Status:** accepted
- **Date:** 2026-10-26
- **Scope:** `src/praisonaiui/features/replay.py`, `features/_trace_jsonl.py`,
  `templates/frontend/plugins/views/replay-core.js`, `templates/frontend/plugins/views/replay.js`

## Context

PraisonAI records agent runs as context-trace JSONL (one `ContextEvent.to_dict()` per
line). People need to see what a team or flow did: who did what, when, why, and at what
cost, both after the fact and live. Other tools have shown that a graph plus a trace is a
useful way to look at agent runs. We want that value without copying anyone's product,
code or look, and without adding dependencies.

## Decision

Build our own view, in plain DOM and SVG, with our own layout code, palette and words.

### Ideas we took (ideas only)

| Idea | Where it came from | What we did with it |
|---|---|---|
| Show the graph of a multi-agent program next to the trace of a run | The general concept behind LangGraph Studio's graph-plus-trace view, known from public talks and articles | A **Map** view drawn by our own layered layout (`layoutMap`); the default view is a **Timeline**, which Studio does not have |
| Parallel voices on shared time, read left to right | Musical scores and swimlane diagrams | One lane per agent plus Manager and You; parallel branches as sub-lanes; tasks and steps as "chapters" across the top |
| Vocabulary for LLM and tool spans, tokens and cost | OpenTelemetry GenAI semantic conventions (public specification) | Block kinds (LLM, tool), token and cost totals; the wrapper's OTLP export uses the conventions, the UI only borrows the concepts |

### What we did not use

- **No third-party UI code, CSS, icons, layouts or screenshots** were used to build this
  view. Shapes, palette, spacing, wording ("Brief", "Delivered", "Waiting for you") and
  the layout algorithm are our own.
- **LangGraph's server (Elastic License 2.0) and the proprietary LangGraph Studio were
  not consulted for code**, and none of their assets, markup or styles were copied. We
  do not use the name "Studio", any "Lang…" naming, or `__start__`/`__end__` pills.
- No Mermaid, D3, React Flow, dagre, ELK or other graph libraries. The dashboard's
  existing Mermaid CDN plugin is not used by Replay.

### How it is built

- `replay-core.js`: pure functions (`buildModel`, `narrate`, `layoutMap`,
  `deriveGraph`). No DOM, no network. Tested with `node --test`.
- `replay.js`: DOM/SVG rendering, keyboard handling, SSE follow and approvals. It also
  boots by itself when `window.__REPLAY_DATA__ = {events, graph}` is set, which is how
  the wrapper's single-file HTML export works (`standalone_html()` inlines both files).
- `layoutMap` is a textbook layered layout written from scratch: depth-first search to
  find back edges (loops), longest-path layering, one virtual waypoint per crossed layer
  for long edges, and a few barycentre sweeps to order each layer. It is deterministic.
- Narration is template text, chosen per event type. No LLM, no randomness.

## Palette and accessibility rationale

| Role | Fill | Shape | Why |
|---|---|---|---|
| Agent | `#8B0000` | circle | PraisonAI's brand red; white text on it is 10.0:1 |
| Tool | `#0F7287` | rounded rectangle | Teal kept from the brand but darkened from `#189AB4` (white text on `#189AB4` fails AA); white on `#0F7287` is 5.6:1 |
| You (human) | `#8A5A00` | diamond | Amber distinct from red and teal for common colour-vision deficiencies; white on it is 5.9:1 |
| Manager | `#3C4A5C` | square | Neutral slate, so the manager reads as coordination, not work; white on it is 9.0:1 |

- **Never colour alone.** Every lane, block, node and step has a shape and a text label;
  arrows differ by dash pattern and carry words ("hands off", "delegates", "routes").
  Heat in the cost/latency overlay is a bar whose height and shade both grow, plus the
  value in text.
- **Light theme first.** Text tokens are at least 6.9:1 on their backgrounds in light mode
  and 7.7:1 in dark mode. In dark mode the palette fills keep white text at AA, and get a
  light 2 px outline so each shape's boundary stays above 3:1 against the dark page.
- **Keyboard throughout.** ← → (and ↑ ↓ in the step list) move the replay cursor, Home
  and End jump to the ends, tabs follow the ARIA tabs pattern, map nodes use a roving
  tab stop, and every action has a real button.
- **Screen readers.** The narration column is a real ordered list and is the main way
  through a run. Timeline blocks and map nodes are named buttons whose names start with
  their visible text (WCAG 2.5.3). Live updates are announced through a polite live
  region, throttled.
- **Motion.** The only animation (the live dot) runs only under
  `prefers-reduced-motion: no-preference`; scrolling is instant when motion is reduced.
- Checked with axe-core against WCAG 2.0, 2.1 and 2.2 A/AA in both themes (dev-only test
  in `tests/browser/`).

## Dependency licences

No new runtime or build dependencies. The Python side uses only the standard library and
Starlette, which aiui already depends on. The browser side is plain ES modules with no
imports beyond our own file. Dev-only test tools that are not shipped: Playwright
(Apache-2.0, already used in this environment) and axe-core (MPL-2.0, loaded from a path
given by `AXE_CORE_JS`; not vendored).

## Consequences

- We own the look and the layout code, and can change them without licence questions.
- The layout is simpler than a dedicated graph engine. It is fine for the team and flow
  sizes we see (tens of nodes). Very large graphs may need a better crossing-reduction
  step later.
