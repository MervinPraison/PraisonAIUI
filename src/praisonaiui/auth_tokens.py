"""Signed, stateless session tokens: ``v1.<base64url {sub, iat, exp, jti}>.<HMAC-SHA256>``.

Any process holding the secret verifies a token without a lookup, so sessions
survive restarts and work on every worker. Secret: ``AIUI_AUTH_SECRET``
(comma-separated to rotate: the first signs, all verify), else generated once
into ``<data dir>/auth_secret`` (0600). Sign-outs go to
``<data dir>/auth_revoked.jsonl`` until the tokens they name expire.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

TOKEN_VERSION = "v1"
SECRET_ENV = "AIUI_AUTH_SECRET"
LIFETIME_ENV = "AIUI_SESSION_LIFETIME"
DEFAULT_LIFETIME_S = 14 * 24 * 3600
DEFAULT_COOKIE_NAME = "aiui_session"
SECRET_FILE = "auth_secret"
REVOKED_FILE = "auth_revoked.jsonl"
_COMPACT_AT = 1000  # rewrite the revocation file without expired lines past this many lines
_SAMESITE = ("lax", "strict", "none")


def _now() -> float:
    return time.time()


def create_secret() -> str:
    """A new random signing secret (64 url-safe characters)."""
    return secrets.token_urlsafe(48)


def data_dir() -> Path:
    return Path(os.environ.get("AIUI_DATA_DIR") or Path.home() / ".praisonaiui").expanduser()


_UNITS = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800}


def parse_lifetime(value: Any) -> int:
    """Seconds from ``3600``, ``"90m"``, ``"12h"``, ``"14d"`` or ``"2w"``."""
    if isinstance(value, bool):
        raise ValueError(f"invalid session lifetime: {value!r}")
    if isinstance(value, (int, float)):
        seconds = int(value)
    else:
        match = re.fullmatch(r"\s*(\d+)\s*([smhdw]?)\s*", str(value or "").lower())
        if not match:
            raise ValueError(f"invalid session lifetime: {value!r} (use e.g. 3600, 12h, 14d)")
        seconds = int(match.group(1)) * _UNITS[match.group(2) or "s"]
    if seconds <= 0:
        raise ValueError(f"session lifetime must be positive: {value!r}")
    return seconds


@dataclass
class SessionSettings:
    lifetime: int = DEFAULT_LIFETIME_S
    cookie_name: str = DEFAULT_COOKIE_NAME
    same_site: str = "lax"
    cookie_path: Optional[str] = None  # None: the app's root path
    secure: Optional[bool] = None  # None: when the request came over https


_settings = SessionSettings()


def configure(config: Optional[dict] = None) -> SessionSettings:
    """Read YAML ``auth.sessionLifetime`` and ``auth.cookie``; env ``AIUI_SESSION_LIFETIME`` wins."""
    global _settings
    auth = (config or {}).get("auth") or {}
    cookie = auth.get("cookie") or {}
    lifetime = os.environ.get(LIFETIME_ENV) or auth.get("sessionLifetime") or auth.get("session_lifetime")
    same_site = str(cookie.get("sameSite") or cookie.get("same_site") or "lax").lower()
    if same_site not in _SAMESITE:
        raise ValueError(f"auth.cookie.sameSite must be one of {', '.join(_SAMESITE)}")
    _settings = SessionSettings(
        lifetime=parse_lifetime(lifetime) if lifetime else DEFAULT_LIFETIME_S,
        cookie_name=str(cookie.get("name") or DEFAULT_COOKIE_NAME),
        same_site=same_site,
        cookie_path=cookie.get("path") or None,
        secure=cookie.get("secure"),
    )
    return _settings


def settings() -> SessionSettings:
    return _settings


_keys_lock = threading.Lock()
_keys_cache: dict[tuple[str, str], tuple[bytes, ...]] = {}


def _file_secret(path: Path) -> str:
    """Read the secret file, creating it (0600, atomically) the first time."""
    try:
        return _checked(path, path.read_text(encoding="utf-8").strip())
    except FileNotFoundError:
        pass
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(create_secret() + "\n")
    try:
        os.link(tmp, path)  # fails if another worker created it first: use theirs
        logger.info("Generated a session signing secret in %s", path)
    except FileExistsError:
        pass
    except OSError:  # a filesystem without hard links
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)
    return _checked(path, path.read_text(encoding="utf-8").strip())


def _checked(path: Path, secret: str) -> str:
    if len(secret) < 32:  # an empty key would sign tokens anyone can forge
        raise RuntimeError(f"{path} holds no usable secret; delete it to generate a new one")
    return secret


def signing_keys() -> tuple[bytes, ...]:
    """HMAC keys, the signing key first (from ``AIUI_AUTH_SECRET`` or the secret file)."""
    raw = os.environ.get(SECRET_ENV, "")
    cache_key = (raw, str(data_dir()))
    keys = _keys_cache.get(cache_key)
    if keys is not None:
        return keys
    with _keys_lock:
        secrets_ = [s.strip() for s in raw.split(",") if s.strip()]
        if not secrets_:
            secrets_ = [_file_secret(data_dir() / SECRET_FILE)]
        elif any(len(s) < 32 for s in secrets_):
            logger.warning("%s is shorter than 32 characters; use `aiui auth create-secret`", SECRET_ENV)
        # Domain-separated, so the same secret reused elsewhere signs nothing here.
        keys = tuple(
            hmac.new(s.encode(), b"aiui.session." + TOKEN_VERSION.encode(), hashlib.sha256).digest()
            for s in secrets_
        )
        _keys_cache.clear()
        _keys_cache[cache_key] = keys
    return keys


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(key: bytes, body: str) -> str:
    return _b64(hmac.new(key, body.encode("ascii"), hashlib.sha256).digest())


def is_signed(token: str) -> bool:
    return bool(token) and token.startswith(TOKEN_VERSION + ".")


def issue(user_id: str, lifetime: Optional[int] = None) -> str:
    """A signed session token for *user_id*."""
    now = _now()
    exp = int(now + (lifetime or _settings.lifetime))
    claims = {"sub": str(user_id), "iat": round(now, 3), "exp": exp, "jti": secrets.token_urlsafe(12)}
    body = TOKEN_VERSION + "." + _b64(json.dumps(claims, separators=(",", ":")).encode())
    return body + "." + _sign(signing_keys()[0], body)


def verify(token: str) -> Optional[dict[str, Any]]:
    """The claims of a valid, unexpired, unrevoked token, else ``None``."""
    if not is_signed(token) or token.count(".") != 2 or not token.isascii():
        return None
    body, _, sig = token.rpartition(".")
    if not any(hmac.compare_digest(_sign(key, body), sig) for key in signing_keys()):
        return None
    try:
        claims = json.loads(_unb64(body.split(".", 1)[1]))
        sub, iat, exp, jti = claims["sub"], float(claims["iat"]), float(claims["exp"]), claims["jti"]
    except (ValueError, KeyError, TypeError):
        return None
    if not isinstance(sub, str) or exp <= _now() or _revocations.revoked(jti, sub, iat):
        return None
    return claims


def needs_refresh(claims: dict[str, Any]) -> bool:
    """Sliding sessions: past half its lifetime a token in use is re-issued."""
    return _now() >= (float(claims["iat"]) + float(claims["exp"])) / 2


def _live_entries(path: Path) -> list[dict]:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return []
    out, now = [], _now()
    for line in lines:
        try:
            entry = json.loads(line)
            if float(entry["exp"]) > now:
                out.append(entry)
        except (ValueError, KeyError, TypeError):
            continue
    return out


class _Revocations:
    """Append-only sign-out log in the data directory, re-read when it changes."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stamp: Optional[tuple] = None
        self._jtis: set[str] = set()
        self._users: dict[str, float] = {}

    def revoked(self, jti: str, sub: str, iat: float) -> bool:
        path = data_dir() / REVOKED_FILE
        with self._lock:
            try:
                st = path.stat()
                stamp: Optional[tuple] = (str(path), st.st_ino, st.st_mtime_ns, st.st_size)
            except FileNotFoundError:
                stamp = None
            if stamp != self._stamp:
                entries = _live_entries(path) if stamp else []
                self._jtis = {str(e["jti"]) for e in entries if "jti" in e}
                self._users = {}
                for e in (e for e in entries if "sub" in e):
                    self._users[str(e["sub"])] = max(self._users.get(str(e["sub"]), 0.0), float(e["at"]))
                self._stamp = stamp
            return jti in self._jtis or iat <= self._users.get(sub, -1.0)

    def add(self, entry: dict) -> None:
        path = data_dir() / REVOKED_FILE
        path.parent.mkdir(parents=True, exist_ok=True)
        while True:  # lock the file that is still at *path* (a compaction may replace it)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            _flock(fd)
            if os.path.exists(path) and os.fstat(fd).st_ino == os.stat(path).st_ino:
                break
            os.close(fd)
        try:
            os.write(fd, (json.dumps(entry, separators=(",", ":")) + "\n").encode())
            if os.fstat(fd).st_size > _COMPACT_AT * 120:  # drop expired lines
                tmp = path.with_name(f".{path.name}.{os.getpid()}")
                live = "".join(json.dumps(e, separators=(",", ":")) + "\n" for e in _live_entries(path))
                tmp.write_text(live, encoding="utf-8")
                os.chmod(tmp, 0o600)
                os.replace(tmp, path)
        finally:
            os.close(fd)  # releases the lock


