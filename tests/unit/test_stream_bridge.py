"""Tests for StreamBridge async-sync bridge functionality."""

import asyncio
import os
import sys
import threading
import time
from unittest.mock import Mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'examples', 'python', '_shared'))
from stream_bridge import StreamBridge, create_stream_bridge


class TestStreamBridge:
    """Test the StreamBridge class for thread-safe async-sync communication."""

    @pytest.mark.asyncio
    async def test_basic_token_emission(self):
        """Test basic token emission and consumption."""
        bridge = StreamBridge()
        tokens = ["Hello", " ", "world", "!"]

        async def emit_tokens():
            await asyncio.sleep(0.01)  # Small delay
            for token in tokens:
                bridge.emit_token(token)
            bridge.emit_end()

        # Start emission in background
        emit_task = asyncio.create_task(emit_tokens())

        # Consume tokens
        collected = []
        async for token in bridge.consume():
            collected.append(token)

        await emit_task
        assert collected == tokens

    @pytest.mark.asyncio
    async def test_thread_safe_emission(self):
        """Test token emission from worker threads is thread-safe."""
        bridge = StreamBridge()
        tokens = []

        def worker_thread():
            for i in range(10):
                bridge.emit_token(f"token{i}")
                time.sleep(0.001)  # Small delay to simulate real work
            bridge.emit_end()

        # Start worker thread
        thread = threading.Thread(target=worker_thread)
        thread.start()

        # Consume tokens from main asyncio thread
        collected = []
        async for token in bridge.consume():
            collected.append(token)

        thread.join()

        # Verify all tokens were received
        assert len(collected) == 10
        for i in range(10):
            assert f"token{i}" in collected

    @pytest.mark.asyncio
    async def test_multiple_threads(self):
        """Test multiple worker threads emitting concurrently."""
        bridge = StreamBridge()
        num_threads = 3
        tokens_per_thread = 5

        def worker_thread(thread_id):
            for i in range(tokens_per_thread):
                bridge.emit_token(f"t{thread_id}-{i}")
                time.sleep(0.001)

        # Start multiple worker threads
        threads = []
        for tid in range(num_threads):
            thread = threading.Thread(target=worker_thread, args=(tid,))
            threads.append(thread)
            thread.start()

        # Wait for all threads to finish, then signal end
        async def signal_end():
            for thread in threads:
                thread.join()
            bridge.emit_end()

        end_task = asyncio.create_task(signal_end())

        # Consume tokens
        collected = []
        async for token in bridge.consume():
            collected.append(token)

        await end_task

        # Verify correct number of tokens
        assert len(collected) == num_threads * tokens_per_thread

        # Verify tokens from all threads are present
        for tid in range(num_threads):
            for i in range(tokens_per_thread):
                assert f"t{tid}-{i}" in collected

    @pytest.mark.asyncio
    async def test_consume_timeout(self):
        """Test timeout behavior in consume()."""
        bridge = StreamBridge()

        # Start consuming with short timeout
        collected = []
        start_time = time.time()

        async for token in bridge.consume(timeout=0.1):
            collected.append(token)

        elapsed = time.time() - start_time

        # Should timeout quickly since no tokens are emitted
        assert elapsed < 0.2  # Allow some margin
        assert len(collected) == 0

    @pytest.mark.asyncio
    async def test_cancel_functionality(self):
        """Test bridge cancellation."""
        bridge = StreamBridge()

        def worker_thread():
            time.sleep(0.05)  # Let consumer start
            bridge.emit_token("token1")
            time.sleep(0.05)
            bridge.cancel()  # Cancel instead of normal end

        thread = threading.Thread(target=worker_thread)
        thread.start()

        collected = []
        async for token in bridge.consume():
            collected.append(token)

        thread.join()

        # Should have received the token before cancellation
        assert "token1" in collected

    @pytest.mark.asyncio
    async def test_emitter_callback_creation(self):
        """Test creation of emitter callback function."""
        bridge = StreamBridge()
        callback = bridge.emitter_callback()

        assert callable(callback)

        # Mock event object
        mock_event = Mock()
        mock_event.content = "test_token"

        # Mock StreamEventType to avoid import dependency
        mock_event.type = "DELTA_TEXT"

        # Should not raise exception
        callback(mock_event)

    @pytest.mark.asyncio
    async def test_create_stream_bridge_factory(self):
        """Test the factory function."""
        bridge = create_stream_bridge()
        assert isinstance(bridge, StreamBridge)

        # Test with explicit loop
        loop = asyncio.get_running_loop()
        bridge2 = create_stream_bridge(loop)
        assert isinstance(bridge2, StreamBridge)

    @pytest.mark.asyncio
    async def test_ordering_preserved(self):
        """Test that token ordering is preserved."""
        bridge = StreamBridge()
        expected_tokens = [f"token_{i:03d}" for i in range(100)]

        def emit_tokens():
            for token in expected_tokens:
                bridge.emit_token(token)
            bridge.emit_end()

        thread = threading.Thread(target=emit_tokens)
        thread.start()

        collected = []
        async for token in bridge.consume():
            collected.append(token)

        thread.join()

        # Verify ordering is preserved
        assert collected == expected_tokens

    @pytest.mark.asyncio
    async def test_no_event_loop_error(self):
        """Test error when no event loop is running."""
        # This test runs outside async context deliberately
        def sync_test():
            with pytest.raises(RuntimeError, match="No running event loop"):
                StreamBridge()

        # Run in thread to avoid current event loop
        thread = threading.Thread(target=sync_test)
        thread.start()
        thread.join()
