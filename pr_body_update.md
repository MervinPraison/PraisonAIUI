## Summary

Implements interactive message actions with server-side `@action_callback` hooks as specified in issue #15. Agents can now attach clickable action buttons to individual messages with Python callbacks that execute when clicked. This enables common UI patterns like approve/reject flows, retry mechanisms, and progressive disclosure. The implementation adds a new `Action` class in `src/praisonaiui/actions.py`, extends the `Message` class with an `actions` field, includes a new React component `ActionButtons.tsx` for frontend rendering, and provides a secure server endpoint for action dispatch with proper session verification.

## Before / After

### Before (No interactive actions)
```python
import praisonaiui as aiui

@aiui.reply
async def handler(message):
    # Had to use static helper with manual correlation
    await aiui.Message(
        content="Approve PR #42?",
        elements=[aiui.action_buttons(["Approve", "Reject"])]  # Static only
    ).send()
    # No way to handle clicks - required custom REST endpoints
```

### After (Interactive message actions)
```python
import praisonaiui as aiui

@aiui.action_callback("approve_pr")
async def on_approve(action: aiui.Action):
    await action.remove()  # Hide button after click
    await aiui.Message(content=f"✅ PR #{action.payload['pr_number']} approved").send()

@aiui.reply
async def handler(message):
    await aiui.Message(
        content="Approve PR #42?",
        actions=[
            aiui.Action(name="approve_pr", label="Approve", payload={"pr_number": 42}),
            aiui.Action(name="reject_pr", label="Reject", payload={"pr_number": 42}),
        ],
    ).send()
```

## Acceptance-criteria checklist with evidence

- [x] `aiui.Action(name, label, payload=None, icon=None, variant="secondary")` constructs and serialises via `to_dict()` with deterministic output (see §4.1 of `AGENTS.md`). ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/actions.py:82-106`
- [x] `@aiui.action_callback("name")` registers an async handler; calling the endpoint invokes it with an `Action` instance. ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/actions.py:124-171`
- [x] `msg.actions=[...]` persists via `datastore.add_message()` so actions survive page reload. ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/message.py:378-385`
- [x] `Action.remove()` emits a server-side event that removes the button from the rendered message. ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/actions.py:108-121`
- [x] If no callback is registered for an action name, endpoint returns HTTP 404 with descriptive error (§4.6 safe defaults — fail loudly). ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/server.py:1125-1127`
- [x] Lazy-import invariant preserved: `import praisonaiui` does not import `actions.py`. ✓ [bd9dc9b](https://github.com/MervinPraison/PraisonAIUI/commit/bd9dc9b) `src/praisonaiui/__init__.py:71-79`
- [x] At least 8 tests pass in `tests/unit/test_actions.py`. ✓ 27 tests pass (see test evidence below)

## Test evidence

```
============================= test session starts ==============================
platform linux -- Python 3.12.3, pytest-9.0.3, pluggy-1.6.0 -- /usr/bin/python
cachedir: .pytest_cache
rootdir: /home/runner/work/PraisonAIUI/PraisonAIUI
configfile: pyproject.toml
plugins: asyncio-1.3.0, cov-7.1.0, anyio-4.13.0
asyncio: mode=Mode.STRICT, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 28 items

tests/unit/test_actions.py::TestActionClass::test_action_creation_basic PASSED [  3%]
tests/unit/test_actions.py::TestActionClass::test_action_creation_full PASSED [  7%]
tests/unit/test_actions.py::TestActionClass::test_action_to_dict_deterministic PASSED [ 10%]
tests/unit/test_actions.py::TestActionClass::test_action_to_dict_none_values_excluded PASSED [ 14%]
tests/unit/test_actions.py::TestActionClass::test_action_remove_no_context PASSED [ 17%]
tests/unit/test_actions.py::TestActionClass::test_action_remove_with_context PASSED [ 21%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_action_callback_decorator PASSED [ 25%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_action_callback_decorator_validation PASSED [ 28%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_register_action_callback_function PASSED [ 32%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_register_action_callback_validation PASSED [ 35%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_callback_registry_isolation PASSED [ 39%]
tests/unit/test_actions.py::TestActionCallbackRegistry::test_clear_action_registry PASSED [ 42%]
tests/unit/test_actions.py::TestActionDispatch::test_dispatch_action_callback_success PASSED [ 46%]
tests/unit/test_actions.py::TestActionDispatch::test_dispatch_action_callback_not_found PASSED [ 50%]
tests/unit/test_actions.py::TestActionDispatch::test_dispatch_action_callback_with_none_payload PASSED [ 53%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_actions_field_type PASSED [ 57%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_add_action_method PASSED [ 60%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_add_action_fallback SKIPPED [ 64%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_serialize_actions_sets_message_id PASSED [ 67%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_serialize_actions_mixed_types PASSED [ 71%]
tests/unit/test_actions.py::TestMessageIntegration::test_message_serialize_actions_empty PASSED [ 75%]
tests/unit/test_actions.py::TestServerEndpoint::test_action_endpoint_success_flow PASSED [ 78%]
tests/unit/test_actions.py::TestDoubleClickIdempotency::test_concurrent_action_dispatch PASSED [ 82%]
tests/unit/test_actions.py::TestActionSnapshotSerialization::test_action_snapshot_format PASSED [ 85%]
tests/unit/test_actions.py::TestActionSnapshotSerialization::test_frontend_button_list_snapshot PASSED [ 89%]
tests/unit/test_actions.py::TestErrorHandling::test_missing_callback_raises_404_equivalent PASSED [ 92%]
tests/unit/test_actions.py::TestErrorHandling::test_callback_exception_propagates PASSED [ 96%]
tests/unit/test_actions.py::TestErrorHandling::test_action_creation_with_invalid_params PASSED [100%]

==================== 27 passed, 1 skipped, 19 warnings in 2.26s ==================
```

One test is skipped (`test_message_add_action_fallback`) because it tests import fallback behavior which isn't needed when the actions module is available (normal case).

## Import-time proof

```
157.1ms 263 modules
```

**Heavy dependencies check:**
```
[]
```

Import time is 157.1ms (under 200ms requirement) with no heavy optional dependencies loaded.

## Ruff-clean for new files

```
RUFF OK
```

All modified Python files pass ruff checks with no violations.

## Out-of-scope

- Cross-message actions (bulk approve / reject) — follow-up issue.
- Action confirmation dialogs — follow-up; can be layered via `Action(confirm="Are you sure?")` later.

All changes are within the scope defined in issue #15. No accidental modifications to unrelated modules.