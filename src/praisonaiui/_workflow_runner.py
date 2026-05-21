"""Default workflow runner — AgentFlow from registered workflow steps."""

from __future__ import annotations

import time
import uuid
from typing import Any, Dict


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

    try:
        from praisonaiagents import Agent, AgentFlow

        raw_steps = workflow.get("steps") or []
        if not raw_steps:
            return {
                "id": run_id,
                "workflow_id": workflow_id,
                "workflow_name": workflow.get("name", ""),
                "status": "failed",
                "input": input_data,
                "error": "Workflow has no steps",
                "started_at": started,
                "completed_at": time.time(),
            }

        steps = []
        for i, step in enumerate(raw_steps):
            if isinstance(step, str):
                steps.append(
                    Agent(
                        name=f"step_{i + 1}",
                        instructions=step,
                        llm=workflow.get("model", "gpt-4o-mini"),
                    )
                )
            else:
                steps.append(step)

        flow = AgentFlow(steps=steps, name=workflow.get("name", "Workflow"))
        result = flow.run(text)
        return {
            "id": run_id,
            "workflow_id": workflow_id,
            "workflow_name": workflow.get("name", ""),
            "status": "completed",
            "input": input_data,
            "output": result if isinstance(result, dict) else {"result": str(result)},
            "started_at": started,
            "completed_at": time.time(),
        }
    except Exception as exc:
        return {
            "id": run_id,
            "workflow_id": workflow_id,
            "workflow_name": workflow.get("name", ""),
            "status": "failed",
            "input": input_data,
            "error": str(exc),
            "started_at": started,
            "completed_at": time.time(),
        }
