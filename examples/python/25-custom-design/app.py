"""Custom Design Chat — Fully themed chat with all design knobs exposed.

This example shows EVERY design customization option available in PraisonAIUI.
Tweak any value below to redesign your chat — zero frontend code needed.

Design APIs used:
    • aiui.set_branding()     — sidebar title + logo emoji
    • aiui.set_theme()        — color preset, dark/light mode, border radius
    • aiui.set_custom_css()   — CSS variable overrides for total control
    • aiui.set_style()        — layout mode (chat, dashboard, agents, playground)
    • aiui.set_pages()        — choose which sidebar pages to show
    • aiui.register_theme()   — register custom color themes (protocol-driven)
    • @aiui.page()            — create custom dashboard pages with components

Run:
    aiui run app.py
"""

import praisonaiui as aiui

# ═══════════════════════════════════════════════════════════════════
# 1. BRANDING — Sidebar title + logo
# ═══════════════════════════════════════════════════════════════════

aiui.set_branding(
    title="AcmeBot",           # Sidebar header text
    logo="🤖",                 # Emoji or text next to title
)

# ═══════════════════════════════════════════════════════════════════
# 2. THEME — Color preset, dark/light mode, border radius
# ═══════════════════════════════════════════════════════════════════
# preset options: zinc, slate, stone, gray, neutral,
#                 red, orange, amber, yellow, lime, green,
#                 emerald, teal, cyan, sky, blue, indigo, violet,
#                 purple, fuchsia, pink, rose
# radius options: none, sm, md, lg, xl

aiui.set_theme(
    preset="emerald",          # Try: "blue", "rose", "amber", "violet"
    dark_mode=True,            # False for light mode
    radius="lg",               # Try: "none", "sm", "md", "xl"
)

# ═══════════════════════════════════════════════════════════════════
# 3. CUSTOM CSS — Override any CSS variable or style
# ═══════════════════════════════════════════════════════════════════
# Available CSS variables you can override:
#   --db-bg            : page background         (default: #0a0a0f)
#   --db-sidebar-bg    : sidebar background       (default: #111118)
#   --db-card-bg       : card/panel background    (default: rgba(255,255,255,0.03))
#   --db-border        : border color             (default: rgba(255,255,255,0.06))
#   --db-text          : primary text color        (default: #e4e4e7)
#   --db-text-dim      : secondary/muted text      (default: #71717a)
#   --db-accent        : accent/brand color        (default: #6366f1)
#   --db-accent-glow   : accent hover glow         (default: rgba(99,102,241,0.15))
#   --db-accent-rgb    : accent as RGB values      (default: 99,102,241)
#   --db-sidebar-w     : sidebar width             (default: 260px)
#   --db-radius        : global border radius      (default: 12px)
#   --db-transition    : global transition speed   (default: 0.15s)
#   --db-hover         : hover background color    (default: rgba(255,255,255,0.04))
#
# You can also target specific elements:
#   .chat-msg-user .chat-msg-content  — user message bubble
#   .chat-msg-content                  — assistant message bubble
#   .chat-code-wrapper                 — code block wrapper
#   .chat-code-header                  — code block header bar
#   pre.chat-code-block                — code block body
#   .chat-send-btn                     — send button
#   .chat-compose textarea             — chat input field

aiui.set_custom_css("""
    :root {
        /* ── Emerald theme overrides ────────────────── */
        --db-accent: #10b981;
        --db-accent-glow: rgba(16, 185, 129, 0.15);
        --db-accent-rgb: 16, 185, 129;
        --db-bg: #0c1117;
        --db-sidebar-bg: #0f1923;
        --db-card-bg: rgba(16, 185, 129, 0.03);
        --db-border: rgba(16, 185, 129, 0.1);
        --db-radius: 14px;
    }

    /* ── User message bubble ───────────────────────── */
    .chat-msg-user .chat-msg-content {
        background: linear-gradient(135deg, #10b981, #059669);
        border-radius: 18px 18px 4px 18px;
    }

    /* ── Assistant message bubble ───────────────────── */
    .chat-msg-content {
        border-radius: 18px 18px 18px 4px;
    }

    /* ── Send button ───────────────────────────────── */
    .chat-send-btn {
        background: linear-gradient(135deg, #10b981, #059669);
        border-radius: 12px;
    }
    .chat-send-btn:hover {
        box-shadow: 0 0 20px rgba(16, 185, 129, 0.3);
    }

    /* ── Chat input ────────────────────────────────── */
    .chat-compose textarea:focus {
        border-color: #10b981;
        box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.15);
    }

    /* ── Sidebar active item glow ──────────────────── */
    .db-nav-item.active {
        border-left-color: #10b981;
        background: rgba(16, 185, 129, 0.08);
    }

    /* ── Status badges ─────────────────────────────── */
    .chat-status-badge {
        background: rgba(16, 185, 129, 0.15);
        color: #10b981;
    }
""")

