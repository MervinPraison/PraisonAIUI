"""Default workflow runner — AgentFlow from registered workflow steps."""

from __future__ import annotations

import time
import uuid
from typing import Any, Callable, Dict


def _log_step(step: Dict[str, Any]) -> str:
    return str(step.get("message") or "")


# Builtin steps that must not call a model. Add a handler here to extend them.
_LOCAL_STEPS: Dict[str, Callable[[Dict[str, Any]], str]] = {
    "log": _log_step,
}


def run_workflow(
    workflow_id: str,
    *,
    workflow: Dict[str, Any],
    input_data: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Run workflow via praisonaiagents AgentFlow when steps are defined."""
    run_id = uuid.uuid4().hex[:12]
    started = time.time()
    input_data = input_data or {}
    text = input_data.get("text") or input_data.get("message") or str(input_data)

    raw_steps = workflow.get("steps") or []
    if not raw_steps:
        return _finish(
            run_id, workflow_id, workflow, input_data, started,
            status="failed", error="Workflow has no steps",
        )

    logs: list[str] = []
    pending: list[tuple[str, Any]] = []
    for index, step in enumerate(raw_steps):
        if isinstance(step, str):
            pending.append(("instruction", (index, step)))
            continue
        if isinstance(step, dict):
            kind = str(step.get("type") or "").strip().lower()
            handler = _LOCAL_STEPS.get(kind)
            if handler is not None:
                logs.append(handler(step))
                continue
            error = (
                f"Unknown workflow step type: {kind!r}"
                if kind
                else "Workflow step must be an instruction string or {type: 'log'}"
            )
            return _finish(
                run_id, workflow_id, workflow, input_data, started,
                status="failed", error=error,
            )
        pending.append(("as_is", step))

    if not pending:
        return _finish(
            run_id, workflow_id, workflow, input_data, started,
            status="completed", output={"logs": logs},
        )

    try:
        from praisonaiagents import Agent, AgentFlow

        steps = []
        for kind, value in pending:
            if kind == "instruction":
                index, instruction = value
                steps.append(
                    Agent(
                        name=f"step_{index + 1}",
                        instructions=instruction,
                        llm=workflow.get("model", "gpt-4o-mini"),
                    )
                )
            else:
                steps.append(value)
        flow = AgentFlow(steps=steps, name=workflow.get("name", "Workflow"))
        result = flow.run(text)
        output = result if isinstance(result, dict) else {"result": str(result)}
        if logs:
            output = {**output, "logs": logs}
        return _finish(
            run_id, workflow_id, workflow, input_data, started,
            status="completed", output=output,
        )
    except Exception as exc:
        return _finish(
            run_id, workflow_id, workflow, input_data, started,
            status="failed", error=str(exc),
        )


def _finish(
    run_id: str,
    workflow_id: str,
    workflow: Dict[str, Any],
    input_data: Dict[str, Any],
    started: float,
    *,
    status: str,
    output: Dict[str, Any] | None = None,
    error: str | None = None,
) -> Dict[str, Any]:
    record: Dict[str, Any] = {
        "id": run_id,
        "workflow_id": workflow_id,
        "workflow_name": workflow.get("name", ""),
        "status": status,
        "input": input_data,
        "started_at": started,
        "completed_at": time.time(),
    }
    if output is not None:
        record["output"] = output
    if error is not None:
        record["error"] = error
    return record
