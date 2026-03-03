"""Rate limiting middleware for PraisonAIUI.

Provides configurable per-user and per-endpoint rate limiting
to protect against abuse in production deployments.

Example:
    from praisonaiui.ratelimit import RateLimitMiddleware

    app = Starlette(
        middleware=[
            Middleware(RateLimitMiddleware, requests_per_minute=60),
        ]
    )
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response


@dataclass
class RateLimitConfig:
    """Configuration for rate limiting."""

    requests_per_minute: int = 60
    requests_per_hour: int = 1000
    burst_limit: int = 10
    exclude_paths: list[str] = field(default_factory=lambda: ["/health"])
    by_ip: bool = True
    by_user: bool = True


@dataclass
class RateLimitBucket:
    """Token bucket for rate limiting."""

    tokens: float
    last_update: float
    request_count_minute: int = 0
    request_count_hour: int = 0
    minute_start: float = 0.0
    hour_start: float = 0.0


class RateLimiter:
    """In-memory rate limiter using token bucket algorithm."""

    def __init__(self, config: RateLimitConfig):
        self.config = config
        self._buckets: dict[str, RateLimitBucket] = defaultdict(
            lambda: RateLimitBucket(
                tokens=config.burst_limit,
                last_update=time.time(),
                minute_start=time.time(),
                hour_start=time.time(),
            )
        )

    def _get_key(self, request: Request) -> str:
        """Get the rate limit key for a request."""
        parts = []

        if self.config.by_ip:
            # Get client IP (handle proxies)
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                ip = forwarded.split(",")[0].strip()
            else:
                ip = request.client.host if request.client else "unknown"
            parts.append(f"ip:{ip}")

        if self.config.by_user:
            # Get user from auth header or session
            auth = request.headers.get("authorization", "")
            if auth.startswith("Bearer "):
                parts.append(f"token:{auth[7:20]}")  # First 13 chars of token
            user_id = request.state.__dict__.get("user_id")
            if user_id:
                parts.append(f"user:{user_id}")

        return "|".join(parts) if parts else "global"

    def is_allowed(self, request: Request) -> tuple[bool, dict[str, int]]:
        """Check if request is allowed under rate limits.

        Returns:
            Tuple of (allowed, headers) where headers contains rate limit info
        """
        # Skip excluded paths
        if request.url.path in self.config.exclude_paths:
            return True, {}

        key = self._get_key(request)
        bucket = self._buckets[key]
        now = time.time()

        # Reset minute counter if needed
        if now - bucket.minute_start >= 60:
            bucket.request_count_minute = 0
            bucket.minute_start = now

        # Reset hour counter if needed
        if now - bucket.hour_start >= 3600:
            bucket.request_count_hour = 0
            bucket.hour_start = now

        # Refill tokens (token bucket algorithm)
        elapsed = now - bucket.last_update
        bucket.tokens = min(
            self.config.burst_limit,
            bucket.tokens + elapsed * (self.config.requests_per_minute / 60),
        )
        bucket.last_update = now

        # Check limits
        headers = {
            "X-RateLimit-Limit": str(self.config.requests_per_minute),
            "X-RateLimit-Remaining": str(
                max(0, self.config.requests_per_minute - bucket.request_count_minute)
            ),
            "X-RateLimit-Reset": str(int(bucket.minute_start + 60)),
        }

        # Check burst limit (token bucket)
        if bucket.tokens < 1:
            headers["Retry-After"] = str(
                int((1 - bucket.tokens) * 60 / self.config.requests_per_minute)
            )
            return False, headers

        # Check per-minute limit
        if bucket.request_count_minute >= self.config.requests_per_minute:
            headers["Retry-After"] = str(int(60 - (now - bucket.minute_start)))
            return False, headers

        # Check per-hour limit
        if bucket.request_count_hour >= self.config.requests_per_hour:
            headers["Retry-After"] = str(int(3600 - (now - bucket.hour_start)))
            return False, headers

        # Allow request
        bucket.tokens -= 1
        bucket.request_count_minute += 1
        bucket.request_count_hour += 1

        return True, headers

    def cleanup_old_buckets(self, max_age: float = 3600) -> int:
        """Remove buckets that haven't been used recently.

        Args:
            max_age: Maximum age in seconds before cleanup

        Returns:
            Number of buckets removed
        """
        now = time.time()
        old_keys = [
            key
            for key, bucket in self._buckets.items()
            if now - bucket.last_update > max_age
        ]
        for key in old_keys:
            del self._buckets[key]
        return len(old_keys)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Starlette middleware for rate limiting.

    Example:
        app = Starlette(
            middleware=[
                Middleware(
                    RateLimitMiddleware,
                    requests_per_minute=60,
                    requests_per_hour=1000,
                    exclude_paths=["/health", "/"],
                ),
            ]
        )
    """

    def __init__(
        self,
        app,
        requests_per_minute: int = 60,
        requests_per_hour: int = 1000,
        burst_limit: int = 10,
        exclude_paths: Optional[list[str]] = None,
        by_ip: bool = True,
        by_user: bool = True,
        on_limited: Optional[Callable[[Request], Response]] = None,
    ):
        super().__init__(app)
        self.config = RateLimitConfig(
            requests_per_minute=requests_per_minute,
            requests_per_hour=requests_per_hour,
            burst_limit=burst_limit,
            exclude_paths=exclude_paths or ["/health"],
            by_ip=by_ip,
            by_user=by_user,
        )
        self.limiter = RateLimiter(self.config)
        self.on_limited = on_limited

    async def dispatch(self, request: Request, call_next) -> Response:
        """Check rate limits before processing request."""
        allowed, headers = self.limiter.is_allowed(request)

        if not allowed:
            if self.on_limited:
                response = self.on_limited(request)
            else:
                response = JSONResponse(
                    {
                        "error": "Rate limit exceeded",
                        "retry_after": headers.get("Retry-After", "60"),
                    },
                    status_code=429,
                )

            # Add rate limit headers
            for key, value in headers.items():
                response.headers[key] = value

            return response

        # Process request
        response = await call_next(request)

        # Add rate limit headers to successful responses
        for key, value in headers.items():
            response.headers[key] = value

        return response
