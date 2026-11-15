# Guided Studio layout

Guided Studio (`guided`) is the app shell layout for people new to AI
agents. It uses plain words and large buttons, and explains every step the
agent takes. It is one of the [selectable layouts](../layouts.md) of the
React app shell (`style: app`); the default `dashboard` style is not
affected.

```yaml
style: app
layout: guided
```

```python
import praisonaiui as aiui

aiui.set_style("app")
aiui.set_layout("guided")
```

Or set `AIUI_LAYOUT=guided`, or preview it in one tab with `?layout=guided`.

## What it looks like

**Desktop.** A 280 px sidebar holds:

- the app name;
- a large **Start a new chat** button (⌘N / Ctrl+N);
- five destinations: **Home**, **Chat**, **My agents**, **Templates** and
  **Help**;
- **Your recent chats**, the newest five as cards ("Today, 2:14 pm · with
  Researcher"), with **See all** when the server has a sessions page;
- every other page, folded under **More tools**;
- **Settings** and a light/dark switch at the bottom.

The header names the open chat and who it is with: "Chatting with
Researcher · ready to help", or "working on it" and "waiting for your OK"
while a reply runs or waits. **Search ⌘K** opens the command palette.
**Change agent** opens the chat's agent picker, or My agents when the chat
offers no choice of agent.

**Phone** (narrower than 768 px). A 60 px header holds a menu button (your
chats, the other pages, Settings), the chat's title and a **Start a new chat**
button. Four bottom tabs follow the page: **Home**, **Chat**, **My agents**
and **Help**. Every target is at least 44 px and the text at least 15 px.

The layout paints with the PraisonAI Pro tokens. The pickable Pro accents
(Settings → Appearance, or the theme presets) recolour it.

## The chat

Guided changes how the chat page presents itself, not what it does.

| Part | What you see |
|---|---|
| Step tracker | Above each answer: "Here is what Researcher did", numbered steps in plain words, a short result for each step, and "All done in 3 seconds". **Show details** lists the raw calls: the tool, what it ran, what came back, and how long it took. |
| Approvals | The explained approval card: what the agent wants to do, what it will run, the risk, **Why am I asked?**, and **Not now** / **Approve**. |
| Follow-up chips | Under the latest finished answer, "You could ask next" offers the run's suggestions. A chip puts its text in the message box, ready to send. |
| Empty chat | "Pick a template to get started" and four templates. |
| Thread | Larger type, a labelled "You" bubble, and an avatar on each answer. |

### Step labels

Each step gets a plain label. The first rule that matches wins:

1. The server's own label for the step (the tool event's `label`).
2. The tool's name:

| Tool name contains | Label |
|---|---|
| shell, exec, terminal, bash, command | Running a command |
| search, lookup (documents, memory, knowledge: "Searching your documents") | Searching the web |
| fetch, browse, visit, url, or a `url` argument | Visiting python.org |
| write, save, edit with file | Saving report.csv |
| read, open, load with file | Reading report.csv |
| anything else | Using Get weather |

Thinking is "Understanding your question" ("thought for 2s"). The answer is
"Writing the answer". An approval the agent waits on is "Waiting for your
OK". A step's short result is the first line of what it returned, cut at 40
characters.

### Follow-up suggestions

Chips appear only when the server sends suggestions with the finished run
(`run_completed.suggestions`). From Python:

```python
@aiui.reply
async def on_message(message):
    ...
    aiui.suggest(["Show a mergesort example", "Explain Big-O in plain words"])
```

With no suggestions, no chips are shown.

## Templates

Templates are the app's chat starters (`GET /starters`). Besides `label`
and `message`, a starter may carry three optional fields: `category`,
`description` and `icon` (an emoji). The Templates page groups starters by
`category`, and each card shows its `description` and `icon`.

```python
@aiui.starters
def starters():
    return [
        {"label": "Weekly metrics", "message": "Show this week's metrics",
         "category": "Analyse", "description": "Charts of the week", "icon": "📊"},
        {"label": "Draft a reply", "message": "Draft a friendly reply to ", "category": "Write"},
    ]
```

A starter without a `category` is listed under "More ideas". With no
starters configured, Guided offers a short plain-language set: summarise,
draft an email, explain, compare, plan, brainstorm, write code, and look at
numbers.

Using a template opens a new chat with the prompt in the message box. You
can change the words before you send. Nothing is sent for you.

## Pages

| Page | Id | What it shows |
|---|---|---|
| Home | `start` | A welcome, Start a new chat, popular templates, your recent chats, and how a chat works here |
| Templates | `templates` | Every template by category, with a search box and category filters |

Both are shell-only pages of `builtin.layout-guided`. They are never in the
dashboard or `/api/pages`. The nav lists them only while Guided is on, but
their URLs open under any layout. `/` opens on Home while Guided is the
layout; `layout.defaultPage` still wins.

## Options

| Key | Effect |
|---|---|
| `layout.options.guided.helpUrl` | Where **Help** goes: an `http(s)` address (opens in a new tab) or a site path. Without it, Help opens the command palette. |
| `layout.primary` | Replaces the primary destinations (Home, Chat, My agents, Templates), at most 7. |

```yaml
style: app
layout:
  default: guided
  options:
    guided:
      helpUrl: https://docs.example.com/getting-started
```

## Switching it off

`extensions: {disabled: [builtin.layout-guided]}` removes the layout from
the picker and its two pages from the manifest.

With other records off, Guided degrades instead of failing:

- with `builtin.chat` off, there is no chat list and no Start a new chat;
- with `builtin.approvals` off, there are no approval toasts on other pages
  (the chat still shows its own approval card).

## Loading

Guided downloads only what is on screen:

| Chunk | When it loads |
|---|---|
| `layout-guided` | The frame, when Guided is the layout. Its chat regions and pages are their own chunks in the same group, fetched when shown. |
| `layout-kit` | Shared layout pieces, with the frame. |
| `lf-step-tracker` | With the first answer on screen. |

No other layout's code is fetched. The isolation gate
(`npm run check:closure`) and `e2e/specs/layout-guided.spec.ts` check this.

## Source

| What | Where |
|---|---|
| Descriptor (meta, chat presentation, pages) | `src/frontend/src/builtin/layouts/guided.ts` |
| Frame, regions, pages, templates | `src/frontend/src/app-layouts/guided/` |
| Step tracker and its labels | `src/frontend/src/layout-features/step-tracker/` |
| Python record | `builtin.layout-guided` in `src/praisonaiui/builtin/catalog.py` |
| Designs | `Guided.dc.html`, `GuidedPhone.dc.html` (on the Pro tokens) |
