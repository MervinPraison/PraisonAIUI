"""Authentication module for PraisonAIUI."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import Any, Callable, Optional, Protocol

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


class User:
    """User data class for authentication callbacks."""

    def __init__(
        self,
        identifier: str,
        display_name: str = "",
        metadata: Optional[dict[str, Any]] = None,
    ):
        self.identifier = identifier
        self.display_name = display_name or identifier
        self.metadata = metadata or {}

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary representation."""
        return {
            "identifier": self.identifier,
            "display_name": self.display_name,
            "metadata": self.metadata,
        }


class Session:
    """Session data class for auth callbacks."""

    def __init__(self, session_id: str, user_id: str, tokens: dict[str, Any]):
        self.session_id = session_id
        self.user_id = user_id
        self.tokens = tokens

    async def clear_tokens(self) -> None:
        """Clear all tokens for this session."""
        # Clear JWT tokens from global store efficiently using user mapping
        if self.user_id in _user_tokens:
            for token in list(_user_tokens[self.user_id]):
                _tokens.pop(token, None)
            del _user_tokens[self.user_id]


class OAuthCallbackProtocol(Protocol):
    """Protocol for OAuth callback handlers."""

    async def __call__(
        self,
        provider: str,
        token: dict[str, Any],
        raw_user: dict[str, Any],
        default_user: User,
    ) -> Optional[User]:
        """Handle OAuth callback.
        
        Args:
            provider: OAuth provider name (e.g., "github", "google")
            token: OAuth token data from provider
            raw_user: Raw user data from provider API
            default_user: Default User instance based on OAuth data
            
        Returns:
            User instance to accept login, None to deny
        """
        ...


class HeaderAuthCallbackProtocol(Protocol):
    """Protocol for header-based authentication."""

    async def __call__(self, headers: dict[str, str]) -> Optional[User]:
        """Authenticate user from request headers.
        
        Args:
            headers: Request headers dict
            
        Returns:
            User instance if authenticated, None if not
        """
        ...


class PasswordAuthCallbackProtocol(Protocol):
    """Protocol for password authentication callback."""

    async def __call__(self, username: str, password: str) -> Optional[User]:
        """Handle password authentication.
        
        Args:
            username: Username
            password: Password
            
        Returns:
            User instance if authenticated, None if not
        """
        ...


class OnLogoutCallbackProtocol(Protocol):
    """Protocol for logout callback."""

    async def __call__(self, user: User, session: Session) -> None:
        """Handle user logout.
        
        Args:
            user: User instance
            session: Session instance
        """
        ...


# Registry for auth callbacks (lazy-loaded)
_oauth_callbacks: dict[str, OAuthCallbackProtocol] = {}
_header_auth_callback: Optional[HeaderAuthCallbackProtocol] = None
_password_auth_callback: Optional[PasswordAuthCallbackProtocol] = None
_on_logout_callback: Optional[OnLogoutCallbackProtocol] = None

# Legacy storage (backward compatibility)
_users: dict[str, dict[str, Any]] = {}
_tokens: dict[str, dict[str, Any]] = {}
# User to tokens mapping for O(1) token revocation
_user_tokens: dict[str, set[str]] = {}
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
    # Add to user mapping for efficient revocation
    if user_id not in _user_tokens:
        _user_tokens[user_id] = set()
    _user_tokens[user_id].add(token)
    return token


def validate_token(token: str) -> Optional[str]:
    """Validate a token and return user_id if valid."""
    if token not in _tokens:
        return None
    token_data = _tokens[token]
    if datetime.utcnow() > token_data["expires_at"]:
        user_id = token_data["user_id"]
        del _tokens[token]
        # Remove from user mapping
        if user_id in _user_tokens:
            _user_tokens[user_id].discard(token)
            if not _user_tokens[user_id]:  # Remove empty set
                del _user_tokens[user_id]
        return None
    return token_data["user_id"]


def revoke_token(token: str) -> bool:
    """Revoke a token."""
    if token in _tokens:
        user_id = _tokens[token].get("user_id")
        del _tokens[token]
        # Remove from user mapping
        if user_id and user_id in _user_tokens:
            _user_tokens[user_id].discard(token)
            if not _user_tokens[user_id]:  # Remove empty set
                del _user_tokens[user_id]
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
            return JSONResponse({
                "id": user["id"],
                "username": user["username"],
            })
    return JSONResponse({"error": "Unauthorized"}, status_code=401)


