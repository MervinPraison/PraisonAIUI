"""Unit tests for ratelimit.py - Rate limiting middleware."""

import time
import pytest
from unittest.mock import MagicMock, AsyncMock


class TestRateLimitConfig:
    """Tests for RateLimitConfig dataclass."""

    def test_default_config(self):
        """Test default configuration values."""
        from praisonaiui.ratelimit import RateLimitConfig

        config = RateLimitConfig()
        assert config.requests_per_minute == 60
        assert config.requests_per_hour == 1000
        assert config.burst_limit == 10
        assert config.exclude_paths == ["/health"]
        assert config.by_ip is True
        assert config.by_user is True

    def test_custom_config(self):
        """Test custom configuration values."""
        from praisonaiui.ratelimit import RateLimitConfig

        config = RateLimitConfig(
            requests_per_minute=30,
            requests_per_hour=500,
            burst_limit=5,
            exclude_paths=["/health", "/"],
            by_ip=False,
            by_user=True,
        )
        assert config.requests_per_minute == 30
        assert config.requests_per_hour == 500
        assert config.burst_limit == 5
        assert config.exclude_paths == ["/health", "/"]
        assert config.by_ip is False


class TestRateLimitBucket:
    """Tests for RateLimitBucket dataclass."""

    def test_bucket_creation(self):
        """Test bucket creation with default values."""
        from praisonaiui.ratelimit import RateLimitBucket

        now = time.time()
        bucket = RateLimitBucket(tokens=10, last_update=now)
        assert bucket.tokens == 10
        assert bucket.last_update == now
        assert bucket.request_count_minute == 0
        assert bucket.request_count_hour == 0


