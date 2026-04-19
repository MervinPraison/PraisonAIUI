"""Authentication module for PraisonAIUI."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# User storage (in-memory for now, can be replaced with database)
_users: dict[str, dict[str, Any]] = {}
_tokens: dict[str, dict[str, Any]] = {}
_login_callback: Optional[Callable] = None

TOKEN_EXPIRY_HOURS = 24

# Try to import bcrypt, fall back to hashlib if not available
try:
    import bcrypt

    _HAS_BCRYPT = True
except ImportError:
    import hashlib

    _HAS_BCRYPT = False


def hash_password(password: str) -> str:
    """Hash a password using bcrypt (preferred) or SHA-256 (fallback)."""
    if _HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    # Fallback to SHA-256 if bcrypt not installed
    return hashlib.sha256(password.encode()).hexdigest()


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash."""
    if _HAS_BCRYPT:
        try:
            return bcrypt.checkpw(password.encode(), hashed.encode())
        except ValueError:
            # If hash is not bcrypt format, try SHA-256 comparison
            return hashlib.sha256(password.encode()).hexdigest() == hashed
    return hashlib.sha256(password.encode()).hexdigest() == hashed


def create_token(user_id: str) -> str:
    """Create a new authentication token."""
    token = secrets.token_urlsafe(32)
    _tokens[token] = {
        "user_id": user_id,
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(hours=TOKEN_EXPIRY_HOURS),
    }
    return token


def validate_token(token: str) -> Optional[str]:
    """Validate a token and return user_id if valid."""
    if token not in _tokens:
        return None
    token_data = _tokens[token]
    if datetime.utcnow() > token_data["expires_at"]:
        del _tokens[token]
        return None
    return token_data["user_id"]


def revoke_token(token: str) -> bool:
    """Revoke a token."""
    if token in _tokens:
        del _tokens[token]
        return True
    return False


def register_user(username: str, password: str, **extra: Any) -> dict[str, Any]:
    """Register a new user."""
    if username in _users:
        raise ValueError("User already exists")
    user = {
        "id": username,
        "username": username,
        "password_hash": hash_password(password),
        "created_at": datetime.utcnow().isoformat(),
        **extra,
    }
    _users[username] = user
    return {"id": username, "username": username}


def authenticate_user(username: str, password: str) -> Optional[dict[str, Any]]:
    """Authenticate a user with username and password."""
    if username not in _users:
        return None
    user = _users[username]
    if not verify_password(password, user["password_hash"]):
        return None
    return {"id": user["id"], "username": user["username"]}


def set_login_callback(callback: Callable) -> None:
    """Set the custom login callback."""
    global _login_callback
    _login_callback = callback


async def handle_login(username: str, password: str) -> Optional[dict[str, Any]]:
    """Handle login with optional custom callback."""
    if _login_callback:
        import asyncio

        result = _login_callback(username, password)
        if asyncio.iscoroutine(result):
            result = await result
        if result:
            return {"id": username, "username": username, "token": create_token(username)}
        return None
    user = authenticate_user(username, password)
    if user:
        user["token"] = create_token(user["id"])
        return user
    return None


class AuthMiddleware(BaseHTTPMiddleware):
    """Authentication middleware for Starlette."""

    def __init__(self, app, require_auth: bool = False, exclude_paths: list[str] = None):
        super().__init__(app)
        self.require_auth = require_auth
        self.exclude_paths = exclude_paths or ["/health", "/login", "/register"]

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        path = request.url.path

        # Skip auth for excluded paths
        if any(path.startswith(p) for p in self.exclude_paths):
            return await call_next(request)

        # Skip auth if not required
        if not self.require_auth:
            return await call_next(request)

        # Check for token in header
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            user_id = validate_token(token)
            if user_id:
                request.state.user_id = user_id
                return await call_next(request)

        return JSONResponse(
            {"error": "Unauthorized"},
            status_code=401,
        )


# Auth route handlers
async def login_handler(request: Request) -> JSONResponse:
    """Handle login requests."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    username = body.get("username", "")
    password = body.get("password", "")

    if not username or not password:
        return JSONResponse({"error": "Username and password required"}, status_code=400)

    result = await handle_login(username, password)
    if result:
        return JSONResponse(result)
    return JSONResponse({"error": "Invalid credentials"}, status_code=401)


async def register_handler(request: Request) -> JSONResponse:
    """Handle registration requests."""
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    username = body.get("username", "")
    password = body.get("password", "")

    if not username or not password:
        return JSONResponse({"error": "Username and password required"}, status_code=400)

    try:
        user = register_user(username, password)
        token = create_token(user["id"])
        return JSONResponse({"user": user, "token": token})
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def logout_handler(request: Request) -> JSONResponse:
    """Handle logout requests."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        revoke_token(token)
    return JSONResponse({"status": "logged_out"})


async def me_handler(request: Request) -> JSONResponse:
    """Get current user info."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        user_id = validate_token(token)
        if user_id and user_id in _users:
            user = _users[user_id]
            return JSONResponse(
                {
                    "id": user["id"],
                    "username": user["username"],
                }
            )
    return JSONResponse({"error": "Unauthorized"}, status_code=401)
