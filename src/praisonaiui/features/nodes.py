"""Nodes feature — execution node and instance/presence management.

Provides API endpoints and CLI commands for managing distributed
execution nodes, device pairing, and connected instance presence.
"""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict, List

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# In-memory node & instance registries
_nodes: Dict[str, Dict[str, Any]] = {}
_instances: Dict[str, Dict[str, Any]] = {}


class PraisonAINodes(BaseFeatureProtocol):
    """Node management and instance presence monitoring."""

    feature_name = "nodes"
    feature_description = "Execution nodes and connected instance management"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            # Nodes
            Route("/api/nodes", self._list_nodes, methods=["GET"]),
            Route("/api/nodes", self._register_node, methods=["POST"]),
            # Instances / Presence (MUST be before {node_id} wildcard routes)
            Route("/api/nodes/instances", self._list_instances, methods=["GET"]),
            Route("/api/instances", self._list_instances, methods=["GET"]),
            Route("/api/instances/heartbeat", self._heartbeat, methods=["POST"]),
            # Wildcard routes
            Route("/api/nodes/{node_id}", self._get_node, methods=["GET"]),
            Route("/api/nodes/{node_id}", self._update_node, methods=["PUT"]),
            Route("/api/nodes/{node_id}", self._delete_node, methods=["DELETE"]),
            Route("/api/nodes/{node_id}/status", self._node_status, methods=["GET"]),
            Route("/api/nodes/{node_id}/agents", self._node_agents, methods=["GET", "PUT"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "node",
            "help": "Manage execution nodes",
            "commands": {
                "list": {"help": "List registered nodes", "handler": self._cli_list},
                "instances": {"help": "Show connected instances", "handler": self._cli_instances},
                "status": {"help": "Show node status", "handler": self._cli_status},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        online = sum(1 for n in _nodes.values() if n.get("status") == "online")
        return {
            "status": "ok",
            "feature": self.name,
            "total_nodes": len(_nodes),
            "online_nodes": online,
            "connected_instances": len(_instances),
        }

    # ── Node API handlers ────────────────────────────────────────────

    async def _list_nodes(self, request: Request) -> JSONResponse:
        return JSONResponse({"nodes": list(_nodes.values()), "count": len(_nodes)})

    async def _register_node(self, request: Request) -> JSONResponse:
        body = await request.json()
        node_id = body.get("id", uuid.uuid4().hex[:12])
        entry = {
            "id": node_id,
            "name": body.get("name", node_id),
            "host": body.get("host", "localhost"),
            "platform": body.get("platform", "unknown"),
            "status": "online",
            "agents": body.get("agents", []),
            "token": uuid.uuid4().hex[:16],
            "approval_policy": body.get("approval_policy", "deny"),
            "created_at": time.time(),
            "last_heartbeat": time.time(),
        }
        _nodes[node_id] = entry
        return JSONResponse(entry, status_code=201)

    async def _get_node(self, request: Request) -> JSONResponse:
        node_id = request.path_params["node_id"]
        node = _nodes.get(node_id)
        if not node:
            return JSONResponse({"error": "Node not found"}, status_code=404)
        return JSONResponse(node)

    async def _update_node(self, request: Request) -> JSONResponse:
        node_id = request.path_params["node_id"]
        node = _nodes.get(node_id)
        if not node:
            return JSONResponse({"error": "Node not found"}, status_code=404)
        body = await request.json()
        for key in ("name", "host", "agents", "approval_policy"):
            if key in body:
                node[key] = body[key]
        return JSONResponse(node)

    async def _delete_node(self, request: Request) -> JSONResponse:
        node_id = request.path_params["node_id"]
        if node_id not in _nodes:
            return JSONResponse({"error": "Node not found"}, status_code=404)
        del _nodes[node_id]
        return JSONResponse({"deleted": node_id})

    async def _node_status(self, request: Request) -> JSONResponse:
        node_id = request.path_params["node_id"]
        node = _nodes.get(node_id)
        if not node:
            return JSONResponse({"error": "Node not found"}, status_code=404)
        age = time.time() - node.get("last_heartbeat", 0)
        if age > 120:
            node["status"] = "offline"
        result = {
            "id": node_id,
            "name": node["name"],
            "status": node["status"],
            "last_heartbeat": node.get("last_heartbeat"),
            "heartbeat_age_seconds": round(age, 1),
        }
        # Enrich with gateway data when available
        try:
            from ._gateway_ref import get_gateway
            gw = get_gateway()
            if gw is not None and hasattr(gw, 'health'):
                gw_health = gw.health()
                result["gateway"] = {
                    "agents": gw_health.get("agents", 0),
                    "sessions": gw_health.get("sessions", 0),
                    "clients": gw_health.get("clients", 0),
                }
        except Exception:
            pass
        return JSONResponse(result)

    async def _node_agents(self, request: Request) -> JSONResponse:
        node_id = request.path_params["node_id"]
        node = _nodes.get(node_id)
        if not node:
            return JSONResponse({"error": "Node not found"}, status_code=404)
        if request.method == "PUT":
            body = await request.json()
            node["agents"] = body.get("agents", [])
        return JSONResponse({"node_id": node_id, "agents": node.get("agents", [])})

    # ── Instance / Presence API handlers ─────────────────────────────

    async def _list_instances(self, request: Request) -> JSONResponse:
        # Clean up stale instances (> 5 min no heartbeat)
        now = time.time()
        stale = [k for k, v in _instances.items() if now - v.get("last_seen", 0) > 300]
        for k in stale:
            del _instances[k]
        return JSONResponse({
            "instances": list(_instances.values()),
            "count": len(_instances),
        })

    async def _heartbeat(self, request: Request) -> JSONResponse:
        """Record a presence heartbeat from a connected instance."""
        body = await request.json()
        instance_id = body.get("id", uuid.uuid4().hex[:12])
        entry = _instances.get(instance_id, {})
        entry.update({
            "id": instance_id,
            "host": body.get("host", "unknown"),
            "platform": body.get("platform", "unknown"),
            "version": body.get("version", "unknown"),
            "roles": body.get("roles", []),
            "mode": body.get("mode", "client"),
            "last_seen": time.time(),
        })
        _instances[instance_id] = entry
        return JSONResponse({"status": "ok", "instance_id": instance_id})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_list(self) -> str:
        if not _nodes:
            return "No nodes registered"
        lines = []
        for n in _nodes.values():
            status = "●" if n.get("status") == "online" else "○"
            lines.append(f"  [{status}] {n['id']} — {n['name']} ({n['host']})")
        return "\n".join(lines)

    def _cli_instances(self) -> str:
        if not _instances:
            return "No connected instances"
        lines = []
        for i in _instances.values():
            lines.append(f"  {i['id']} — {i['host']} ({i['mode']}) v{i.get('version', '?')}")
        return "\n".join(lines)

    def _cli_status(self) -> str:
        online = sum(1 for n in _nodes.values() if n.get("status") == "online")
        return f"Nodes: {len(_nodes)} total, {online} online | Instances: {len(_instances)} connected"
