"""Feature Showcase — demonstrates all 8 PraisonAIUI protocol features.

What's New (vs provider-praisonai/):
    • All 8 feature protocol modules wired and seeded
    • Approvals, Schedules, Memory, Sessions, Skills, Hooks, Workflows, Config
    • Auto-discovery via auto_register_defaults()

Run:
    aiui run app.py

Then use a browser or CLI to interact with all features:
    curl http://localhost:8000/api/features          # List features
    aiui features list --server http://localhost:8000
"""

import uuid
import time
import praisonaiui as aiui

# ── Seed demo data at module level (runs when server imports this) ────


def _seed():
    """Pre-seed data for all features."""
    from praisonaiui.features import auto_register_defaults, get_features

    auto_register_defaults()
    features = get_features()

    # Approvals
    if "approvals" in features:
        from praisonaiui.features.approvals import _pending
        aid = uuid.uuid4().hex[:12]
        _pending[aid] = {
            "id": aid, "tool_name": "execute_code",
            "arguments": {"code": "print('hello world')"},
            "risk_level": "medium", "agent_name": "CodeAgent",
            "status": "pending", "created_at": time.time(),
        }

    # Schedules
    if "schedules" in features:
        from praisonaiui.features.schedules import _jobs
        jid = uuid.uuid4().hex[:12]
        _jobs[jid] = {
            "id": jid, "name": "health-ping", "message": "Check health",
            "schedule": {"kind": "every", "every_seconds": 300},
            "enabled": True, "created_at": time.time(),
        }

    # Memory
    if "memory" in features:
        from praisonaiui.features.memory import _memories
        for text, mtype in [
            ("User prefers dark mode", "long"),
            ("Last session: Python async patterns", "short"),
            ("User is John, engineer in SF", "entity"),
        ]:
            mid = uuid.uuid4().hex[:12]
            _memories[mid] = {
                "id": mid, "text": text, "memory_type": mtype,
                "created_at": time.time(),
            }

    # Skills
    if "skills" in features:
        from praisonaiui.features.skills import _skills
        for name, desc, ver in [
            ("web_search", "Search the web", "1.2.0"),
            ("code_exec", "Execute Python code", "2.0.0"),
        ]:
            sid = uuid.uuid4().hex[:12]
            _skills[sid] = {
                "id": sid, "name": name, "description": desc,
                "version": ver, "status": "active", "created_at": time.time(),
            }

    # Hooks
    if "hooks" in features:
        from praisonaiui.features.hooks import _hooks
        hid = uuid.uuid4().hex[:12]
        _hooks[hid] = {
            "id": hid, "name": "log_tool_calls", "event": "tool_call",
            "type": "pre", "created_at": time.time(),
        }

    # Workflows
    if "workflows" in features:
        from praisonaiui.features.workflows import _workflows
        wid = uuid.uuid4().hex[:12]
        _workflows[wid] = {
            "id": wid, "name": "ci-pipeline",
            "description": "Lint → Test → Build → Deploy",
            "pattern": "pipeline",
            "steps": ["lint", "test", "build", "deploy"],
            "created_at": time.time(),
        }

    # Config Runtime
    if "config_runtime" in features:
        from praisonaiui.features.config_runtime import _runtime_config
        _runtime_config.update({"model": "gpt-4o-mini", "temperature": "0.7"})

    print("✅ All features seeded — browse http://localhost:8000/api/features")


_seed()


# ── Chat interface ────────────────────────────────────────────────────


@aiui.starters
async def get_starters():
    return [
        {"label": "List features", "message": "What features are available?", "icon": "🔌"},
        {"label": "Check approvals", "message": "Show me pending approvals", "icon": "✅"},
        {"label": "Search memory", "message": "What do you remember about me?", "icon": "🧠"},
        {"label": "Run workflow", "message": "Run the CI pipeline", "icon": "🔄"},
    ]


@aiui.reply
async def on_message(message: str):
    """Simple echo — the real power is in the API/CLI feature endpoints."""
    await aiui.say(
        f"Got it! Check out the feature APIs:\n"
        f"- `GET /api/features` — list all features\n"
        f"- `GET /api/approvals` — pending approvals\n"
        f"- `GET /api/memory` — stored memories\n"
        f"- `GET /api/workflows` — workflows\n\n"
        f"Try the CLI: `aiui features list`"
    )

