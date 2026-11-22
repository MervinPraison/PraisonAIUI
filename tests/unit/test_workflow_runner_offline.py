"""Log workflow steps must finish without calling a model."""

import sys
import types

from praisonaiui._workflow_runner import run_workflow


def _workflow(steps):
    return {"name": "smoke", "steps": steps}


def test_log_step_completes_without_importing_agents(monkeypatch):
    def refuse(name, *args, **kwargs):
        if name == "praisonaiagents" or name.startswith("praisonaiagents."):
            raise AssertionError("log steps must not import praisonaiagents")
        return real_import(name, *args, **kwargs)

    real_import = __import__
    monkeypatch.setattr("builtins.__import__", refuse)
    result = run_workflow(
        "wf1",
        workflow=_workflow([{"type": "log", "message": "Integration test step"}]),
    )
    assert result["status"] == "completed"
    assert result["output"] == {"logs": ["Integration test step"]}
    assert result["completed_at"] >= result["started_at"]


def test_log_step_type_is_case_insensitive():
    result = run_workflow("wf1", workflow=_workflow([{"type": "Log", "message": "hi"}]))
    assert result["status"] == "completed"
    assert result["output"]["logs"] == ["hi"]


def test_unknown_step_fails_without_a_model():
    result = run_workflow(
        "wf1",
        workflow=_workflow([{"type": "chart", "message": "no"}]),
    )
    assert result["status"] == "failed"
    assert "chart" in result["error"]
    assert "output" not in result


def test_empty_steps_still_fail_fast():
    result = run_workflow("wf1", workflow=_workflow([]))
    assert result["status"] == "failed"
    assert result["error"] == "Workflow has no steps"


def test_log_plus_instruction_keeps_both(monkeypatch):
    calls = {}

    class Agent:
        def __init__(self, name, instructions, llm):
            calls["agent"] = (name, instructions, llm)

    class AgentFlow:
        def __init__(self, steps, name):
            calls["count"] = len(steps)

        def run(self, text):
            return {"result": text}

    module = types.ModuleType("praisonaiagents")
    module.Agent = Agent
    module.AgentFlow = AgentFlow
    monkeypatch.setitem(sys.modules, "praisonaiagents", module)

    result = run_workflow(
        "wf1",
        workflow=_workflow([
            {"type": "log", "message": "before"},
            "do the work",
        ]),
        input_data={"text": "go"},
    )
    assert result["status"] == "completed"
    assert result["output"]["result"] == "go"
    assert result["output"]["logs"] == ["before"]
    assert calls["count"] == 1
    assert calls["agent"][1] == "do the work"


def test_agent_object_is_still_passed_through(monkeypatch):
    sentinel = object()
    calls = {}

    class AgentFlow:
        def __init__(self, steps, name):
            calls["steps"] = steps

        def run(self, text):
            return "done"

    module = types.ModuleType("praisonaiagents")
    module.Agent = object
    module.AgentFlow = AgentFlow
    monkeypatch.setitem(sys.modules, "praisonaiagents", module)

    result = run_workflow("wf1", workflow=_workflow([sentinel]))
    assert result["status"] == "completed"
    assert calls["steps"] == [sentinel]
    assert result["output"] == {"result": "done"}


def test_string_steps_still_call_agentflow(monkeypatch):
    calls = {}

    class Agent:
        def __init__(self, name, instructions, llm):
            calls["agent"] = (name, instructions, llm)

    class AgentFlow:
        def __init__(self, steps, name):
            calls["steps"] = steps
            calls["name"] = name

        def run(self, text):
            calls["text"] = text
            return {"result": "ok"}

    module = types.ModuleType("praisonaiagents")
    module.Agent = Agent
    module.AgentFlow = AgentFlow
    monkeypatch.setitem(sys.modules, "praisonaiagents", module)

    result = run_workflow(
        "wf1",
        workflow={"name": "pipe", "model": "echo", "steps": ["say hello"]},
        input_data={"text": "go"},
    )
    assert result["status"] == "completed"
    assert result["output"]["result"] == "ok"
    assert calls["agent"] == ("step_1", "say hello", "echo")
    assert calls["text"] == "go"
    assert calls["name"] == "pipe"
