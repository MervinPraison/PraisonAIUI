"""Skills feature — tool/skill management for PraisonAIUI.

Provides API endpoints for listing available tools, enable/disable,
and configuration with API keys.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# Tool catalog with metadata
TOOL_CATALOG = {
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

# In-memory state (enabled/disabled, config)
_tool_state: Dict[str, Dict[str, Any]] = {}
_custom_skills: Dict[str, Dict[str, Any]] = {}


def _check_api_key(key: str) -> bool:
    """Check if an API key is set in environment."""
    return bool(os.environ.get(key))


def _get_tool_status(tool_id: str) -> Dict[str, Any]:
    """Get the status of a tool including enabled state and API key status."""
    catalog_entry = TOOL_CATALOG.get(tool_id, {})
    state = _tool_state.get(tool_id, {})
    
    required_keys = catalog_entry.get("required_keys", [])
    keys_configured = all(_check_api_key(k) for k in required_keys) if required_keys else True
    
    return {
        "id": tool_id,
        "enabled": state.get("enabled", True),
        "keys_configured": keys_configured,
        "required_keys": required_keys,
    }


class PraisonAISkills(BaseFeatureProtocol):
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
        return [{
            "name": "skills",
            "help": "Manage agent skills",
            "commands": {
                "list": {"help": "List all skills", "handler": self._cli_list},
                "status": {"help": "Show skill status", "handler": self._cli_status},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        enabled_count = sum(1 for s in _tool_state.values() if s.get("enabled", True))
        gateway_agents_with_tools = 0
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None:
                for aid in gw.list_agents():
                    gw_agent = gw.get_agent(aid)
                    if gw_agent and getattr(gw_agent, "tools", None):
                        gateway_agents_with_tools += 1
        except (ImportError, Exception):
            pass
        return {
            "status": "ok",
            "feature": self.name,
            "total_tools": len(TOOL_CATALOG),
            "custom_skills": len(_custom_skills),
            "enabled_tools": enabled_count,
            "gateway_agents_with_tools": gateway_agents_with_tools,
        }

    # ── API handlers ─────────────────────────────────────────────────

    async def _list(self, request: Request) -> JSONResponse:
        """List all available tools and skills."""
        category_filter = request.query_params.get("category")
        search = request.query_params.get("search", "").lower()
        
        tools = []
        for tool_id, info in TOOL_CATALOG.items():
            if category_filter and info.get("category") != category_filter:
                continue
            if search and search not in info.get("name", "").lower() and search not in info.get("description", "").lower():
                continue
            
            status = _get_tool_status(tool_id)
            tools.append({
                "id": tool_id,
                "name": info.get("name", tool_id),
                "description": info.get("description", ""),
                "category": info.get("category", "other"),
                "icon": info.get("icon", "🔧"),
                "type": "builtin",
                **status,
            })
        
        # Add custom skills
        for skill_id, skill in _custom_skills.items():
            if category_filter and skill.get("category") != category_filter:
                continue
            if search and search not in skill.get("name", "").lower():
                continue
            tools.append({
                **skill,
                "type": "custom",
                "enabled": _tool_state.get(skill_id, {}).get("enabled", True),
            })
        
        return JSONResponse({"skills": tools, "count": len(tools)})

    async def _categories(self, request: Request) -> JSONResponse:
        """List all tool categories."""
        categories = {}
        for info in TOOL_CATALOG.values():
            cat = info.get("category", "other")
            categories[cat] = categories.get(cat, 0) + 1
        
        return JSONResponse({
            "categories": [
                {"name": cat, "count": count}
                for cat, count in sorted(categories.items())
            ]
        })

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
        return JSONResponse(entry, status_code=201)

    async def _get(self, request: Request) -> JSONResponse:
        """Get details for a specific tool/skill."""
        skill_id = request.path_params["skill_id"]
        
        # Check catalog first
        if skill_id in TOOL_CATALOG:
            info = TOOL_CATALOG[skill_id]
            status = _get_tool_status(skill_id)
            return JSONResponse({
                "id": skill_id,
                "name": info.get("name", skill_id),
                "description": info.get("description", ""),
                "category": info.get("category", "other"),
                "icon": info.get("icon", "🔧"),
                "type": "builtin",
                **status,
            })
        
        # Check custom skills
        if skill_id in _custom_skills:
            skill = _custom_skills[skill_id]
            return JSONResponse({
                **skill,
                "type": "custom",
                "enabled": _tool_state.get(skill_id, {}).get("enabled", True),
            })
        
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
        
        return JSONResponse(_custom_skills[skill_id])

    async def _delete(self, request: Request) -> JSONResponse:
        """Delete a custom skill."""
        skill_id = request.path_params["skill_id"]
        if skill_id in TOOL_CATALOG:
            return JSONResponse({"error": "Cannot delete builtin tool"}, status_code=400)
        if skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        
        del _custom_skills[skill_id]
        _tool_state.pop(skill_id, None)
        return JSONResponse({"deleted": skill_id})

    async def _toggle(self, request: Request) -> JSONResponse:
        """Toggle a tool/skill enabled state."""
        skill_id = request.path_params["skill_id"]
        
        if skill_id not in TOOL_CATALOG and skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        
        if skill_id not in _tool_state:
            _tool_state[skill_id] = {"enabled": True}
        
        _tool_state[skill_id]["enabled"] = not _tool_state[skill_id].get("enabled", True)
        
        return JSONResponse({
            "id": skill_id,
            "enabled": _tool_state[skill_id]["enabled"],
        })

    async def _config(self, request: Request) -> JSONResponse:
        """Set configuration for a tool (e.g., API keys)."""
        skill_id = request.path_params["skill_id"]
        
        if skill_id not in TOOL_CATALOG and skill_id not in _custom_skills:
            return JSONResponse({"error": "Skill not found"}, status_code=404)
        
        body = await request.json()
        
        if skill_id not in _tool_state:
            _tool_state[skill_id] = {"enabled": True}
        
        _tool_state[skill_id]["config"] = body.get("config", {})
        
        # Note: In production, API keys would be set in environment
        # This is just for tracking configuration state
        
        return JSONResponse({
            "id": skill_id,
            "config_updated": True,
        })

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        lines = []
        for tool_id, info in TOOL_CATALOG.items():
            status = _get_tool_status(tool_id)
            icon = "✓" if status["enabled"] else "✗"
            lines.append(f"  [{icon}] {info['icon']} {info['name']}")
        return "\n".join(lines) if lines else "No tools available"

    def _cli_status(self) -> str:
        enabled = sum(1 for s in _tool_state.values() if s.get("enabled", True))
        return f"Tools: {len(TOOL_CATALOG)} builtin, {len(_custom_skills)} custom, {enabled} enabled"
