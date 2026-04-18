"""Tests for audio hooks feature."""

import asyncio
import json
import pytest
import time
from unittest.mock import AsyncMock, Mock, patch

from praisonaiui.features.audio import (
    AudioFeature,
    on_audio_start,
    on_audio_chunk,
    on_audio_end,
    register_audio_start_hook,
    register_audio_chunk_hook,
    register_audio_end_hook,
    reset_audio_state,
    _audio_start_hooks,
    _audio_chunk_hooks,
    _audio_end_hooks,
    _audio_sessions,
    _audio_stats,
)


class TestAudioFeature:
    """Test AudioFeature protocol implementation."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    def test_feature_protocol(self):
        """Test that AudioFeature implements BaseFeatureProtocol correctly."""
        feature = AudioFeature()
        
        assert feature.name == "audio"
        assert feature.description == "Streaming audio input hooks for STT"
        assert len(feature.routes()) == 4
        assert len(feature.cli_commands()) == 1
    
    @pytest.mark.asyncio
    async def test_health_endpoint(self):
        """Test health check reports correct state."""
        feature = AudioFeature()
        
        # Add some hooks
        @on_audio_start
        async def start_hook():
            pass
        
        @on_audio_chunk
        async def chunk_hook(pcm, sample_rate):
            pass
        
        @on_audio_end
        async def end_hook():
            pass
        
        health = await feature.health()
        
        assert health["status"] == "ok"
        assert health["feature"] == "audio"
        assert health["start_hooks"] == 1
        assert health["chunk_hooks"] == 1
        assert health["end_hooks"] == 1
        assert health["active_sessions"] == 0


class TestAudioHookRegistration:
    """Test audio hook registration."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    def test_start_hook_registration(self):
        """Test audio start hook registration."""
        
        @register_audio_start_hook
        def start_hook():
            pass
        
        assert len(_audio_start_hooks) == 1
        assert _audio_start_hooks[0] == start_hook
    
    def test_chunk_hook_registration(self):
        """Test audio chunk hook registration."""
        
        @register_audio_chunk_hook
        def chunk_hook(pcm_data, sample_rate):
            pass
        
        assert len(_audio_chunk_hooks) == 1
        assert _audio_chunk_hooks[0] == chunk_hook
    
    def test_end_hook_registration(self):
        """Test audio end hook registration."""
        
        @register_audio_end_hook
        def end_hook():
            pass
        
        assert len(_audio_end_hooks) == 1
        assert _audio_end_hooks[0] == end_hook
    
    def test_decorator_syntax(self):
        """Test decorator syntax for audio hooks."""
        
        @on_audio_start
        def start():
            pass
        
        @on_audio_chunk
        def chunk(pcm, sample_rate):
            pass
        
        @on_audio_end
        def end():
            pass
        
        assert len(_audio_start_hooks) == 1
        assert len(_audio_chunk_hooks) == 1
        assert len(_audio_end_hooks) == 1
        assert _audio_start_hooks[0] == start
        assert _audio_chunk_hooks[0] == chunk
        assert _audio_end_hooks[0] == end
    
    def test_duplicate_registration_prevention(self):
        """Test that duplicate hook registration is prevented."""
        
        def my_hook():
            pass
        
        # Register the same hook multiple times
        register_audio_start_hook(my_hook)
        register_audio_start_hook(my_hook)
        register_audio_start_hook(my_hook)
        
        # Should only appear once
        assert len(_audio_start_hooks) == 1
        assert _audio_start_hooks[0] == my_hook


