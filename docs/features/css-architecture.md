# How the UI Looks Are Built

A beginner-friendly guide to how PraisonAIUI creates its visual appearance — what controls the colors, fonts, and layout you see on screen.

## The Big Picture

PraisonAIUI's appearance comes from **three layers** working together:

```
┌─────────────────────────────────────────┐
│ Layer 3: Your Config (YAML or Python)   │
│   theme preset / darkMode / radius /    │
│   custom CSS                            │
├─────────────────────────────────────────┤
│ Layer 2: Theme Engine                   │
│   Turns your config into CSS variables  │
│   (automatic, behind the scenes)        │
├─────────────────────────────────────────┤
│ Layer 1: CSS Foundation                 │
│   Tailwind CSS + shadcn/ui tokens       │
│   (built-in, you rarely touch this)     │
└─────────────────────────────────────────┘
```

**In plain English:**

1. You choose a theme preset (like "zinc" or "blue") in your config
2. The system translates that into CSS variables (color codes)
3. Every button, text, and background reads those variables to know what color to be

---

## Configuring from Python (`app.py`)

### Theme (colors, dark mode, radius)

```python
import praisonaiui as aiui

# Set the color palette, dark mode, and corner roundness
aiui.set_theme(preset="blue", dark_mode=True, radius="lg")
```

### Branding (title and logo)

```python
aiui.set_branding(title="MyApp", logo="🚀")
```

### Custom CSS (override any style)

```python
aiui.set_custom_css('''
    :root {
        --db-accent: #22c55e;          /* Change accent to green */
        --db-bg: #000000;              /* Pure black background */
        --db-sidebar-bg: #0a0a0a;      /* Darker sidebar */
    }
    .chat-msg-user .chat-msg-content {
        background: #22c55e;           /* Green user bubbles */
    }
''')
```

### Style (layout mode)

```python
aiui.set_style("dashboard")  # chat | agents | playground | dashboard | docs
```

### Complete Example

```python
import praisonaiui as aiui

# Appearance
aiui.set_theme(preset="emerald", dark_mode=True, radius="md")
aiui.set_branding(title="GreenBot", logo="🌿")

# Custom tweaks
aiui.set_custom_css('''
    .db-sidebar-header { font-size: 18px; }
''')

@aiui.reply
async def on_message(message):
    await aiui.say(f"Echo: {message}")
```

---

## Configuring from YAML

### Theme

```yaml
site:
  title: "MyApp"
  logo: "🚀"
  theme:
    preset: "blue"        # Color palette (22 options)
    darkMode: true         # true = dark, false = light
    radius: "lg"           # none | sm | md | lg | xl

style: dashboard
```

### Custom CSS

```yaml
site:
  title: "MyApp"
  customCss: |
    :root {
      --db-accent: #22c55e;
      --db-bg: #000000;
    }
    .chat-msg-user .chat-msg-content {
      background: #22c55e;
    }
```

---

## What You Can Control

### Theme Presets

The preset sets your **color palette** — it changes the accent color used for buttons, active states, and highlights across the entire UI.

| Category | Options |
|----------|---------|
| **Neutral** | zinc (default), slate, stone, gray, neutral |
| **Warm** | red, orange, amber, yellow |
| **Cool** | blue, indigo, violet, purple, cyan, sky, teal |
| **Nature** | green, emerald, lime |
| **Vibrant** | pink, rose, fuchsia |

### Dark Mode

```yaml
site:
  theme:
    darkMode: true      # true = dark background, false = light
```

When light mode is on, all backgrounds flip to white/light gray and text becomes dark.

### Border Radius

| Value | Effect |
|-------|--------|
| `none` | Sharp, square corners |
| `sm` | Slightly rounded |
| `md` | Medium rounded (default) |
| `lg` | More rounded |
| `xl` | Very rounded, pill-shaped buttons |

### Dashboard CSS Variables

For fine-grained control, override these variables in `customCss`:

| Variable | Default (dark) | What It Controls |
|----------|---------------|-----------------|
| `--db-bg` | `#0a0a0f` | Page background |
| `--db-sidebar-bg` | `#111118` | Sidebar background |
| `--db-accent` | `#6366f1` | Buttons, active items, highlights |
| `--db-text` | `#e4e4e7` | Primary text |
| `--db-text-dim` | `#71717a` | Secondary/muted text |
| `--db-border` | `rgba(255,255,255,0.06)` | Borders and dividers |
| `--db-card-bg` | `rgba(255,255,255,0.03)` | Card backgrounds |
| `--db-radius` | `10px` | Corner roundness |

---

## Priority Order

When the same setting is defined in multiple places:

| Priority | Source | Example |
|----------|--------|---------|
| 1 (highest) | **CLI flag** | `--style chat` |
| 2 | **Python API** | `aiui.set_theme(preset="blue")` |
| 3 | **YAML config** | `site.theme.preset: blue` |
| 4 (lowest) | **Built-in defaults** | zinc, dark, md radius |

---

## Two Chat Systems Explained

PraisonAIUI includes **two different chat interfaces**. Understanding the difference helps you choose the right one and know what features to expect.

### React Chat — The Full-Featured Chat

**When it's active:** `style: chat`, `style: agents`, or `style: playground`

This is the **recommended chat** for most users. It's built with React and benefits from the full modern web stack.

**What you get:**

| Feature | How it works |
|---------|-------------|
| 🎨 **Your theme colors** | Automatically follows your `preset` and `darkMode` settings |
| 📋 **Copy code button** | Click to copy any code block — shows "✓ Copied" feedback |
| 🌈 **Syntax highlighting** | Code is color-coded by language (Python, JavaScript, etc.) |
| 📊 **Markdown tables** | Tables render as proper formatted tables |
| 🔤 **Rich typography** | Headers, bold, italic, lists — all beautifully styled |
| 📎 **File attachments** | Upload files to include as context |

### Dashboard Chat — The Admin Chat

**When it's active:** `style: dashboard`

This is a lighter chat built as a dashboard plugin. It's designed for quick admin interactions within the dashboard.

**What you get:**

| Feature | How it works |
|---------|-------------|
| 🎨 **Dashboard theme** | Uses the dashboard's color scheme (now follows your preset!) |
| 💬 **Basic markdown** | Bold, italic, headings, code blocks, links, lists |
| 🔧 **Tool call display** | Shows when the AI is using tools |
| 📋 **Session management** | Create, switch, and manage conversations |
| 🤖 **Agent selection** | Pick which AI agent to chat with |

**What it doesn't have (yet):**

- ❌ Copy button on code blocks
- ❌ Syntax highlighting (code blocks are plain text)
- ❌ Markdown tables

### Which Should I Use?

| If you want... | Use this style |
|----------------|---------------|
| Best chat experience with all features | `style: chat` |
| Multi-agent dashboard with admin controls | `style: dashboard` |
| Agent profiles and switching | `style: agents` |
| Side-by-side prompt testing | `style: playground` |

---

## File Map

Where does each piece of styling live?

| File | What It Does |
|------|-------------|
| `src/frontend/src/index.css` | Main CSS — imports Tailwind, defines default color variables |
| `src/frontend/src/themes.ts` | Theme engine — translates preset names to CSS variable values |
| `src/frontend/src/chat/ChatMessages.tsx` | React chat — has copy buttons, syntax highlighting |
| `templates/frontend/plugins/views/chat.js` | Dashboard chat — basic markdown, dashboard theme |
| `templates/frontend/plugins/dashboard.js` | Dashboard — defines `--db-*` color variables + reads config |

## Related Pages

- [Theming](theming.md) — Theme presets and YAML configuration
- [Styles](styles.md) — The 6 UI styles (chat, agents, playground, etc.)
- [Dark Mode](dark-mode.md) — Dark mode toggle
- [Dashboard](dashboard.md) — Dashboard feature overview