# ═══════════════════════════════════════════════════════════════════
# 4. STYLE — Layout mode
# ═══════════════════════════════════════════════════════════════════
# Options: "chat", "dashboard", "agents", "playground"
# "dashboard" gives you sidebar navigation + chat + custom pages

aiui.set_style("dashboard")

# ═══════════════════════════════════════════════════════════════════
# 5. PAGES — Choose which sidebar pages to show
# ═══════════════════════════════════════════════════════════════════
# Available built-in page IDs:
#   chat, channels, agents, skills, memory, knowledge,
#   guardrails, cron, config, security, auth, logs,
#   telemetry, traces, debug, sessions, usage, overview

aiui.set_pages([
    "chat",           # AI chat interface
    "agents",         # Agent profiles
    "memory",         # Memory viewer
    "sessions",       # Session history
    "config",         # Configuration viewer
    "theme-picker",   # 🎨 Live theme picker (protocol-driven)
])


# ═══════════════════════════════════════════════════════════════════
# 5b. CUSTOM THEMES — Register your own color presets
# ═══════════════════════════════════════════════════════════════════
# Protocol-driven: custom themes appear in the Theme Picker page
# alongside built-in presets. Users can also add themes at runtime
# via POST /api/theme/register.

aiui.register_theme("ocean", {"accent": "#0077b6"})
aiui.register_theme("sunset", {"accent": "#ff6b35"})
aiui.register_theme("forest", {"accent": "#2d6a4f"})


# ═══════════════════════════════════════════════════════════════════
# 6. CHAT CALLBACK — AI response handler
# ═══════════════════════════════════════════════════════════════════
# Option A: Let the PraisonAIProvider handle it automatically.
#           When NO @aiui.reply is registered, the provider creates
#           an AI agent (gpt-4o-mini) and streams responses directly.
#           This is the RECOMMENDED approach — just don't register
#           any reply handler and it works out of the box.
#
# Option B: Register your own handler for custom logic:
#
#   @aiui.on("reply")
#   def reply(message):
#       return f"Echo: {message}"
#
# Option C: Use @aiui.reply with aiui.say() for async:
#
#   @aiui.reply
#   async def on_message(message: str):
#       await aiui.say(f"You said: {message}")


# ═══════════════════════════════════════════════════════════════════
# 7. AGENT PROFILES — Shown in the agent selector dropdown
# ═══════════════════════════════════════════════════════════════════

@aiui.on("profiles")
def get_profiles():
    return [
        {"name": "Assistant", "description": "General-purpose AI assistant"},
        {"name": "Code Expert", "description": "Code review & generation"},
        {"name": "Data Analyst", "description": "Data analysis & visualization"},
    ]


# ═══════════════════════════════════════════════════════════════════
# 8. CUSTOM DASHBOARD PAGES — Using the @page decorator
# ═══════════════════════════════════════════════════════════════════
# Uses AIUI's component API to build pages with zero frontend code.
# Components: card, metric, progress_bar, chart, table, alert,
#             badge, tabs, accordion, code_block, json_view, ...

