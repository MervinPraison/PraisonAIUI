"""Authentication module for PraisonAIUI."""

from __future__ import annotations

import hmac
import secrets
from datetime import datetime, timedelta
from typing import Any, Callable, Iterable, Optional, Protocol

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, RedirectResponse, Response

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


# ── OAuth / header / session extensions (issue #22) ──

_oauth_callbacks: dict[str, OAuthCallbackProtocol] = {}
_header_auth_callback: Optional[HeaderAuthCallbackProtocol] = None
_password_auth_callback: Optional[PasswordAuthCallbackProtocol] = None
_on_logout_callback: Optional[OnLogoutCallbackProtocol] = None
_user_tokens: dict[str, set[str]] = {}


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
        return JSONResponse(
            {
                "user": user.to_dict(),
                "token": token,
            }
        )

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


def _constant_time_eq(a: str, b: str) -> bool:
    """Compare two strings in constant time to prevent timing attacks."""
    return hmac.compare_digest(a.encode(), b.encode())


_LOGIN_FORM_HTML = """<!DOCTYPE html>
<html>
<head>
    <title>Authentication Required</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { font-family: system-ui, sans-serif; max-width: 400px; margin: 100px auto; padding: 20px; }
        .form { background: #f5f5f5; padding: 20px; border-radius: 8px; }
        input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 4px; }
        button { width: 100%; padding: 12px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0056b3; }
    </style>
</head>
<body>
    <div class="form">
        <h2>Authentication Required</h2>
        <form method="get">
            <input type="password" name="token" placeholder="Enter access token" required>
            <button type="submit">Access Dashboard</button>
        </form>
    </div>
</body>
</html>"""


class TokenQueryMiddleware:
    """Authenticates requests that carry ?token=<SECRET> in the URL or
    Authorization: Bearer <SECRET> in the header.

    On first hit, the query-param token is validated; the middleware sets a
    session cookie (httpOnly, SameSite=Lax, Secure when https) so the token
    doesn't need to be re-sent on every asset request, and emits a redirect
    that strips ?token from window.location. This matches Jupyter's model.
    """

    EXEMPT_PATHS = {"/health", "/api/health"}
    COOKIE_NAME = "praisonaiui_token"

    def __init__(
        self,
        app,
        *,
        expected_token: str,
        exempt_paths: Optional[Iterable[str]] = None
    ):
        self.app = app
        self.expected_token = expected_token
        self.exempt = set(self.EXEMPT_PATHS) | set(exempt_paths or ())

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.expected_token:
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if any(path.startswith(p) for p in self.exempt):
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive)

        # 1. Already authed via cookie?
        if _constant_time_eq(
            request.cookies.get(self.COOKIE_NAME, ""),
            self.expected_token,
        ):
            await self.app(scope, receive, send)
            return

        # 2. Bearer header?
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer ") and _constant_time_eq(
            auth[7:], self.expected_token
        ):
            await self.app(scope, receive, send)
            return

        # 3. ?token=… query param? → set cookie, redirect to same URL
        #    minus the token so it doesn't leak via Referer / history.
        qs_token = request.query_params.get("token", "")
        if qs_token and _constant_time_eq(qs_token, self.expected_token):
            clean_qs = {k: v for k, v in request.query_params.items()
                        if k != "token"}
            clean_url = str(request.url.replace_query_params(**clean_qs))
            response = RedirectResponse(clean_url, status_code=303)
            response.set_cookie(
                self.COOKIE_NAME,
                self.expected_token,
                httponly=True,
                samesite="lax",
                secure=request.url.scheme == "https",
                max_age=60 * 60 * 24,  # 24h
            )
            await response(scope, receive, send)
            return

        # 4. No auth → 401 JSON for /api/*, minimal login form for HTML.
        if path.startswith("/api/"):
            response = JSONResponse(
                {"error": "Unauthorized",
                 "hint": "Append ?token=<SECRET> to the URL or send "
                         "Authorization: Bearer <SECRET>."},
                status_code=401,
            )
        else:
            response = HTMLResponse(_LOGIN_FORM_HTML, status_code=401)
        await response(scope, receive, send)


# ── PraisonAIUI-native aliases ──────────────────────────────────────
# "on_*" verb form reads as "do this when …" which is far clearer to
# non-developers than the "*_callback" suffix.  Original names remain
# importable for backward compatibility.

on_oauth_login = oauth_callback
on_header_login = header_auth_callback
on_password_login = password_auth_callback