class TestAudioHookExecution:
    """Test audio hook execution."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    @pytest.mark.asyncio
    async def test_start_hooks_execution(self):
        """Test start hooks are executed."""
        execution_order = []
        
        @on_audio_start
        def hook1():
            execution_order.append(1)
        
        @on_audio_start
        async def hook2():
            execution_order.append(2)
        
        @on_audio_start
        def hook3():
            execution_order.append(3)
        
        # Create feature instance and trigger hooks
        feature = AudioFeature()
        await feature._trigger_start_hooks()
        
        assert execution_order == [1, 2, 3]
    
    @pytest.mark.asyncio
    async def test_chunk_hooks_execution(self):
        """Test chunk hooks are executed with correct parameters."""
        received_chunks = []
        
        @on_audio_chunk
        def hook1(pcm_data, sample_rate):
            received_chunks.append(("hook1", len(pcm_data), sample_rate))
        
        @on_audio_chunk
        async def hook2(pcm_data, sample_rate):
            received_chunks.append(("hook2", len(pcm_data), sample_rate))
        
        # Create feature instance and trigger hooks
        feature = AudioFeature()
        test_data = b"test_pcm_data"
        test_rate = 16000
        
        await feature._trigger_chunk_hooks(test_data, test_rate)
        
        assert len(received_chunks) == 2
        assert ("hook1", len(test_data), test_rate) in received_chunks
        assert ("hook2", len(test_data), test_rate) in received_chunks
    
    @pytest.mark.asyncio
    async def test_end_hooks_execution(self):
        """Test end hooks are executed."""
        execution_order = []
        
        @on_audio_end
        def hook1():
            execution_order.append(1)
        
        @on_audio_end
        async def hook2():
            execution_order.append(2)
        
        @on_audio_end
        def hook3():
            execution_order.append(3)
        
        # Create feature instance and trigger hooks
        feature = AudioFeature()
        await feature._trigger_end_hooks()
        
        assert execution_order == [1, 2, 3]
    
    @pytest.mark.asyncio
    async def test_hook_error_handling(self):
        """Test that hook errors don't break audio processing."""
        execution_order = []
        
        @on_audio_start
        def good_hook1():
            execution_order.append(1)
        
        @on_audio_start
        def failing_hook():
            execution_order.append("fail")
            raise RuntimeError("Hook failed")
        
        @on_audio_start
        def good_hook2():
            execution_order.append(2)
        
        # Should not raise exception
        feature = AudioFeature()
        await feature._trigger_start_hooks()
        
        # All hooks should have been attempted
        assert execution_order == [1, "fail", 2]


