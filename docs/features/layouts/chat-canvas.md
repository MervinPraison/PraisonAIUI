---
nav_title: Chat and Canvas
---

# Chat and Canvas layout

`chat-canvas` is the default layout of the React app shell (`style: app`).
The chat is on the left; the tables, code and files the agent makes sit on a
canvas beside it, where you can sort, copy, download and compare versions.
See [Layouts](../layouts.md) for how layouts are chosen, and
[ADR 0003](../../adr/0003-selectable-layouts.md) for the design.

![The Chat and Canvas layout in dark mode: the conversation on the left, the code the agent wrote open in the canvas on the right](../../images/app-shell-chat-canvas-dark.webp)

```yaml
style: app
layout: chat-canvas        # the default for style: app; this line is optional
```

## What is on screen

**Desktop and tablet**

| Region | What it holds |
|---|---|
| Sidebar (240 px) | The site name and a collapse button (⌘B / Ctrl+B); **New chat** (⌘N / Ctrl+N); the primary pages (chat, artifacts, agents, cron, knowledge, sessions, config; the Artifacts row shows how many artifacts exist across chats); **Chats**, your conversations as two-line rows (the title over "3 artifacts · now"), with a search button, the open one raised, a running one marked "Working…"; at the foot the footer pages, **More** (⌘K), which opens the command palette with every other page and command, and the connection line ("Connected · local" when the server is this machine). |
| Top bar | On the chat page: the open chat's title over "Researcher · 3 artifacts · edited 2 min ago" (the agent of the latest answer, the chat's artifacts, their latest change; "reconnecting" joins it while the chat's connection is down). On other pages: the page title. Then **Search or run a command** (⌘K), on the chat page the **Canvas** toggle (pressed while the canvas is open, with the artifact count), **Share** (copies the link; a chat's link opens that chat) and the light/dark switch. |
| The page | Any page renders here. The chat page uses speech-bubble messages, explained approval cards (what the agent wants to run, "Why am I asked?", Approve and Not now) and, when the artifacts feature is installed, the **Canvas** panel on the right. A new chat starts with the canvas collapsed; it opens once the chat has an artifact, and the toggle opens or closes it at any time. The "Chat + Canvas" page (`/chat-canvas`) is the same React chat in the app shell. |

Open, the canvas is the main surface: it takes about 58% of the chat page
and the chat a narrower column (never under about 400 px); with the canvas
closed the chat is a centred column. On a tablet the canvas starts closed.
Drag the gap between the chat and the canvas (or focus it and use the arrow
keys, Home and End) to resize it; the share is kept in this browser. Hiding the sidebar is kept in this browser too.

**Phone**

A header with the menu (the sidebar's contents in a sheet, with 44 px rows),
the chat title and its line, and New chat. On the chat page a
**Chat | Canvas (n)** switch flips between the conversation and the canvas.

## The look

The layout paints with its own look, **Paper** (the design board's palette
and type): warm paper neutrals with a navy accent in light and dark, titles,
the wordmark, artifact titles and table row headers in Newsreader, text in
Source Sans 3 and code in JetBrains Mono. The fonts ship with aiui (no font
CDN) and download only while the look is on. Every other layout, and the
classic frame, keep their own look.

- Prefer the plain Pro look? Open the command palette (⌘K) and run
  **Switch look: Pro**; **Switch look: Paper** brings it back. The choice is
  saved in this browser.
- A brand colour (`theme.accent`, `aiui.set_brand_color(...)`) and the Pro
  accent presets replace the navy accent; the paper neutrals stay.
- Theme authors: the look is `<html data-aiui-look="paper">` with the tokens
  in `src/frontend/src/styles/paper.css`; see DESIGN.md "Looks".

## Artifacts and the canvas

The canvas, the artifact cards under each answer and the artifacts index page
come from the artifacts feature (`layout-features/artifacts`, record
`builtin.artifacts`). The layout loads that code only on the chat page, and
works without it: with the feature missing from the build, or switched off,
the chat page has no canvas and everything else stays.

The canvas (Canvas.dc.html): a tab per artifact with its kind icon, then
the split toggle, **+** (open another of this chat's artifacts below the
shown one, or All artifacts), expand and close. The shown artifact has its
title, kind and time, the version menu ("v2 · edited by Researcher"), Copy,
Download and Share; a table sorts by any column header; History (each
version, who made it, what changed, Restore) sits on the right, and folds
under the viewer on a phone. When the chat has code next to a table or a
document, the code docks below it (Run ⌘↵ and its Output strip, "Ran 1 min
ago · 0.02s", when the server can run it) until you close the split.

Each artifact shows once. While the canvas is there, a code block or table
that is an artifact (3+ lines of code, a table with 2+ rows)
leaves the reply: the reply shows its card ("Comparison table · Table ·
3 rows · v2 · edited by Researcher · In canvas"), and a card opens the
artifact in the canvas (on a phone, the Canvas side). Shorter snippets stay
in the reply. Choose `artifactsInChat: inline` to keep the blocks in the
reply as well, a long code block cut to its first 12 lines and a long table
to its first 6 rows (the rest scrolls inside the block):

```yaml
layout:
  default: chat-canvas
  options:
    chat-canvas: {artifactsInChat: inline, collapseLines: 20, collapseRows: 10}
```

The `chat` layout has no canvas and keeps every block in the reply.

## Turning parts off

- `extensions.disabled: [builtin.artifacts]`: no canvas, no Artifacts page;
  the rest of the layout is unchanged.
- `extensions.disabled: [builtin.approvals]`: no approval toasts; the
  approval card in the thread still decides the gate.
- `extensions.disabled: [builtin.layout-chat-canvas]`: the layout is not
  offered; the app shell opens on the next offered layout, or the classic
  frame.

## For plugin and theme authors

- The frame is the chunk `layout-chat-canvas`. It imports only the SDK,
  `components/ui`, `lib` and the layout kit, and loads the artifacts feature
  with `import()`.
- Styling hooks: `[data-aiui-layout-frame="chat-canvas"]` on the frame
  (`data-viewport` is `phone`, `tablet` or `desktop`), `[data-cc-title]` and
  `[data-cc-subtitle]` in the top bar, `[data-aiui-aside-slot]` (where the
  chat's aside toggle is portalled; without it the toggle stays in the chat's
  own header), `[data-cc-chat-meta]` on a chat row's second line, `[data-aiui-session]` on chat rows,
  `[data-aiui-nav-item]` on nav rows.
- The shell's `header:actions` slot is at the end of the top bar and
  `sidebar:footer` at the foot of the sidebar.
- `[data-in-canvas]` marks a reply block that is shown as its card
  (`data-cc-artifacts="card"` on the frame hides it); the window event
  `aiui:chat-aside` (`{open: true}` / `{open: false}`) opens or closes the
  chat's aside, as an artifact card does.
- The artifacts feature plugs in through files the layout looks for:
  `layout-features/artifacts/CanvasPanel.tsx` (the canvas, a chat region),
  `ArtifactCards.tsx` (the cards under an answer, a turn region) and
  `feed.ts` (the `artifacts` data feed, exported as `artifactsFeed` or as
  the default export).
