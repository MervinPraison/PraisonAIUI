# Command Deck layout

The Command Deck (`command`) is the keyboard-first layout of the app shell
(`style: app`). It has a command bar on top, an icon rail, session tabs, a
run inspector beside the chat and a status bar. Every page still renders in
its outlet. For layouts in general, see [Layouts](../layouts.md).

```yaml
style: app
layout: command
```

Other ways to choose it: `aiui.set_layout("command")`, `AIUI_LAYOUT=command`,
`?layout=command` (a preview for this browser tab), Settings → Appearance, or
the palette command "Switch layout: Command Deck".

## What is on screen

| Region | What it does |
|---|---|
| Command bar | "Ask or run a command". Enter sends the text in the open chat (a new chat when none is open) and opens the chat page; a chat feed without `send` puts it in the composer instead. Typing `/` or `>` first opens the command palette with the rest typed in. ⌘K in the bar opens the palette with the bar's text. `/` anywhere outside a text field focuses the bar. The `@Agent` chip names the agent of the open chat. |
| Approvals button | "n approvals waiting", while any are pending. It opens the session the approval waits in, with the run panel. The layout shows approvals itself, so no approval toasts appear. |
| Icon rail | The layout's primary pages (at most seven; YAML `layout.primary` overrides them), each with a G-prefix key shown in its tooltip. "More" opens the palette for every other page. ⌘/ lists all shortcuts. The Runs item shows a count of active runs. |
| Session tabs (chat page) | The newest nine sessions, with the open one always included. An amber dot means the session waits for an approval; a blue dot means it is running. `+` starts a new chat. The right end shows the session id and the Run panel toggle. |
| Run inspector (chat page) | The open chat's latest run: status, run id and Stop; the pending approval with Approve, Deny and "Always allow"; elapsed time, tokens, cost and steps; the Steps timeline with a bar for each step; the files the run's tools touched. On a desktop it starts open, on a tablet closed. |
| Status bar | Online or offline and the host; the agent; active runs and pending approvals; today's tokens and cost; the ⌘K and ⌘/ hints. |

The chat page in this layout draws no session list of its own (the tabs are
the list). It uses the dense thread (the question as a `›` prompt line, a
monospace meta line with the run id, monospace tool rows) and the keyboard
approval strip ("Paused: … wants to run …", A and D).

## Keyboard

`mod` is ⌘ on Apple platforms and Ctrl elsewhere. Single keys never fire
while you type in a field.

| Keys | Action |
|---|---|
| `mod` K | Commands and pages (the palette) |
| `/` | Focus the command bar |
| `mod` N | New chat |
| `mod` 1–9 | Switch to that session tab |
| `mod` I | Show or hide the run panel |
| `mod` / | All shortcuts |
| G, then a letter | Go to a rail page: G C Chat, G R Runs, G A Agents, G J Jobs, G S Config. Other pages take a free letter of their title. |
| J / K | Next or previous step in the run panel |
| Enter | Expand the focused step (its reasoning or tool result) |
| A / D | Approve or deny the pending approval |
| F | Jump to the files touched |
| Ctrl C | Stop the run (only when no text is selected) |

The palette also lists "Show or hide the run panel", "Keyboard shortcuts",
"Stop the run" while a run is going, and "Approve: …" and "Deny: …" for the
open chat's pending approval.

Browsers keep some of these combinations for themselves. For example,
Chrome uses ⌘N and ⌘1–9 itself. Where the browser takes a key first, use
the buttons or the palette instead.

## Phone

Below 768 px the deck becomes a phone frame (CommandPhone):

- The top row holds the menu, the command bar and New chat. The menu opens
  a sheet with any approvals waiting (each with Deny and Approve), the rail
  pages, the other pages, the sessions and the theme switch. An amber dot
  on the menu button means approvals are waiting.
- On the chat page, a switcher row shows the open session and an `n/m`
  counter. Tapping it opens the same sheet.
- The run inspector becomes a peek at the bottom: the run status, steps and
  cost, and the pending approval with 44 px Deny and Approve buttons. Tap
  the peek to expand it into the whole inspector.

Every touch target is at least 44 px, and body text is at least 15 px.

## Data and what happens when a part is off

The frame reads the shell's layout data feeds (`useLayoutData`):

| Feed | Provider | Without it |
|---|---|---|
| `sessions` | `builtin.chat` | No tabs, no switcher, no session list in the sheet |
| `chat` | `builtin.chat` | The run inspector shows "Run details appear here when chat is on"; Enter in the bar opens the palette instead |
| `approvals` | `builtin.approvals` | Approvals come only from the open chat's gates. "Always allow" is hidden. |
| run ledger | `builtin.run-ledger` (mounted only when `command` or `mission` is offered) | Tokens and cost read "—"; no usage in the status bar |

Tokens and cost come from the run ledger (`GET /api/runs/{id}`). The
inspector asks for them again whenever the run changes state, because
there is no wire event for usage. Steps and timings come from the chat
stream itself. Files touched are read from the tools' arguments: `path`,
`file`, `file_path` and similar keys, and shell writes (`>`, `tee`,
`touch`, `mkdir`, `cp`, `mv`, `rm`).

## Code

| Part | Where | Chunk |
|---|---|---|
| Descriptor (eager, tiny) | `src/frontend/src/builtin/layouts/command.ts` | boot |
| Frame | `src/frontend/src/app-layouts/command/` | `layout-command` |
| Command bar | `src/frontend/src/layout-features/command-bar/` | `lf-command-bar` |
| Run inspector | `src/frontend/src/layout-features/run-inspector/` | `lf-run-inspector` |

The frame loads both features with `import()`. On the chat page the
browser downloads `layout-command`, `layout-kit`, `lf-command-bar` and
`lf-run-inspector`; on any other page, everything but `lf-run-inspector`.
No other layout's code is downloaded. The features never import the kit:
the frame passes them its typing check and platform. A feature that
imported the kit would split the kit into one more chunk for every layout.

Budgets (gzip, `npm run size`, measured plus 10%): `layout-command` 15.2 kB
(its closure minus boot, with the kit pieces it imports; ADR cap 24 kB),
`lf-run-inspector` 9.2 kB (cap 14 kB), `lf-command-bar` 1.6 kB (cap 6 kB).

The frame uses only part of the kit (not `BasicFrame` or `ShortcutHint`), so
Rollup splits the kit into chunks by which frames use which pieces (seven
with all five frames in the build); each frame's closure holds the ones it
imports. The kit's budget is 8.3 kB.

The tests are `app-layouts/command/*.test.ts(x)` (the frame model, the
render and the data helpers), `layout-features/run-inspector/*.test.ts(x)`
(steps, files, formats, the panel and the peek),
`layout-features/command-bar/bar.test.tsx`, and
`e2e/specs/layout-command.spec.ts` in the browser. That spec runs in the
`layouts-host` Playwright project, against the layouts server, with
`e2e/specs/layouts-host.spec.ts` (whose network-isolation case allows this
layout exactly `lf-command-bar` and `lf-run-inspector`):

```bash
cd src/frontend && npm run build
npx playwright test -c e2e/fixtures/layout-plugin/playwright.config.ts
```

## Not in this version

- **A Files destination.** The design's rail has one, but no files page
  exists. Files touched still appear in the inspector.
- **Per-step tokens.** The ledger records tokens per run, not per step, so
  the answer step shows a word count instead.
