"""Skills feature — tool/skill management for PraisonAIUI.

Provides API endpoints for listing available tools, enable/disable,
and configuration with API keys.

P1 Fix: Reads from SDK's TOOL_MAPPINGS (101 tools) with fallback to hardcoded catalog.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

logger = logging.getLogger(__name__)

# Fallback tool catalog (used when SDK not available)
_FALLBACK_TOOL_CATALOG = {
    # Search Tools
    "internet_search": {
        "name": "Internet Search",
        "description": "Search the web using DuckDuckGo",
        "category": "search",
        "icon": "🔍",
        "required_keys": [],
    },
    "tavily_search": {
        "name": "Tavily Search",
        "description": "AI-powered web search with Tavily",
        "category": "search",
        "icon": "🔎",
        "required_keys": ["TAVILY_API_KEY"],
    },
    "exa_search": {
        "name": "Exa Search",
        "description": "Neural search engine for finding content",
        "category": "search",
        "icon": "🧠",
        "required_keys": ["EXA_API_KEY"],
    },
    "web_search": {
        "name": "Web Search",
        "description": "Unified web search with auto-fallback",
        "category": "search",
        "icon": "🌐",
        "required_keys": [],
    },
    # Crawling Tools
    "crawl4ai": {
        "name": "Crawl4AI",
        "description": "Async web crawling and extraction",
        "category": "crawl",
        "icon": "🕷️",
        "required_keys": [],
    },
    "web_crawl": {
        "name": "Web Crawl",
        "description": "Unified web crawling with auto-fallback",
        "category": "crawl",
        "icon": "🕸️",
        "required_keys": [],
    },
    "scrape_page": {
        "name": "Scrape Page",
        "description": "Extract content from web pages",
        "category": "crawl",
        "icon": "📄",
        "required_keys": [],
    },
    # File Tools
    "read_file": {
        "name": "Read File",
        "description": "Read contents of a file",
        "category": "file",
        "icon": "📖",
        "required_keys": [],
    },
    "write_file": {
        "name": "Write File",
        "description": "Write content to a file",
        "category": "file",
        "icon": "✍️",
        "required_keys": [],
    },
    "list_files": {
        "name": "List Files",
        "description": "List files in a directory",
        "category": "file",
        "icon": "📁",
        "required_keys": [],
    },
    # Code Tools
    "execute_code": {
        "name": "Execute Code",
        "description": "Execute Python code safely",
        "category": "code",
        "icon": "🐍",
        "required_keys": [],
    },
    "analyze_code": {
        "name": "Analyze Code",
        "description": "Analyze Python code structure",
        "category": "code",
        "icon": "🔬",
        "required_keys": [],
    },
    "ast_grep_search": {
        "name": "AST Grep Search",
        "description": "Structural code search using AST patterns",
        "category": "code",
        "icon": "🌳",
        "required_keys": [],
    },
    # Shell Tools
    "execute_command": {
        "name": "Execute Command",
        "description": "Run shell commands",
        "category": "shell",
        "icon": "💻",
        "required_keys": [],
    },
    "list_processes": {
        "name": "List Processes",
        "description": "List running processes",
        "category": "shell",
        "icon": "📊",
        "required_keys": [],
    },
    "get_system_info": {
        "name": "System Info",
        "description": "Get system information",
        "category": "shell",
        "icon": "ℹ️",
        "required_keys": [],
    },
    # Skill Tools
    "run_skill_script": {
        "name": "Run Skill Script",
        "description": "Execute agent skill scripts",
        "category": "skills",
        "icon": "⚡",
        "required_keys": [],
    },
    "schedule_add": {
        "name": "Schedule Add",
        "description": "Add a scheduled task",
        "category": "schedule",
        "icon": "⏰",
        "required_keys": [],
    },
}

# Cached SDK tool catalog
_sdk_tool_catalog: Dict[str, Dict[str, Any]] | None = None

# In-memory state (enabled/disabled, config)
_tool_state: Dict[str, Dict[str, Any]] = {}
_custom_skills: Dict[str, Dict[str, Any]] = {}
_skills_loaded = False


def _ensure_skills_loaded() -> None:
    """Lazy-load skills state from config store."""
    global _skills_loaded, _tool_state, _custom_skills
    if _skills_loaded:
        return
    _skills_loaded = True
    try:
        from praisonaiui.config_store import get_config_store

        store = get_config_store()
        skills_data = store.get_section("skills")
        if isinstance(skills_data, dict):
            _custom_skills.update(skills_data.get("custom", {}))
            # Restore tool state (enabled/disabled toggles)
            for tool_id, state in skills_data.get("tool_state", {}).items():
                _tool_state[tool_id] = state
            if _custom_skills:
                logger.info("Loaded %d custom skills from config store", len(_custom_skills))
    except Exception as e:
        logger.debug("Config store not available for skills: %s", e)


def _save_skills() -> None:
    """Persist skills state to config store."""
    try:
        from praisonaiui.config_store import get_config_store

        store = get_config_store()
        store.set_section(
            "skills",
            {
                "custom": _custom_skills,
                "tool_state": _tool_state,
            },
        )
    except Exception as e:
        logger.warning("Failed to save skills to config store: %s", e)


def get_tool_catalog() -> Dict[str, Dict[str, Any]]:
    """Get tool catalog from SDK TOOL_MAPPINGS with fallback to hardcoded catalog.

    P1 Fix: Reads from praisonaiagents.tools.TOOL_MAPPINGS (101 tools) first,
    falls back to _FALLBACK_TOOL_CATALOG if SDK not available.
    """
    global _sdk_tool_catalog

    if _sdk_tool_catalog is not None:
        return _sdk_tool_catalog

    try:
        from praisonaiagents.tools import TOOL_MAPPINGS

        # Convert TOOL_MAPPINGS to catalog format
        catalog: Dict[str, Dict[str, Any]] = {}
        for tool_name, tool_func in TOOL_MAPPINGS.items():
            # Extract metadata from tool function if available
            doc = getattr(tool_func, "__doc__", "") or ""
            description = doc.split("\n")[0] if doc else f"{tool_name} tool"

            # Categorize based on tool name patterns
            category = "general"
            icon = "🔧"
            if "search" in tool_name.lower():
                category = "search"
                icon = "🔍"
            elif "crawl" in tool_name.lower() or "scrape" in tool_name.lower():
                category = "crawl"
                icon = "🕷️"
            elif (
                "file" in tool_name.lower()
                or "read" in tool_name.lower()
                or "write" in tool_name.lower()
            ):
                category = "file"
                icon = "📁"
            elif "code" in tool_name.lower() or "execute" in tool_name.lower():
                category = "code"
                icon = "🐍"
            elif "shell" in tool_name.lower() or "command" in tool_name.lower():
                category = "shell"
                icon = "💻"
            elif "memory" in tool_name.lower():
                category = "memory"
                icon = "🧠"
            elif "image" in tool_name.lower() or "vision" in tool_name.lower():
                category = "vision"
                icon = "👁️"
            elif "audio" in tool_name.lower() or "speech" in tool_name.lower():
                category = "audio"
                icon = "🔊"
            elif "time" in tool_name.lower() or "date" in tool_name.lower():
                category = "utility"
                icon = "⏰"

            catalog[tool_name] = {
                "name": tool_name.replace("_", " ").title(),
                "description": description[:200] if description else f"{tool_name} tool",
                "category": category,
                "icon": icon,
                "required_keys": [],
                "sdk_tool": True,
            }

        _sdk_tool_catalog = catalog
        logger.info(f"Loaded {len(catalog)} tools from SDK TOOL_MAPPINGS")
        return catalog

    except ImportError:
        logger.debug("praisonaiagents.tools not available, using fallback catalog")
        return _FALLBACK_TOOL_CATALOG
    except Exception as e:
        logger.warning(f"Failed to load SDK tools: {e}, using fallback catalog")
        return _FALLBACK_TOOL_CATALOG


# Backward compatibility alias
TOOL_CATALOG = get_tool_catalog


def _check_api_key(key: str) -> bool:
    """Check if an API key is set in environment."""
    return bool(os.environ.get(key))


def _get_tool_status(tool_id: str) -> Dict[str, Any]:
    """Get the status of a tool including enabled state and API key status."""
    catalog_entry = get_tool_catalog().get(tool_id, {})
    state = _tool_state.get(tool_id, {})

    required_keys = catalog_entry.get("required_keys", [])
    keys_configured = all(_check_api_key(k) for k in required_keys) if required_keys else True

    return {
        "id": tool_id,
        "enabled": state.get("enabled", True),
        "keys_configured": keys_configured,
        "required_keys": required_keys,
    }


class SkillsFeature(BaseFeatureProtocol):
    """Skills/Tools management for PraisonAIUI."""

    feature_name = "skills"
    feature_description = "Agent tool and skill management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            Route("/api/skills", self._list, methods=["GET"]),
            Route("/api/skills/categories", self._categories, methods=["GET"]),
            Route("/api/skills", self._register, methods=["POST"]),
            Route("/api/skills/{skill_id}", self._get, methods=["GET"]),
            Route("/api/skills/{skill_id}", self._update, methods=["PUT"]),
            Route("/api/skills/{skill_id}", self._delete, methods=["DELETE"]),
            Route("/api/skills/{skill_id}/toggle", self._toggle, methods=["POST"]),
            Route("/api/skills/{skill_id}/config", self._config, methods=["PUT"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": "skills",
                "help": "Manage agent skills",
                "commands": {
                    "list": {"help": "List all skills", "handler": self._cli_list},
                    "status": {"help": "Show skill status", "handler": self._cli_status},
                },
            }
        ]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_agents, gateway_health

        _ensure_skills_loaded()

        enabled_count = sum(1 for s in _tool_state.values() if s.get("enabled", True))
        gateway_agents_with_tools = sum(
            1 for agent in gateway_agents() if getattr(agent, "tools", None)
        )
        return {
            "status": "ok",
            "feature": self.name,
            "total_tools": len(get_tool_catalog()),
            "custom_skills": len(_custom_skills),
            "enabled_tools": enabled_count,
            "gateway_agents_with_tools": gateway_agents_with_tools,
            **gateway_health(),
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all available tools and skills."""
        _ensure_skills_loaded()
        category_filter = request.query_params.get("category")
        search = request.query_params.get("search", "").lower()

        tools = []
        for tool_id, info in get_tool_catalog().items():
            if category_filter and info.get("category") != category_filter:
                continue
            if (
                search
                and search not in info.get("name", "").lower()
                and search not in info.get("description", "").lower()
            ):
                continue

            status = _get_tool_status(tool_id)
            tools.append(
                {
                    "id": tool_id,
                    "name": info.get("name", tool_id),
                    "description": info.get("description", ""),
                    "category": info.get("category", "other"),
                    "icon": info.get("icon", "🔧"),
                    "type": "builtin",
                    **status,
                }
            )

        # Add custom skills
        for skill_id, skill in _custom_skills.items():
            if category_filter and skill.get("category") != category_filter:
                continue
            if search and search not in skill.get("name", "").lower():
                continue
            tools.append(
                {
                    **skill,
                    "type": "custom",
                    "enabled": _tool_state.get(skill_id, {}).get("enabled", True),
                }
            )

        return JSONResponse({"skills": tools, "count": len(tools)})

    async def _categories(self, request: Request) -> JSONResponse:
        """List all tool categories."""
        _ensure_skills_loaded()
        categories = {}
        for info in get_tool_catalog().values():
            cat = info.get("category", "other")
            categories[cat] = categories.get(cat, 0) + 1

        return JSONResponse(
            {
                "categories": [
                    {"name": cat, "count": count} for cat, count in sorted(categories.items())
                ]
            }
        )

    async def _register(self, request: Request) -> JSONResponse:
        """Register a custom skill."""
        body = await request.json()
        skill_id = body.get("id", uuid.uuid4().hex[:12])
        entry = {
            "id": skill_id,
            "name": body.get("name", ""),
            "description": body.get("description", ""),
            "category": body.get("category", "custom"),
            "icon": body.get("icon", "⚡"),
            "version": body.get("version", "1.0.0"),
            "registered_at": time.time(),
        }
        _custom_skills[skill_id] = entry
        _save_skills()
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        """Get details for a specific tool/skill."""
        _ensure_skills_loaded()
        skill_id = request.path_params["skill_id"]

        # Check catalog first
        catalog = get_tool_catalog()
        if skill_id in catalog:
            info = catalog[skill_id]
            status = _get_tool_status(skill_id)
            return JSONResponse(
                {
                    "id": skill_id,
                    "name": info.get("name", skill_id),
                    "description": info.get("description", ""),
                    "category": info.get("category", "other"),
                    "icon": info.get("icon", "🔧"),
                    "type": "builtin",
                    **status,
                }
            )

        # Check custom skills
        if skill_id in _custom_skills:
            skill = _custom_skills[skill_id]
            return JSONResponse(
                {
                    **skill,
                    "type": "custom",
                    "enabled": _tool_state.get(skill_id, {}).get("enabled", True),
                }
            )

        return JSONResponse({"error": "Skill not found"}, status_code=404)

    async def _update(self, request: Request) -> JSONResponse:
        """Update a custom skill."""
        skill_id = request.path_params["skill_id"]
        if skill_id not in _custom_skills:
            return JSONResponse({"error": "Custom skill not found"}, status_code=404)

        body = await request.json()
        for key in ("name", "description", "category", "icon", "version"):
            if key in body:
                _custom_skills[skill_id][key] = body[key]

        _save_skills()
        return JSONResponse(_custom_skills[skill_id])

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete a custom skill."""
        skill_id = request.path_params["skill_id"]
        if skill_id in get_tool_catalog():
            return JSONResponse({"error": "Cannot delete builtin tool"}, status_code=400)
        if skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)

        del _custom_skills[skill_id]
        _tool_state.pop(skill_id, None)
        _save_skills()
        return JSONResponse({"deleted": skill_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        """Toggle a tool/skill enabled state."""
        skill_id = request.path_params["skill_id"]

        if skill_id not in get_tool_catalog() and skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)

        if skill_id not in _tool_state:
            _tool_state[skill_id] = {"enabled": True}

        _tool_state[skill_id]["enabled"] = not _tool_state[skill_id].get("enabled", True)

        _save_skills()
        return JSONResponse(
            {
                "id": skill_id,
                "enabled": _tool_state[skill_id]["enabled"],
            }
        )

    async def _config(self, request: Request) -> JSONResponse:
        """Set configuration for a tool (e.g., API keys)."""
        skill_id = request.path_params["skill_id"]

        if skill_id not in get_tool_catalog() and skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)

        body = await request.json()

        if skill_id not in _tool_state:
            _tool_state[skill_id] = {"enabled": True}

        _tool_state[skill_id]["config"] = body.get("config", {})

        _save_skills()
        # Note: In production, API keys would be set in environment
        # This is just for tracking configuration state

        return JSONResponse(
            {
                "id": skill_id,
                "config_updated": True,
            }
        )

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        _ensure_skills_loaded()
        lines = []
        for tool_id, info in get_tool_catalog().items():
            status = _get_tool_status(tool_id)
            icon = "✓" if status["enabled"] else "✗"
            lines.append(f"  [{icon}] {info['icon']} {info['name']}")
        return "\n".join(lines) if lines else "No tools available"

    def _cli_status(self) -> str:
        _ensure_skills_loaded()
        enabled = sum(1 for s in _tool_state.values() if s.get("enabled", True))
        return f"Tools: {len(get_tool_catalog())} builtin, {len(_custom_skills)} custom, {enabled} enabled"


# Backward-compat alias
PraisonAISkills = SkillsFeature