@aiui.page(
    "design-system",
    title="Design System",
    icon="🎨",
    group="Reference",
    description="All available AIUI components for reference",
)
async def design_system_page():
    """Showcase every AIUI component with live examples."""
    return aiui.layout([
        # ── Metrics Row ──
        aiui.columns([
            aiui.metric(label="Total Users", value="12,345", delta="+12%"),
            aiui.metric(label="Active Now", value="342", delta="-2%", delta_color="inverse"),
            aiui.metric(label="Avg Response", value="1.2s", delta="0%", delta_color="off"),
            aiui.metric(label="Uptime", value="99.9%"),
        ]),

        aiui.separator(),

        # ── Cards ──
        aiui.columns([
            aiui.card(title="Revenue", value="$48,200", footer="↑ 8% from last month"),
            aiui.card(title="Messages", value="89,102", footer="↑ 23% from last week"),
        ]),

        aiui.separator(),

        # ── Progress Bars ──
        aiui.progress_bar(label="Model Training", value=78, max_value=100),
        aiui.progress_bar(label="Data Processing", value=45, max_value=100),

        aiui.separator(),

        # ── Alerts ──
        aiui.alert("System is running normally.", variant="info", title="Info"),
        aiui.alert("Model deployed successfully!", variant="success", title="Success"),
        aiui.alert("High memory usage detected.", variant="warning", title="Warning"),
        aiui.alert("Connection to GPU cluster lost.", variant="error", title="Error"),

        aiui.separator(),

        # ── Badges ──
        aiui.text("Badges:"),
        aiui.columns([
            aiui.badge(text="Active", variant="default"),
            aiui.badge(text="Paused", variant="secondary"),
            aiui.badge(text="v2.1.0", variant="outline"),
            aiui.badge(text="Critical", variant="destructive"),
        ]),

        aiui.separator(),

        # ── Chart ──
        aiui.chart(
            chart_type="bar",
            title="Weekly Requests",
            data=[
                {"label": "Mon", "value": 120},
                {"label": "Tue", "value": 190},
                {"label": "Wed", "value": 300},
                {"label": "Thu", "value": 250},
                {"label": "Fri", "value": 420},
                {"label": "Sat", "value": 180},
                {"label": "Sun", "value": 90},
            ],
        ),

        aiui.separator(),

        # ── Table ──
        aiui.table(
            headers=["Model", "Requests", "Avg Latency", "Status"],
            rows=[
                ["gpt-4o", "12,400", "1.8s", "Active"],
                ["gpt-4o-mini", "8,200", "0.9s", "Active"],
                ["claude-3.5", "3,100", "2.1s", "Active"],
                ["llama-3", "1,800", "0.6s", "Standby"],
            ],
        ),

        aiui.separator(),

        # ── Code Block ──
        aiui.code_block(
            language="python",
            code="""import praisonaiui as aiui

# Set your brand
aiui.set_branding(title="MyApp", logo="🚀")

# Set theme
aiui.set_theme(preset="blue", dark_mode=True, radius="lg")

# Custom CSS
aiui.set_custom_css('''
    :root { --db-accent: #3b82f6; }
''')
""",
        ),

        aiui.separator(),

        # ── Tabs ──
        aiui.tabs(items=[
            {"label": "Overview", "content": "Dashboard overview content goes here."},
            {"label": "Analytics", "content": "Analytics data and charts."},
            {"label": "Settings", "content": "Configuration options."},
        ]),

        aiui.separator(),

        # ── Accordion ──
        aiui.accordion(items=[
            {"title": "How to change colors?", "content": "Use aiui.set_custom_css() to override --db-accent and other CSS variables."},
            {"title": "How to add pages?",     "content": "Use the @aiui.page() decorator to create custom dashboard pages."},
            {"title": "How to change layout?",  "content": "Use aiui.set_style() with 'chat', 'dashboard', 'agents', or 'playground'."},
        ]),
    ])


@aiui.page(
    "css-reference",
    title="CSS Reference",
    icon="📐",
    group="Reference",
    description="All available CSS variables",
)
async def css_reference_page():
    """Quick reference for all CSS variables."""
    return aiui.layout([
        aiui.markdown_text("""
## CSS Variables Reference

Override any of these in `aiui.set_custom_css()`:

| Variable | Description | Default |
|----------|-------------|---------|
| `--db-bg` | Page background | `#0a0a0f` |
| `--db-sidebar-bg` | Sidebar background | `#111118` |
| `--db-card-bg` | Card/panel background | `rgba(255,255,255,0.03)` |
| `--db-border` | Border color | `rgba(255,255,255,0.06)` |
| `--db-text` | Primary text | `#e4e4e7` |
| `--db-text-dim` | Muted text | `#71717a` |
| `--db-accent` | Brand/accent color | `#6366f1` |
| `--db-accent-glow` | Accent hover glow | `rgba(99,102,241,0.15)` |
| `--db-accent-rgb` | Accent as R,G,B | `99,102,241` |
| `--db-sidebar-w` | Sidebar width | `260px` |
| `--db-radius` | Border radius | `12px` |
| `--db-transition` | Animation speed | `0.15s` |
| `--db-hover` | Hover background | `rgba(255,255,255,0.04)` |

## Chat-Specific Selectors

| Selector | Description |
|----------|-------------|
| `.chat-msg-user .chat-msg-content` | User message bubble |
| `.chat-msg-content` | Assistant message bubble |
| `.chat-code-wrapper` | Code block container |
| `.chat-code-header` | Code block header bar |
| `pre.chat-code-block` | Code block body |
| `.chat-send-btn` | Send button |
| `.chat-compose textarea` | Chat text input |
| `.chat-sidebar-panel` | Chat sidebar |
| `.chat-top-bar` | Chat header bar |
        """),
    ])
