## Summary

This PR implements server-side lifecycle hooks, iframe/embed messaging capabilities, and streaming audio input hooks per issue #23. The implementation adds three new features: **lifecycle management** with startup/shutdown hooks for resource initialization and cleanup, **window messaging** for secure iframe communication via postMessage, and **streaming audio hooks** to support server-side STT pipelines. These features complement the existing realtime-voice protocol by providing more flexible audio processing options and enabling AIUI to be embedded within other web applications while maintaining proper lifecycle management.

## Before / After

**Before** (users had to manually manage lifecycle):
```python
# No way to warm up resources before first request
# No graceful shutdown handling
# No iframe communication support
# Limited to realtime WebRTC for voice
```

**After** (with this PR):
```python
@aiui.on_app_startup
async def warm():
    global vector_store
    vector_store = await VectorStore.connect()

@aiui.on_app_shutdown
async def drain():
    await vector_store.close()

@aiui.on_window_message(source="parent")
async def on_msg(data: dict):
    if data.get("type") == "set_user":
        await aiui.send_window_message({"type": "user_set", "ok": True})

@aiui.on_audio_chunk
async def chunk(session_id: str, pcm: bytes, sample_rate: int):
    await stt_buffer.append(pcm)
```

## Acceptance criteria checklist with evidence

- [x] Startup hook completion blocks first request acceptance (no cold-start request mis-dispatch) — see `src/praisonaiui/features/lifecycle.py:76-97` and `src/praisonaiui/server.py:26-29` (commit b8b546d)
- [x] Shutdown hook has 30s default grace period; configurable via `AIUI_SHUTDOWN_TIMEOUT` — see `src/praisonaiui/features/lifecycle.py:105-128` (commit b8b546d)
- [x] `send_window_message({..}, target="parent")` only posts to the declared origin (security §4.4) — see `src/praisonaiui/features/window_message.py:287-290` and `src/frontend/src/hooks/useWindowMessage.ts:176-183` (commit b8b546d)
- [x] Audio chunks received in order; WS reconnect resumes at last acked offset — see `src/praisonaiui/features/audio.py:211-223` (commit b8b546d)
- [x] Hooks are lazy — unused hooks incur zero overhead — see lazy imports in `src/praisonaiui/__init__.py:28-59` (commit b8b546d)
- [x] 15+ tests pass — see test evidence below: 56/56 tests passing (commit b8b546d)

## Test evidence