class TestAudioSessionManagement:
    """Test audio session management."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    @pytest.mark.asyncio
    async def test_session_creation_and_cleanup(self):
        """Test audio session lifecycle."""
        feature = AudioFeature()
        session_id = "test_session"
        
        # Initially no sessions
        assert len(_audio_sessions) == 0
        assert _audio_stats["active_sessions"] == 0
        
        # Simulate session creation
        _audio_sessions[session_id] = {
            "started_at": time.time(),
            "sample_rate": 16000,
            "chunks_received": 0,
            "bytes_received": 0,
            "last_chunk_at": time.time(),
        }
        _audio_stats["total_sessions"] += 1
        _audio_stats["active_sessions"] += 1
        
        assert len(_audio_sessions) == 1
        assert _audio_stats["active_sessions"] == 1
        assert session_id in _audio_sessions
        
        # Simulate session cleanup
        del _audio_sessions[session_id]
        _audio_stats["active_sessions"] = max(0, _audio_stats["active_sessions"] - 1)
        
        assert len(_audio_sessions) == 0
        assert _audio_stats["active_sessions"] == 0
    
    @pytest.mark.asyncio
    async def test_chunk_processing_updates_session(self):
        """Test that chunk processing updates session stats."""
        feature = AudioFeature()
        session_id = "test_session"
        
        # Create session
        _audio_sessions[session_id] = {
            "started_at": time.time(),
            "sample_rate": 16000,
            "chunks_received": 0,
            "bytes_received": 0,
            "last_chunk_at": time.time(),
        }
        
        # Process audio chunk
        test_data = b"test_audio_chunk_data"
        await feature._handle_audio_chunk(session_id, test_data, 16000)
        
        # Check session was updated
        session = _audio_sessions[session_id]
        assert session["chunks_received"] == 1
        assert session["bytes_received"] == len(test_data)
        assert session["last_chunk_at"] > session["started_at"]
        
        # Check global stats were updated
        assert _audio_stats["total_chunks"] == 1
        assert _audio_stats["total_bytes"] == len(test_data)


class TestAudioStats:
    """Test audio statistics tracking."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    def test_initial_stats(self):
        """Test initial audio statistics."""
        assert _audio_stats["total_sessions"] == 0
        assert _audio_stats["active_sessions"] == 0
        assert _audio_stats["total_chunks"] == 0
        assert _audio_stats["total_bytes"] == 0
    
    @pytest.mark.asyncio
    async def test_stats_tracking(self):
        """Test statistics are properly tracked."""
        feature = AudioFeature()
        
        # Simulate multiple chunks from different sessions
        sessions = ["session1", "session2"]
        chunk_data = [b"chunk1", b"chunk2", b"chunk3"]
        
        for session_id in sessions:
            _audio_sessions[session_id] = {
                "started_at": time.time(),
                "sample_rate": 16000,
                "chunks_received": 0,
                "bytes_received": 0,
                "last_chunk_at": time.time(),
            }
            _audio_stats["total_sessions"] += 1
            _audio_stats["active_sessions"] += 1
        
        total_bytes = 0
        for session_id in sessions:
            for chunk in chunk_data:
                await feature._handle_audio_chunk(session_id, chunk, 16000)
                total_bytes += len(chunk)
        
        # Check final stats
        assert _audio_stats["total_sessions"] == 2
        assert _audio_stats["active_sessions"] == 2
        assert _audio_stats["total_chunks"] == len(sessions) * len(chunk_data)
        assert _audio_stats["total_bytes"] == total_bytes
    
    def test_reset_state(self):
        """Test state reset functionality."""
        # Modify state
        _audio_stats["total_sessions"] = 5
        _audio_stats["active_sessions"] = 2
        _audio_sessions["test"] = {}
        
        @on_audio_start
        def hook():
            pass
        
        assert len(_audio_start_hooks) == 1
        assert _audio_stats["total_sessions"] == 5
        assert len(_audio_sessions) == 1
        
        # Reset state
        reset_audio_state()
        
        # Should be back to initial state
        assert len(_audio_start_hooks) == 0
        assert _audio_stats["total_sessions"] == 0
        assert len(_audio_sessions) == 0


