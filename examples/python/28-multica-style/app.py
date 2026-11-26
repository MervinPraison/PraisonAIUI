"""Workspace Style — Branded multi-page app with floating chat and custom pages.

Demonstrates ``aiui.configure()``, brand accent color, collapsible sidebar,
floating chat mode, and custom pages in the React app shell.

Run:
    aiui run app.py
"""

import praisonaiui as aiui

aiui.configure(
    branding={"title": "Workspace Studio"},
    theme={"preset": "indigo", "dark": True, "radius": "md", "brand_color": "#6366f1"},
    chat={"feedback": True, "file_upload": True},
)
aiui.set_chat_mode("floating", position=(20, 20), size=(420, 560))
aiui.set_sidebar_config(collapsible=True, width=260)
aiui.only_my_pages("chat")


@aiui.profiles
def get_profiles():
    return [
        {"name": "Strategist", "description": "Product and roadmap planning"},
        {"name": "Engineer", "description": "Architecture and implementation"},
    ]


@aiui.reply
async def on_message(message):
    role = message.agent_name or "Strategist"
    await aiui.say(f"**[{role}]** Received: {message.text}")


@aiui.page("overview", title="Overview", icon="layout-dashboard", group="Main", badge="Live")
async def overview_page():
    return aiui.layout([
        aiui.columns([
            aiui.metric("Active Agents", value=4, delta="+1"),
            aiui.metric("Tasks Completed", value=128, delta="+22%"),
            aiui.metric("Avg Response", value="1.1s", delta="-0.3s", delta_color="inverse"),
        ]),
        aiui.board(columns=[
            {"title": "Queue", "cards": [aiui.card("Audit docs", footer="Strategist")]},
            {"title": "Running", "cards": [aiui.card("Optimize examples", footer="Engineer")]},
            {"title": "Done", "cards": [aiui.card("Release v0.3", footer="Release")]},
        ]),
    ])


@aiui.page("settings", title="Workspace Settings", icon="settings", group="System")
async def settings_page():
    return aiui.layout([
        aiui.key_value_list([
            {"label": "Layout", "value": "React App Shell + Floating Chat"},
            {"label": "Brand Accent", "value": "#6366f1"},
            {"label": "Notifications", "value": "Enabled (header bell)"},
        ], title="Active Configuration")
    ])
