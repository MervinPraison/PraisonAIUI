"""
Multica-Style UI Example
========================

Demonstrates the new Multica-inspired UI features in PraisonAIUI:
- Floating chat window (resizable, draggable, minimizable)
- Collapsible sidebar
- Custom brand color
- Multi-page dashboard with exact Multica look

Run: python app.py
"""

import praisonaiui as aiui

# ── Configure Multica-style UI ────────────────────────────────────
aiui.set_style("dashboard")

# Brand color (Multica uses indigo-based palette)
aiui.set_brand_color("#818cf8")  # Indigo-400

# Branding
aiui.set_branding(title="Multica", logo="🤖")

# Theme: dark mode with rounded corners
aiui.set_theme(preset="indigo", dark_mode=True, radius="lg")

# Floating chat window (Multica's signature feature)
aiui.set_chat_mode(
    "floating",
    position=(20, 20),      # bottom-right offset
    size=(420, 550),        # width x height
    resizable=True,
    minimized=False,
)

# Collapsible sidebar
aiui.set_sidebar_config(
    collapsible=True,
    default_collapsed=False,
    width=260,
)

# ── Register a simple agent ───────────────────────────────────────
@aiui.profiles
async def profiles():
    return [
        {
            "id": "assistant",
            "name": "Assistant",
            "description": "A helpful AI assistant",
            "avatar": "🤖",
        },
        {
            "id": "coder",
            "name": "Coder",
            "description": "Expert programmer",
            "avatar": "👨‍💻",
        },
    ]


@aiui.reply
async def reply(message: str, agent_name: str = None):
    """Simple echo reply for demo purposes."""
    agent = agent_name or "Assistant"
    yield f"**{agent}**: I received your message: *{message}*\n\n"
    yield "This is a demo of the Multica-style floating chat interface. "
    yield "Try:\n"
    yield "- **Drag** the chat window by its header\n"
    yield "- **Resize** by dragging the edges\n"
    yield "- **Minimize** with the − button\n"
    yield "- **Collapse** the sidebar with the toggle button\n"


# ── Dashboard Pages ───────────────────────────────────────────────
@aiui.page("overview", title="Overview", icon="📊", group="Main")
async def overview_page():
    return {
        "_components": [
            aiui.columns([
                aiui.metric(label="Active Agents", value="2", delta="+1"),
                aiui.metric(label="Sessions Today", value="12", delta="+3"),
                aiui.metric(label="Messages", value="156", delta="+24"),
                aiui.metric(label="Uptime", value="99.9%"),
            ]),
            aiui.card(
                title="Welcome to Multica-Style UI",
                children=[
                    aiui.text(
                        "This example demonstrates the new Multica-inspired features "
                        "in PraisonAIUI. The floating chat window, collapsible sidebar, "
                        "and custom brand color are all configurable via Python."
                    ),
                ],
            ),
            aiui.card(
                title="Features Demonstrated",
                children=[
                    aiui.text("• **Floating Chat**: Resizable, draggable chat window"),
                    aiui.text("• **Collapsible Sidebar**: Click the toggle to collapse"),
                    aiui.text("• **Brand Color**: Custom accent color (#818cf8)"),
                    aiui.text("• **Multi-page**: Multiple dashboard pages in one file"),
                ],
            ),
        ]
    }


@aiui.page("agents", title="Agents", icon="🤖", group="Main")
async def agents_page():
    return {
        "_components": [
            aiui.card(
                title="Available Agents",
                children=[
                    aiui.table(
                        headers=["Agent", "Status", "Description"],
                        rows=[
                            ["🤖 Assistant", "Active", "General-purpose AI assistant"],
                            ["👨‍💻 Coder", "Active", "Expert programmer for coding tasks"],
                        ],
                    ),
                ],
            ),
        ]
    }


@aiui.page("settings", title="Settings", icon="⚙️", group="System")
async def settings_page():
    return {
        "_components": [
            aiui.card(
                title="UI Configuration",
                children=[
                    aiui.text("**Chat Mode**: Floating"),
                    aiui.text("**Position**: Bottom-right (20px, 20px)"),
                    aiui.text("**Size**: 420 × 550 px"),
                    aiui.text("**Resizable**: Yes"),
                    aiui.separator(),
                    aiui.text("**Sidebar**: Collapsible"),
                    aiui.text("**Width**: 260px"),
                    aiui.separator(),
                    aiui.text("**Brand Color**: #818cf8 (Indigo-400)"),
                    aiui.text("**Theme**: Indigo, Dark Mode, Large Radius"),
                ],
            ),
            aiui.card(
                title="Code Example",
                children=[
                    aiui.code_block(
                        code='''import praisonaiui as aiui

# Floating chat
aiui.set_chat_mode(
    "floating",
    position=(20, 20),
    size=(420, 550),
    resizable=True,
)

# Collapsible sidebar
aiui.set_sidebar_config(
    collapsible=True,
    width=260,
)

# Brand color
aiui.set_brand_color("#818cf8")''',
                        language="python",
                    ),
                ],
            ),
        ]
    }


# ── Run the app ───────────────────────────────────────────────────
# Run with: aiui run app.py --style dashboard