class TestAudioIntegration:
    """Integration tests for audio hooks."""
    
    def setup_method(self):
        """Reset state before each test."""
        reset_audio_state()
    
    @pytest.mark.asyncio
    async def test_stt_pipeline_example(self):
        """Test the STT pipeline example from the issue."""
        # Simulate an STT buffer
        stt_buffer = {"chunks": [], "finalized": False, "transcript": ""}
        
        @on_audio_start
        async def start():
            # Reset buffer for new session
            stt_buffer["chunks"].clear()
            stt_buffer["finalized"] = False
        
        @on_audio_chunk
        async def chunk(pcm_data, sample_rate):
            # Accumulate audio chunks
            stt_buffer["chunks"].append(pcm_data)
        
        @on_audio_end
        async def end():
            # Simulate STT processing
            if stt_buffer["chunks"]:
                stt_buffer["transcript"] = f"Processed {len(stt_buffer['chunks'])} chunks"
                stt_buffer["finalized"] = True
        
        feature = AudioFeature()
        
        # Simulate audio session
        await feature._trigger_start_hooks()
        assert len(stt_buffer["chunks"]) == 0
        assert not stt_buffer["finalized"]
        
        # Send audio chunks
        chunks = [b"chunk1", b"chunk2", b"chunk3"]
        for chunk in chunks:
            await feature._trigger_chunk_hooks(chunk, 16000)
        
        assert len(stt_buffer["chunks"]) == len(chunks)
        assert stt_buffer["chunks"] == chunks
        
        # End session
        await feature._trigger_end_hooks()
        assert stt_buffer["finalized"]
        assert stt_buffer["transcript"] == "Processed 3 chunks"
    
    @pytest.mark.asyncio
    async def test_multiple_stt_providers(self):
        """Test multiple STT providers receiving the same audio."""
        providers = {
            "whisper": {"chunks": [], "active": False},
            "deepgram": {"chunks": [], "active": False},
            "vosk": {"chunks": [], "active": False},
        }
        
        @on_audio_start
        async def start_all():
            for provider in providers.values():
                provider["active"] = True
                provider["chunks"].clear()
        
        @on_audio_chunk
        async def chunk_to_whisper(pcm_data, sample_rate):
            if providers["whisper"]["active"]:
                providers["whisper"]["chunks"].append(pcm_data)
        
        @on_audio_chunk
        async def chunk_to_deepgram(pcm_data, sample_rate):
            if providers["deepgram"]["active"]:
                providers["deepgram"]["chunks"].append(pcm_data)
        
        @on_audio_chunk
        async def chunk_to_vosk(pcm_data, sample_rate):
            if providers["vosk"]["active"]:
                providers["vosk"]["chunks"].append(pcm_data)
        
        @on_audio_end
        async def end_all():
            for provider in providers.values():
                provider["active"] = False
        
        feature = AudioFeature()
        
        # Start session
        await feature._trigger_start_hooks()
        
        # All providers should be active
        for provider in providers.values():
            assert provider["active"]
            assert len(provider["chunks"]) == 0
        
        # Send audio chunk
        test_chunk = b"test_audio_data"
        await feature._trigger_chunk_hooks(test_chunk, 16000)
        
        # All providers should have received the chunk
        for provider in providers.values():
            assert len(provider["chunks"]) == 1
            assert provider["chunks"][0] == test_chunk
        
        # End session
        await feature._trigger_end_hooks()
        
        # All providers should be deactivated
        for provider in providers.values():
            assert not provider["active"]
    
    @pytest.mark.asyncio
    async def test_audio_session_ordering(self):
        """Test that audio chunks are processed in order."""
        received_chunks = []
        
        @on_audio_chunk
        async def ordered_processor(pcm_data, sample_rate):
            # Decode chunk number from data
            chunk_num = int(pcm_data.decode())
            received_chunks.append(chunk_num)
        
        feature = AudioFeature()
        
        # Send chunks in order
        for i in range(10):
            chunk_data = str(i).encode()
            await feature._trigger_chunk_hooks(chunk_data, 16000)
        
        # Chunks should be processed in order
        assert received_chunks == list(range(10))
    
    @pytest.mark.asyncio
    async def test_concurrent_audio_sessions(self):
        """Test handling of concurrent audio sessions."""
        session_data = {}
        
        @on_audio_chunk
        async def track_by_session(pcm_data, sample_rate):
            # Extract session ID from chunk data (simulated)
            session_id = pcm_data.decode().split(":")[0]
            if session_id not in session_data:
                session_data[session_id] = []
            session_data[session_id].append(pcm_data)
        
        feature = AudioFeature()
        
        # Simulate chunks from multiple sessions
        sessions = ["session1", "session2", "session3"]
        chunks_per_session = 3
        
        for session_id in sessions:
            for chunk_num in range(chunks_per_session):
                chunk_data = f"{session_id}:chunk{chunk_num}".encode()
                await feature._trigger_chunk_hooks(chunk_data, 16000)
        
        # Each session should have received its chunks
        assert len(session_data) == len(sessions)
        for session_id in sessions:
            assert len(session_data[session_id]) == chunks_per_session
            for i, chunk_data in enumerate(session_data[session_id]):
                expected = f"{session_id}:chunk{i}".encode()
                assert chunk_data == expected