# ── New Auth Decorators ────────────────────────────────────────────────

def oauth_callback(provider: str):
    """Register an OAuth callback for a specific provider.
    
    Args:
        provider: OAuth provider name (e.g., "github", "google", "azure", "okta")
        
    Example:
        @aiui.oauth_callback("github")
        async def on_github_login(provider, token, raw_user, default_user):
            return aiui.User(
                identifier=f"github:{raw_user['login']}",
                display_name=raw_user["name"],
                metadata={"avatar": raw_user["avatar_url"]},
            )
    """
    def decorator(func: OAuthCallbackProtocol) -> OAuthCallbackProtocol:
        _oauth_callbacks[provider] = func
        return func
    return decorator


def header_auth_callback(func: HeaderAuthCallbackProtocol) -> HeaderAuthCallbackProtocol:
    """Register a header-based authentication callback.
    
    Example:
        @aiui.header_auth_callback
        async def on_header_auth(headers):
            email = headers.get("x-auth-request-email")
            if email:
                return aiui.User(identifier=email, display_name=email.split("@")[0])
            return None
    """
    global _header_auth_callback
    _header_auth_callback = func
    return func


def password_auth_callback(func: PasswordAuthCallbackProtocol) -> PasswordAuthCallbackProtocol:
    """Register an explicit password authentication callback.
    
    Example:
        @aiui.password_auth_callback
        async def on_password_auth(username, password):
            # Custom password validation logic
            if validate_ldap(username, password):
                return aiui.User(identifier=username, display_name=username)
            return None
    """
    global _password_auth_callback
    _password_auth_callback = func
    return func


def on_logout(func: OnLogoutCallbackProtocol) -> OnLogoutCallbackProtocol:
    """Register a logout callback for server-side cleanup.
    
    Example:
        @aiui.on_logout
        async def cleanup(user, session):
            await session.clear_tokens()
            logger.info("user %s logged out", user.identifier)
    """
    global _on_logout_callback
    _on_logout_callback = func
    return func


# ── Enhanced Authentication Logic ──────────────────────────────────────

async def authenticate_with_headers(request: Request) -> Optional[User]:
    """Authenticate using header auth callback if registered."""
    if not _header_auth_callback:
        return None

    # Convert Starlette headers to dict
    headers = {}
    for name, value in request.headers.items():
        headers[name.lower()] = value

    try:
        return await _header_auth_callback(headers)
    except Exception:
        return None


async def authenticate_with_password(username: str, password: str) -> Optional[User]:
    """Enhanced password authentication with custom callback support."""
    # Try custom password callback first
    if _password_auth_callback:
        try:
            return await _password_auth_callback(username, password)
        except Exception:
            pass

    # Fallback to legacy authentication
    if username not in _users:
        return None
    user_data = _users[username]
    if not verify_password(password, user_data["password_hash"]):
        return None

    return User(
        identifier=user_data["id"],
        display_name=user_data["username"],
    )


async def handle_logout_with_callback(user: User, session: Session) -> None:
    """Handle logout with optional callback."""
    if _on_logout_callback:
        try:
            await _on_logout_callback(user, session)
        except Exception:
            pass  # Don't fail logout on callback errors


# ── Enhanced Auth Handlers ─────────────────────────────────────────────

async def enhanced_login_handler(request: Request) -> JSONResponse:
    """Enhanced login handler with header auth support."""
    # Try header authentication first
    user = await authenticate_with_headers(request)
    if user:
        token = create_token(user.identifier)
        return JSONResponse({
            "user": user.to_dict(),
            "token": token,
        })

    # Fall back to password authentication
    return await login_handler(request)


async def enhanced_logout_handler(request: Request) -> JSONResponse:
    """Enhanced logout handler with callback support."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        user_id = validate_token(token)
        if user_id:
            # Create User and Session instances for callback
            user = User(identifier=user_id, display_name=user_id)
            session = Session(session_id="", user_id=user_id, tokens={token: True})

            # Call logout callback
            await handle_logout_with_callback(user, session)

            # Revoke token
            revoke_token(token)

    return JSONResponse({"status": "logged_out"})