class TestRateLimiter:
    """Tests for RateLimiter class."""

    def test_limiter_creation(self):
        """Test RateLimiter creation."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig()
        limiter = RateLimiter(config)
        assert limiter.config is config

    def test_get_key_by_ip(self):
        """Test key generation by IP address."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(by_ip=True, by_user=False)
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        key = limiter._get_key(mock_request)
        assert "ip:192.168.1.1" in key

    def test_get_key_with_forwarded_header(self):
        """Test key generation with X-Forwarded-For header."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(by_ip=True, by_user=False)
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.headers = {"x-forwarded-for": "10.0.0.1, 192.168.1.1"}
        mock_request.client.host = "127.0.0.1"
        mock_request.state.__dict__ = {}

        key = limiter._get_key(mock_request)
        assert "ip:10.0.0.1" in key

    def test_is_allowed_excluded_path(self):
        """Test that excluded paths are always allowed."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(exclude_paths=["/health"])
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.url.path = "/health"

        allowed, headers = limiter.is_allowed(mock_request)
        assert allowed is True
        assert headers == {}

    def test_is_allowed_first_request(self):
        """Test that first request is allowed."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(requests_per_minute=60, burst_limit=10)
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        allowed, headers = limiter.is_allowed(mock_request)
        assert allowed is True
        assert "X-RateLimit-Limit" in headers
        assert headers["X-RateLimit-Limit"] == "60"

    def test_is_allowed_burst_limit(self):
        """Test burst limit enforcement."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(
            requests_per_minute=100,
            burst_limit=3,
        )
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        # First 3 requests should be allowed (burst limit)
        for _ in range(3):
            allowed, _ = limiter.is_allowed(mock_request)
            assert allowed is True

        # 4th request should be denied (burst exhausted)
        allowed, headers = limiter.is_allowed(mock_request)
        assert allowed is False
        assert "Retry-After" in headers

    def test_is_allowed_minute_limit(self):
        """Test per-minute limit enforcement."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig

        config = RateLimitConfig(
            requests_per_minute=5,
            burst_limit=100,  # High burst to test minute limit
        )
        limiter = RateLimiter(config)

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        # First 5 requests should be allowed
        for _ in range(5):
            allowed, _ = limiter.is_allowed(mock_request)
            assert allowed is True

        # 6th request should be denied
        allowed, headers = limiter.is_allowed(mock_request)
        assert allowed is False
        assert "Retry-After" in headers

    def test_cleanup_old_buckets(self):
        """Test cleanup of old buckets."""
        from praisonaiui.ratelimit import RateLimiter, RateLimitConfig, RateLimitBucket

        config = RateLimitConfig()
        limiter = RateLimiter(config)

        # Add some buckets
        old_time = time.time() - 7200  # 2 hours ago
        limiter._buckets["old_key"] = RateLimitBucket(
            tokens=10,
            last_update=old_time,
        )
        limiter._buckets["new_key"] = RateLimitBucket(
            tokens=10,
            last_update=time.time(),
        )

        removed = limiter.cleanup_old_buckets(max_age=3600)
        assert removed == 1
        assert "old_key" not in limiter._buckets
        assert "new_key" in limiter._buckets


class TestRateLimitMiddleware:
    """Tests for RateLimitMiddleware class."""

    def test_middleware_creation(self):
        """Test middleware creation with default values."""
        from praisonaiui.ratelimit import RateLimitMiddleware

        mock_app = MagicMock()
        middleware = RateLimitMiddleware(mock_app)

        assert middleware.config.requests_per_minute == 60
        assert middleware.config.requests_per_hour == 1000

    def test_middleware_creation_custom(self):
        """Test middleware creation with custom values."""
        from praisonaiui.ratelimit import RateLimitMiddleware

        mock_app = MagicMock()
        middleware = RateLimitMiddleware(
            mock_app,
            requests_per_minute=30,
            requests_per_hour=500,
            exclude_paths=["/health", "/"],
        )

        assert middleware.config.requests_per_minute == 30
        assert middleware.config.requests_per_hour == 500
        assert middleware.config.exclude_paths == ["/health", "/"]

    @pytest.mark.asyncio
    async def test_dispatch_allowed(self):
        """Test dispatch allows request under limit."""
        from praisonaiui.ratelimit import RateLimitMiddleware

        mock_app = MagicMock()
        mock_response = MagicMock()
        mock_response.headers = {}

        async def call_next(request):
            return mock_response

        middleware = RateLimitMiddleware(mock_app)

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        response = await middleware.dispatch(mock_request, call_next)
        assert response is mock_response
        assert "X-RateLimit-Limit" in response.headers

    @pytest.mark.asyncio
    async def test_dispatch_rate_limited(self):
        """Test dispatch returns 429 when rate limited."""
        from praisonaiui.ratelimit import RateLimitMiddleware

        mock_app = MagicMock()

        async def call_next(request):
            return MagicMock()

        middleware = RateLimitMiddleware(
            mock_app,
            requests_per_minute=1,
            burst_limit=1,
        )

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        # First request allowed
        response1 = await middleware.dispatch(mock_request, call_next)

        # Second request should be rate limited
        response2 = await middleware.dispatch(mock_request, call_next)
        assert response2.status_code == 429

    @pytest.mark.asyncio
    async def test_dispatch_custom_on_limited(self):
        """Test dispatch uses custom on_limited callback."""
        from praisonaiui.ratelimit import RateLimitMiddleware
        from starlette.responses import JSONResponse

        mock_app = MagicMock()
        custom_response = JSONResponse({"custom": "error"}, status_code=429)

        def on_limited(request):
            return custom_response

        middleware = RateLimitMiddleware(
            mock_app,
            requests_per_minute=1,
            burst_limit=1,
            on_limited=on_limited,
        )

        mock_request = MagicMock()
        mock_request.url.path = "/api/test"
        mock_request.headers = {}
        mock_request.client.host = "192.168.1.1"
        mock_request.state.__dict__ = {}

        async def call_next(request):
            return MagicMock()

        # First request allowed
        await middleware.dispatch(mock_request, call_next)

        # Second request uses custom handler
        response = await middleware.dispatch(mock_request, call_next)
        assert response is custom_response