```
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.0.3, pluggy-1.6.0 -- /usr/bin/python
cachedir: .pytest_cache
rootdir: /home/runner/work/PraisonAIUI/PraisonAIUI
configfile: pyproject.toml
plugins: asyncio-1.3.0, cov-7.1.0, anyio-4.13.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 56 items

tests/unit/test_audio_hooks.py::TestAudioFeature::test_feature_protocol PASSED [  1%]
tests/unit/test_audio_hooks.py::TestAudioFeature::test_health_endpoint PASSED [  3%]
tests/unit/test_audio_hooks.py::TestAudioHookRegistration::test_start_hook_registration PASSED [  5%]
tests/unit/test_audio_hooks.py::TestAudioHookRegistration::test_chunk_hook_registration PASSED [  7%]
tests/unit/test_audio_hooks.py::TestAudioHookRegistration::test_end_hook_registration PASSED [  8%]
tests/unit/test_audio_hooks.py::TestAudioHookRegistration::test_decorator_syntax PASSED [ 10%]
tests/unit/test_audio_hooks.py::TestAudioHookRegistration::test_duplicate_registration_prevention PASSED [ 12%]
tests/unit/test_audio_hooks.py::TestAudioHookExecution::test_start_hooks_execution PASSED [ 14%]
tests/unit/test_audio_hooks.py::TestAudioHookExecution::test_chunk_hooks_execution PASSED [ 16%]
tests/unit/test_audio_hooks.py::TestAudioHookExecution::test_end_hooks_execution PASSED [ 17%]
tests/unit/test_audio_hooks.py::TestAudioHookExecution::test_hook_error_handling PASSED [ 19%]
tests/unit/test_audio_hooks.py::TestAudioSessionManagement::test_session_creation_and_cleanup PASSED [ 21%]
tests/unit/test_audio_hooks.py::TestAudioSessionManagement::test_chunk_processing_updates_session PASSED [ 23%]
tests/unit/test_audio_hooks.py::TestAudioStats::test_initial_stats PASSED [ 25%]
tests/unit/test_audio_hooks.py::TestAudioStats::test_stats_tracking PASSED [ 26%]
tests/unit/test_audio_hooks.py::TestAudioStats::test_reset_state PASSED  [ 28%]
tests/unit/test_audio_hooks.py::TestAudioIntegration::test_stt_pipeline_example PASSED [ 30%]
tests/unit/test_audio_hooks.py::TestAudioIntegration::test_multiple_stt_providers PASSED [ 32%]
tests/unit/test_audio_hooks.py::TestAudioIntegration::test_audio_session_ordering PASSED [ 33%]
tests/unit/test_audio_hooks.py::TestAudioIntegration::test_concurrent_audio_sessions PASSED [ 35%]
tests/unit/test_lifecycle.py::TestLifecycleFeature::test_feature_protocol PASSED [ 37%]
tests/unit/test_lifecycle.py::TestLifecycleFeature::test_health_endpoint PASSED [ 39%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_startup_hook_registration PASSED [ 41%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_shutdown_hook_registration PASSED [ 42%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_decorator_syntax PASSED [ 44%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_duplicate_registration_prevention PASSED [ 46%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_startup_hooks_execution PASSED [ 48%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_shutdown_hooks_execution PASSED [ 50%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_startup_hook_failure_handling PASSED [ 51%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_shutdown_hook_failure_handling PASSED [ 53%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_shutdown_timeout PASSED [ 55%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_startup_idempotent PASSED [ 57%]
tests/unit/test_lifecycle.py::TestLifecycleHooks::test_shutdown_idempotent PASSED [ 58%]
tests/unit/test_lifecycle.py::TestLifecycleState::test_initial_state PASSED [ 60%]
tests/unit/test_lifecycle.py::TestLifecycleState::test_reset_state PASSED [ 62%]
tests/unit/test_lifecycle.py::TestLifecycleIntegration::test_vector_store_example PASSED [ 64%]
tests/unit/test_lifecycle.py::TestLifecycleIntegration::test_resource_lifecycle PASSED [ 66%]
tests/unit/test_window_message.py::TestWindowMessageFeature::test_feature_protocol PASSED [ 67%]
tests/unit/test_window_message.py::TestWindowMessageFeature::test_health_endpoint PASSED [ 69%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_hook_registration PASSED [ 71%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_decorator_syntax PASSED [ 73%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_message_handling_with_specific_source PASSED [ 75%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_message_handling_with_wildcard PASSED [ 76%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_message_handling_with_multiple_hooks PASSED [ 78%]
tests/unit/test_window_message.py::TestWindowMessageHooks::test_hook_error_handling PASSED [ 80%]
tests/unit/test_window_message.py::TestWindowMessageLogging::test_inbound_message_logging PASSED [ 82%]
tests/unit/test_window_message.py::TestWindowMessageLogging::test_outbound_message_logging PASSED [ 83%]
tests/unit/test_window_message.py::TestWindowMessageSending::test_send_to_parent PASSED [ 85%]
tests/unit/test_window_message.py::TestWindowMessageSending::test_send_with_custom_target PASSED [ 87%]
tests/unit/test_window_message.py::TestWindowMessageSending::test_send_with_invalid_target PASSED [ 89%]
tests/unit/test_window_message.py::TestWindowMessageSending::test_send_with_session_context PASSED [ 91%]
tests/unit/test_window_message.py::TestWindowMessageSecurity::test_origin_filtering PASSED [ 92%]
tests/unit/test_window_message.py::TestWindowMessageSecurity::test_target_validation_in_send PASSED [ 94%]
tests/unit/test_window_message.py::TestWindowMessageIntegration::test_user_context_example PASSED [ 96%]
tests/unit/test_window_message.py::TestWindowMessageIntegration::test_bidirectional_communication PASSED [ 98%]
tests/unit/test_window_message.py::TestWindowMessageIntegration::test_multiple_iframe_sources PASSED [100%]

================================ 56 passed in 2.35s ==============================
```

## Import-time proof

```
161.1ms 263 modules
```

Heavy dependencies check:
```
[]
```

The import time is **161.1ms** (under the 200ms requirement) and no heavy optional dependencies are loaded in `sys.modules`.

## Ruff-clean for your new files

RUFF OK

All new Python files pass ruff linting without issues.

## Out-of-scope

As specified in issue #23:

- Built-in STT providers (Whisper / Deepgram) — users plug their own into `on_audio_chunk`.
- VAD on the backend — follow-up (frontend VAD via Web Audio API is enough for v1).

No changes to unrelated modules were made. All modifications are confined to the files listed in the issue requirements table.

## Critical Issues Addressed

This PR also addresses all critical security and concurrency issues identified by `gemini-code-assist`:

1. **✅ Fixed concurrency issue in window messaging** - Replaced global state with per-session `_session_contexts` registry to support multi-user environments properly
2. **✅ Enhanced audio hooks with session identification** - All audio chunk hooks now receive `session_id` parameter for proper stream identification
3. **✅ Added missing backend endpoint** - `/api/window-message/receive` endpoint is implemented and functional
4. **✅ Secured postMessage communications** - Eliminated wildcard origins, enforce specific origins or fallback to current origin for security
5. **✅ Documented deprecated ScriptProcessorNode** - Added TODO comment noting replacement with AudioWorklet for future enhancement

All 56 tests pass, import performance meets requirements, and the implementation is ready for production use.