def _flock(fd: int) -> None:
    try:
        import fcntl
    except ImportError:  # Windows: appends stay atomic; compaction may race
        return
    fcntl.flock(fd, fcntl.LOCK_EX)


_revocations = _Revocations()


def revoke(token: str) -> bool:
    """Sign out one token (until it would have expired). True if it was valid."""
    claims = verify(token)
    if not claims:
        return False
    _revocations.add({"jti": claims["jti"], "exp": claims["exp"]})
    return True


def revoke_user(user_id: str) -> None:
    """Sign *user_id* out everywhere: every token issued until now stops working."""
    now = _now()
    _revocations.add({"sub": str(user_id), "at": round(now, 3), "exp": int(now + _settings.lifetime)})


def _https(scope: dict) -> bool:
    proto = dict(scope.get("headers") or ()).get(b"x-forwarded-proto", b"").split(b",")[0]
    return scope.get("scheme") in ("https", "wss") or proto.strip().lower() == b"https"


def cookie_header(scope: dict, token: str, *, clear: bool = False) -> str:
    """The ``Set-Cookie`` value that stores (or with *clear*, deletes) the session."""
    s = _settings
    path = s.cookie_path or (scope.get("root_path") or "").rstrip("/") or "/"
    secure = s.secure if s.secure is not None else _https(scope)
    parts = [f"{s.cookie_name}={'' if clear else token}", f"Path={path}",
             f"Max-Age={0 if clear else s.lifetime}", "HttpOnly", f"SameSite={s.same_site.capitalize()}"]
    if secure or s.same_site == "none":  # browsers drop SameSite=None without Secure
        parts.append("Secure")
    return "; ".join(parts)


def set_cookie(response: Any, scope: dict, token: str, *, clear: bool = False) -> Any:
    """Add the session cookie to a Starlette *response*."""
    response.raw_headers.append((b"set-cookie", cookie_header(scope, token, clear=clear).encode("latin-1")))
    return response
