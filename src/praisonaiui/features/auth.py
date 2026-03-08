"""Auth feature — multi-mode authentication for PraisonAIUI.

Supports API key auth, session token auth, and configurable auth modes.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any, Dict, List, Optional

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from ._base import BaseFeatureProtocol

# Auth configuration
_auth_config: Dict[str, Any] = {
    "mode": "none",  # none, api_key, session, password
    "api_keys": {},  # key -> {name, created_at, last_used}
    "sessions": {},  # token -> {user, created_at, expires_at}
    "password_hash": None,  # hashed password for password mode
}

# Session tokens (in-memory)
_active_sessions: Dict[str, Dict[str, Any]] = {}


def generate_api_key() -> str:
    """Generate a secure API key."""
    return f"pk_{secrets.token_urlsafe(32)}"


def generate_session_token() -> str:
    """Generate a session token."""
    return secrets.token_urlsafe(32)


def hash_password(password: str) -> str:
    """Hash a password using SHA-256."""
    return hashlib.sha256(password.encode()).hexdigest()


def verify_api_key(key: str) -> Optional[Dict[str, Any]]:
    """Verify an API key and return its info."""
    if key in _auth_config["api_keys"]:
        info = _auth_config["api_keys"][key]
        info["last_used"] = time.time()
        return info
    return None


def verify_session_token(token: str) -> Optional[Dict[str, Any]]:
    """Verify a session token and return its info."""
    if token in _active_sessions:
        session = _active_sessions[token]
        if session.get("expires_at", 0) > time.time():
            return session
        else:
            # Expired
            del _active_sessions[token]
    return None


def check_auth(request: Request) -> Optional[Dict[str, Any]]:
    """Check authentication based on current mode."""
    mode = _auth_config.get("mode", "none")
    
    if mode == "none":
        return {"authenticated": True, "mode": "none"}
    
    # Check API key
    api_key = request.headers.get("X-API-Key") or request.query_params.get("api_key")
    if api_key:
        info = verify_api_key(api_key)
        if info:
            return {"authenticated": True, "mode": "api_key", "user": info.get("name")}
    
    # Check session token
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        session = verify_session_token(token)
        if session:
            return {"authenticated": True, "mode": "session", "user": session.get("user")}
    
    # Check session cookie
    session_cookie = request.cookies.get("aiui_session")
    if session_cookie:
        session = verify_session_token(session_cookie)
        if session:
            return {"authenticated": True, "mode": "session", "user": session.get("user")}
    
    return None


class PraisonAIAuth(BaseFeatureProtocol):
    """Multi-mode authentication feature."""

    feature_name = "auth"
    feature_description = "Multi-mode authentication (API key, session, password)"

    @property
    def name(self) -> str:
        return self.feature_name

    @property
    def description(self) -> str:
        return self.feature_description

    def routes(self) -> List[Route]:
        return [
            # Auth status
            Route("/api/auth/status", self._status, methods=["GET"]),
            Route("/api/auth/config", self._get_config, methods=["GET"]),
            Route("/api/auth/config", self._set_config, methods=["PUT"]),
            # API keys
            Route("/api/auth/keys", self._list_keys, methods=["GET"]),
            Route("/api/auth/keys", self._create_key, methods=["POST"]),
            Route("/api/auth/keys/{key_id}", self._revoke_key, methods=["DELETE"]),
            # Sessions
            Route("/api/auth/login", self._login, methods=["POST"]),
            Route("/api/auth/logout", self._logout, methods=["POST"]),
            Route("/api/auth/sessions", self._list_sessions, methods=["GET"]),
            # Password
            Route("/api/auth/password", self._set_password, methods=["POST"]),
        ]

    def cli_commands(self) -> List[Dict[str, Any]]:
        return [{
            "name": "auth",
            "help": "Authentication management",
            "commands": {
                "status": {"help": "Show auth status", "handler": self._cli_status},
                "create-key": {"help": "Create API key", "handler": self._cli_create_key},
                "list-keys": {"help": "List API keys", "handler": self._cli_list_keys},
                "set-mode": {"help": "Set auth mode", "handler": self._cli_set_mode},
            },
        }]

    async def health(self) -> Dict[str, Any]:
        from ._gateway_helpers import gateway_health

        return {
            "status": "ok",
            "feature": self.name,
            "mode": _auth_config.get("mode", "none"),
            "api_keys": len(_auth_config.get("api_keys", {})),
            "active_sessions": len(_active_sessions),
            **gateway_health(),
        }

    # ── Auth status ──────────────────────────────────────────────────

    async def _status(self, request: Request) -> JSONResponse:
        """GET /api/auth/status — Check current auth status."""
        auth_result = check_auth(request)
        if auth_result:
            return JSONResponse({
                "authenticated": True,
                "mode": auth_result.get("mode"),
                "user": auth_result.get("user"),
            })
        return JSONResponse({
            "authenticated": False,
            "mode": _auth_config.get("mode", "none"),
        })

    async def _get_config(self, request: Request) -> JSONResponse:
        """GET /api/auth/config — Get auth configuration."""
        return JSONResponse({
            "mode": _auth_config.get("mode", "none"),
            "api_keys_count": len(_auth_config.get("api_keys", {})),
            "sessions_count": len(_active_sessions),
            "password_set": _auth_config.get("password_hash") is not None,
        })

    async def _set_config(self, request: Request) -> JSONResponse:
        """PUT /api/auth/config — Update auth configuration."""
        body = await request.json()
        
        if "mode" in body:
            mode = body["mode"]
            if mode not in ("none", "api_key", "session", "password"):
                return JSONResponse({"error": "Invalid mode"}, status_code=400)
            _auth_config["mode"] = mode
        
        return JSONResponse({
            "mode": _auth_config.get("mode"),
            "updated": True,
        })

    # ── API keys ─────────────────────────────────────────────────────

    async def _list_keys(self, request: Request) -> JSONResponse:
        """GET /api/auth/keys — List API keys (without revealing full keys)."""
        keys = []
        for key, info in _auth_config.get("api_keys", {}).items():
            keys.append({
                "id": key[:12] + "...",
                "name": info.get("name", "Unnamed"),
                "created_at": info.get("created_at"),
                "last_used": info.get("last_used"),
            })
        return JSONResponse({"keys": keys})

    async def _create_key(self, request: Request) -> JSONResponse:
        """POST /api/auth/keys — Create a new API key."""
        body = await request.json()
        name = body.get("name", "API Key")
        
        key = generate_api_key()
        _auth_config["api_keys"][key] = {
            "name": name,
            "created_at": time.time(),
            "last_used": None,
        }
        
        return JSONResponse({
            "key": key,  # Only shown once!
            "name": name,
            "created_at": time.time(),
        })

    async def _revoke_key(self, request: Request) -> JSONResponse:
        """DELETE /api/auth/keys/{key_id} — Revoke an API key."""
        key_id = request.path_params["key_id"]
        
        # Find and delete key by prefix
        for key in list(_auth_config.get("api_keys", {}).keys()):
            if key.startswith(key_id.replace("...", "")):
                del _auth_config["api_keys"][key]
                return JSONResponse({"revoked": True})
        
        return JSONResponse({"error": "Key not found"}, status_code=404)

    # ── Sessions ─────────────────────────────────────────────────────

    async def _login(self, request: Request) -> JSONResponse:
        """POST /api/auth/login — Login with password."""
        body = await request.json()
        password = body.get("password", "")
        
        mode = _auth_config.get("mode", "none")
        
        if mode == "none":
            # No auth required
            token = generate_session_token()
            _active_sessions[token] = {
                "user": "anonymous",
                "created_at": time.time(),
                "expires_at": time.time() + 86400,  # 24 hours
            }
            return JSONResponse({"token": token, "expires_in": 86400})
        
        if mode == "password":
            stored_hash = _auth_config.get("password_hash")
            if stored_hash and hash_password(password) == stored_hash:
                token = generate_session_token()
                _active_sessions[token] = {
                    "user": "admin",
                    "created_at": time.time(),
                    "expires_at": time.time() + 86400,
                }
                return JSONResponse({"token": token, "expires_in": 86400})
            return JSONResponse({"error": "Invalid password"}, status_code=401)
        
        return JSONResponse({"error": "Login not supported in this mode"}, status_code=400)

    async def _logout(self, request: Request) -> JSONResponse:
        """POST /api/auth/logout — Logout current session."""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            if token in _active_sessions:
                del _active_sessions[token]
        
        session_cookie = request.cookies.get("aiui_session")
        if session_cookie and session_cookie in _active_sessions:
            del _active_sessions[session_cookie]
        
        return JSONResponse({"logged_out": True})

    async def _list_sessions(self, request: Request) -> JSONResponse:
        """GET /api/auth/sessions — List active sessions."""
        sessions = []
        for token, info in _active_sessions.items():
            sessions.append({
                "id": token[:8] + "...",
                "user": info.get("user"),
                "created_at": info.get("created_at"),
                "expires_at": info.get("expires_at"),
            })
        return JSONResponse({"sessions": sessions})

    # ── Password ─────────────────────────────────────────────────────

    async def _set_password(self, request: Request) -> JSONResponse:
        """POST /api/auth/password — Set or change password."""
        body = await request.json()
        new_password = body.get("password", "")
        
        if len(new_password) < 8:
            return JSONResponse({"error": "Password must be at least 8 characters"}, status_code=400)
        
        _auth_config["password_hash"] = hash_password(new_password)
        return JSONResponse({"password_set": True})

    # ── CLI handlers ─────────────────────────────────────────────────

    def _cli_status(self) -> str:
        mode = _auth_config.get("mode", "none")
        keys = len(_auth_config.get("api_keys", {}))
        sessions = len(_active_sessions)
        return f"Mode: {mode}\nAPI Keys: {keys}\nActive Sessions: {sessions}"

    def _cli_create_key(self, name: str = "CLI Key") -> str:
        key = generate_api_key()
        _auth_config["api_keys"][key] = {
            "name": name,
            "created_at": time.time(),
            "last_used": None,
        }
        return f"Created API key: {key}"

    def _cli_list_keys(self) -> str:
        keys = _auth_config.get("api_keys", {})
        if not keys:
            return "No API keys"
        lines = ["API Keys:"]
        for key, info in keys.items():
            lines.append(f"  {key[:12]}... - {info.get('name', 'Unnamed')}")
        return "\n".join(lines)

    def _cli_set_mode(self, mode: str = "none") -> str:
        if mode not in ("none", "api_key", "session", "password"):
            return f"Invalid mode: {mode}. Use: none, api_key, session, password"
        _auth_config["mode"] = mode
        return f"Auth mode set to: {mode}"
