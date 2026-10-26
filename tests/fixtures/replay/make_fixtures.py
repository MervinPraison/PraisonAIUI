"""Regenerate the PraisonAI Replay JSONL fixtures (contract v1, schema 1.1 + 1.0).

Run from the repo root::

    python tests/fixtures/replay/make_fixtures.py

The output is deterministic (fixed timestamps, no uuids) so the files are
committed and the tests compare against exact values.
"""

from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
T0 = 1767225600.0  # 2026-01-01T00:00:00Z


class _Run:
    """Tiny emitter that mimics ContextTraceEmitter's to_dict() output."""

    def __init__(self, session_id: str, run_id: str | None, schema: str = "1.1") -> None:
        self.session_id = session_id
        self.run_id = run_id
        self.schema = schema
        self.seq = 0
        self.events: list[dict] = []

    def emit(self, event_type: str, t: float, agent: str = "", data: dict | None = None, **kw) -> int:
        ev = {
            "schema_version": self.schema,
            "event_type": event_type,
            "timestamp": round(T0 + t, 3),
            "session_id": self.session_id,
            "agent_name": agent,
            "sequence_num": self.seq,
            "messages_count": kw.pop("messages_count", 0),
            "tokens_used": kw.pop("tokens_used", 0),
            "tokens_budget": kw.pop("tokens_budget", 0),
            "data": data or {},
            "prompt_tokens": kw.pop("prompt_tokens", 0),
            "completion_tokens": kw.pop("completion_tokens", 0),
            "cost_usd": kw.pop("cost_usd", 0.0),
        }
        for key in ("branch_id", "content_hash"):
            if kw.get(key) is not None:
                ev[key] = kw.pop(key)
            else:
                kw.pop(key, None)
        if self.schema != "1.0":
            if self.run_id:
                ev["run_id"] = self.run_id
            for key in ("parent_seq", "node_id"):
                if kw.get(key) is not None:
                    ev[key] = kw.pop(key)
                else:
                    kw.pop(key, None)
        ev.update(kw)  # unknown/extra fields pass straight through
        self.events.append(ev)
        self.seq += 1
        return ev["sequence_num"]

    def llm(self, t: float, agent: str, dur: float, parent: int | None, *, prompt: int, completion: int,
            cost: float, model: str = "gpt-4o-mini", finish: str = "stop", content: str = "",
            branch: str | None = None, node: str | None = None) -> None:
        self.emit("llm_request", t, agent, {"model": model}, parent_seq=parent, messages_count=3,
                  tokens_used=prompt, tokens_budget=128000, branch_id=branch, node_id=node)
        data = {"response_tokens": completion, "duration_ms": round(dur * 1000, 1),
                "finish_reason": finish, "model": model}
        if content:
            data["response_content"] = content
        self.emit("llm_response", t + dur, agent, data, parent_seq=parent, prompt_tokens=prompt,
                  completion_tokens=completion, cost_usd=cost, branch_id=branch, node_id=node)

    def tool(self, t: float, agent: str, name: str, args: dict, dur: float, parent: int | None, *,
             result: str, cost: float = 0.0, error: str | None = None, branch: str | None = None) -> None:
        node = f"tool:{agent}/{name}" if self.schema != "1.0" else None
        s = self.emit("tool_call_start", t, agent, {"tool_name": name, "tool_args": args},
                      parent_seq=parent, node_id=node, branch_id=branch)
        self.emit("tool_call_end", t + dur, agent,
                  {"tool_name": name, "result": result, "duration_ms": round(dur * 1000, 1), "error": error},
                  parent_seq=s if self.schema != "1.0" else None, node_id=node, cost_usd=cost, branch_id=branch)

    def write(self, name: str, *, partial_tail: str | None = None) -> None:
        path = HERE / name
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            for ev in self.events:
                fh.write(json.dumps(ev, separators=(",", ":")) + "\n")
            if partial_tail:
                fh.write(partial_tail)
        print(f"wrote {path.name}: {len(self.events)} events")


def team_handoff() -> None:
    """Hierarchical 2-agent team: Manager delegates, Researcher hands off to Writer.

    Researcher calls web_search three times in a row (collapses to x3); Writer
    asks for approval to run write_file, the human approves with edited args.
    """
    r = _Run("sess-team-01", "team-handoff-01")
    graph = {
        "schema": "praisonai.graph/1", "kind": "team", "name": "Solar sail brief", "process": "hierarchical",
        "nodes": [
            {"id": "start:begin", "kind": "start", "label": "Brief", "parent": None, "meta": {}},
            {"id": "manager:Manager", "kind": "manager", "label": "Manager", "parent": None, "meta": {}},
            {"id": "task:research", "kind": "task", "label": "research", "parent": None, "meta": {}},
            {"id": "task:write", "kind": "task", "label": "write", "parent": None, "meta": {}},
            {"id": "agent:Researcher", "kind": "agent", "label": "Researcher", "parent": None, "meta": {}},
            {"id": "agent:Writer", "kind": "agent", "label": "Writer", "parent": None, "meta": {}},
            {"id": "tool:Researcher/web_search", "kind": "tool", "label": "web_search", "parent": None, "meta": {}},
            {"id": "tool:Writer/write_file", "kind": "tool", "label": "write_file", "parent": None, "meta": {}},
            {"id": "human:you", "kind": "human", "label": "You", "parent": None, "meta": {}},
            {"id": "end:done", "kind": "end", "label": "Delivered", "parent": None, "meta": {}},
        ],
        "edges": [
            {"id": "start:begin->manager:Manager:next", "source": "start:begin", "target": "manager:Manager", "kind": "next", "label": None},
            {"id": "manager:Manager->task:research:delegates", "source": "manager:Manager", "target": "task:research", "kind": "delegates", "label": None},
            {"id": "manager:Manager->task:write:delegates", "source": "manager:Manager", "target": "task:write", "kind": "delegates", "label": None},
            {"id": "task:write->task:research:depends_on", "source": "task:write", "target": "task:research", "kind": "depends_on", "label": None},
            {"id": "task:research->agent:Researcher:assigned", "source": "task:research", "target": "agent:Researcher", "kind": "assigned", "label": None},
            {"id": "task:write->agent:Writer:assigned", "source": "task:write", "target": "agent:Writer", "kind": "assigned", "label": None},
            {"id": "agent:Researcher->agent:Writer:handoff", "source": "agent:Researcher", "target": "agent:Writer", "kind": "handoff", "label": None},
            {"id": "agent:Researcher->tool:Researcher/web_search:uses", "source": "agent:Researcher", "target": "tool:Researcher/web_search", "kind": "uses", "label": None},
            {"id": "agent:Writer->tool:Writer/write_file:uses", "source": "agent:Writer", "target": "tool:Writer/write_file", "kind": "uses", "label": None},
            {"id": "human:you->tool:Writer/write_file:reviews", "source": "human:you", "target": "tool:Writer/write_file", "kind": "reviews", "label": None},
            {"id": "agent:Writer->end:done:next", "source": "agent:Writer", "target": "end:done", "kind": "next", "label": None},
        ],
    }
    s0 = r.emit("session_start", 0.0, "", {"source": "record"})
    w = r.emit("workflow_start", 0.05, "", {"kind": "team", "name": "Solar sail brief", "process": "hierarchical",
                                           "graph": graph}, parent_seq=s0)
    r.emit("message_added", 0.1, "", {"role": "user", "content": "Write a short brief on solar sails."}, parent_seq=w)
    r.llm(0.2, "Manager", 0.6, w, prompt=210, completion=48, cost=0.000060, node="manager:Manager",
          content="Delegate research first, then writing.")
    r.emit("agent_handoff", 0.85, "Manager", {
        "from_agent": "Manager", "to_agent": "Researcher", "kind": "delegate",
        "reason": "Research has to come before writing.",
        "context_passed": {"task_snapshot": {"task": "research", "description": "Find three facts about solar sails",
                                             "expected_output": "3 bullet facts", "status": "not started"}},
    }, parent_seq=w, node_id="manager:Manager")
    t1 = r.emit("task_start", 0.9, "Researcher", {"name": "research", "agent": "Researcher",
                                                  "description_preview": "Find three facts about solar sails"},
                parent_seq=w, node_id="task:research")
    a1 = r.emit("agent_start", 0.95, "Researcher", {"role": "Researcher", "goal": "Find facts"},
                parent_seq=t1, node_id="agent:Researcher")
    r.emit("message_added", 1.0, "Researcher", {"role": "user", "content": "Find three facts about solar sails"},
           parent_seq=a1)
    r.llm(1.05, "Researcher", 0.9, a1, prompt=320, completion=40, cost=0.000072, finish="tool_calls",
          node="agent:Researcher")
    r.tool(2.0, "Researcher", "web_search", {"query": "solar sail facts"}, 1.2, a1,
           result="IKAROS (2010) was the first interplanetary solar sail.", cost=0.002)
    r.tool(3.25, "Researcher", "web_search", {"query": "solar sail missions"}, 1.1, a1,
           result="LightSail 2 raised its orbit using sunlight in 2019.", cost=0.002)
    r.tool(4.4, "Researcher", "web_search", {"query": "solar sail physics"}, 0.9, a1,
           result="Photon pressure at 1 AU is about 9 micronewtons per square metre.", cost=0.002)
    r.llm(5.35, "Researcher", 1.4, a1, prompt=880, completion=160, cost=0.000228, node="agent:Researcher",
          content="1. IKAROS ... 2. LightSail 2 ... 3. ~9 uN/m^2")
    r.emit("agent_end", 6.8, "Researcher", {"status": "completed"}, parent_seq=a1, node_id="agent:Researcher")
    r.emit("task_end", 6.85, "Researcher", {"status": "completed", "retries": 0, "duration_ms": 5950.0,
                                             "output_preview": "1. IKAROS ... 2. LightSail 2 ... 3. ~9 uN/m^2"},
           parent_seq=t1, node_id="task:research")
    r.emit("agent_handoff", 6.9, "Researcher", {
        "from_agent": "Researcher", "to_agent": "Writer", "kind": "handoff",
        "reason": "Facts gathered; needs drafting.",
        "context_passed": {"facts": ["IKAROS 2010", "LightSail 2 2019", "~9 uN/m^2 at 1 AU"]},
    }, parent_seq=w, node_id="agent:Researcher")
    t2 = r.emit("task_start", 6.95, "Writer", {"name": "write", "agent": "Writer",
                                               "description_preview": "Draft a 100-word brief into draft.md"},
                parent_seq=w, node_id="task:write")
    a2 = r.emit("agent_start", 7.0, "Writer", {"role": "Writer"}, parent_seq=t2, node_id="agent:Writer")
    r.llm(7.05, "Writer", 1.6, a2, prompt=640, completion=220, cost=0.000228, finish="tool_calls",
          node="agent:Writer")
    ap = r.emit("approval_requested", 8.7, "Writer", {
        "approval_id": "appr-0001", "tool": "write_file",
        "args": {"path": "draft.md", "content": "[REDACTED]"}, "risk": "high", "kind": "tool_call",
    }, parent_seq=a2, node_id="tool:Writer/write_file")
    r.emit("approval_decided", 11.2, "", {
        "approval_id": "appr-0001", "approved": True, "reason": "Use the docs folder.",
        "approver": "user", "modified": True,
    }, parent_seq=ap, node_id="tool:Writer/write_file")
    r.tool(11.25, "Writer", "write_file", {"path": "docs/draft.md", "content": "[REDACTED]"}, 0.05, a2,
           result="Wrote 642 bytes to docs/draft.md")
    r.llm(11.35, "Writer", 0.7, a2, prompt=900, completion=30, cost=0.000153, node="agent:Writer",
          content="Saved the brief to docs/draft.md.")
    r.emit("agent_end", 12.1, "Writer", {"status": "completed"}, parent_seq=a2, node_id="agent:Writer")
    r.emit("task_end", 12.15, "Writer", {"status": "completed", "retries": 0, "duration_ms": 5200.0,
                                          "output_preview": "Saved the brief to docs/draft.md."},
           parent_seq=t2, node_id="task:write")
    r.emit("workflow_end", 12.2, "", {"status": "completed", "duration_ms": 12150.0}, parent_seq=w)
    r.emit("session_end", 12.25, "", {}, parent_seq=s0)
    r.write("team_handoff.jsonl")


def flow_parallel_loop() -> None:
    """AgentFlow: plan -> parallel(gather news, papers) -> loop(polish x3) -> route(decide) -> publish.

    Both parallel branches run the same agent (Fetcher) so they must appear as
    two sub-lanes. Includes an unknown event type and an unknown field to prove
    readers tolerate them.
    """
    r = _Run("sess-flow-01", "flow-loop-01")
    graph = {
        "schema": "praisonai.graph/1", "kind": "flow", "name": "Weekly digest", "process": "flow",
        "nodes": [
            {"id": "start:begin", "kind": "start", "label": "Brief", "parent": None, "meta": {}},
            {"id": "step:plan", "kind": "step", "label": "plan", "parent": None, "meta": {"agent": "Planner"}},
            {"id": "step:gather", "kind": "fork", "label": "gather", "parent": None, "meta": {"pattern": "parallel"}},
            {"id": "step:news", "kind": "step", "label": "news", "parent": "step:gather", "meta": {"agent": "Fetcher"}},
            {"id": "step:papers", "kind": "step", "label": "papers", "parent": "step:gather", "meta": {"agent": "Fetcher"}},
            {"id": "step:merge", "kind": "join", "label": "merge", "parent": None, "meta": {}},
            {"id": "step:review_loop", "kind": "step", "label": "review_loop", "parent": None, "meta": {"pattern": "loop"}},
            {"id": "step:polish", "kind": "step", "label": "polish", "parent": "step:review_loop", "meta": {"agent": "Editor"}},
            {"id": "step:decide", "kind": "decision", "label": "decide", "parent": None, "meta": {"pattern": "route"}},
            {"id": "step:publish", "kind": "step", "label": "publish", "parent": None, "meta": {"agent": "Publisher"}},
            {"id": "step:archive", "kind": "step", "label": "archive", "parent": None, "meta": {}},
            {"id": "end:done", "kind": "end", "label": "Delivered", "parent": None, "meta": {}},
        ],
        "edges": [
            {"id": "start:begin->step:plan:next", "source": "start:begin", "target": "step:plan", "kind": "next", "label": None},
            {"id": "step:plan->step:gather:next", "source": "step:plan", "target": "step:gather", "kind": "next", "label": None},
            {"id": "step:gather->step:news:parallel", "source": "step:gather", "target": "step:news", "kind": "parallel", "label": None},
            {"id": "step:gather->step:papers:parallel", "source": "step:gather", "target": "step:papers", "kind": "parallel", "label": None},
            {"id": "step:news->step:merge:next", "source": "step:news", "target": "step:merge", "kind": "next", "label": None},
            {"id": "step:papers->step:merge:next", "source": "step:papers", "target": "step:merge", "kind": "next", "label": None},
            {"id": "step:merge->step:review_loop:next", "source": "step:merge", "target": "step:review_loop", "kind": "next", "label": None},
            {"id": "step:review_loop->step:polish:loop", "source": "step:review_loop", "target": "step:polish", "kind": "loop", "label": "until approved"},
            {"id": "step:polish->step:review_loop:loop", "source": "step:polish", "target": "step:review_loop", "kind": "loop", "label": None},
            {"id": "step:review_loop->step:decide:next", "source": "step:review_loop", "target": "step:decide", "kind": "next", "label": None},
            {"id": "step:decide->step:publish:routes", "source": "step:decide", "target": "step:publish", "kind": "routes", "label": "publish"},
            {"id": "step:decide->step:archive:routes", "source": "step:decide", "target": "step:archive", "kind": "routes", "label": "archive"},
            {"id": "step:publish->end:done:next", "source": "step:publish", "target": "end:done", "kind": "next", "label": None},
            {"id": "step:archive->end:done:next", "source": "step:archive", "target": "end:done", "kind": "next", "label": None},
        ],
    }
    s0 = r.emit("session_start", 0.0, "", {})
    w = r.emit("workflow_start", 0.02, "", {"kind": "flow", "name": "Weekly digest", "process": "flow",
                                           "graph": graph}, parent_seq=s0)
    sp = r.emit("step_start", 0.05, "Planner", {"name": "plan"}, parent_seq=w, node_id="step:plan")
    a = r.emit("agent_start", 0.06, "Planner", {}, parent_seq=sp, node_id="agent:Planner")
    r.llm(0.1, "Planner", 0.8, a, prompt=150, completion=60, cost=0.000059, node="agent:Planner")
    r.emit("agent_end", 0.95, "Planner", {}, parent_seq=a, node_id="agent:Planner")
    r.emit("step_end", 1.0, "Planner", {"status": "completed", "duration_ms": 950.0,
                                         "output_preview": "Gather news and papers."}, parent_seq=sp, node_id="step:plan")
    g = r.emit("step_start", 1.05, "", {"name": "gather", "pattern": "parallel"}, parent_seq=w, node_id="step:gather")
    # two branches interleaved in time, same agent
    b0 = r.emit("step_start", 1.1, "Fetcher", {"name": "news"}, parent_seq=g, node_id="step:news", branch_id="gather/0")
    b1 = r.emit("step_start", 1.1, "Fetcher", {"name": "papers"}, parent_seq=g, node_id="step:papers", branch_id="gather/1")
    r.emit("tool_call_start", 1.15, "Fetcher", {"tool_name": "fetch_rss", "tool_args": {"url": "https://example.org/news.rss"}},
           parent_seq=b0, node_id="tool:Fetcher/fetch_rss", branch_id="gather/0")
    r.emit("tool_call_start", 1.16, "Fetcher", {"tool_name": "search_papers", "tool_args": {"query": "agent tracing"}},
           parent_seq=b1, node_id="tool:Fetcher/search_papers", branch_id="gather/1")
    r.emit("tool_call_end", 2.4, "Fetcher", {"tool_name": "fetch_rss", "result": "12 items", "duration_ms": 1250.0, "error": None},
           parent_seq=r.seq - 2, node_id="tool:Fetcher/fetch_rss", branch_id="gather/0")
    r.emit("tool_call_end", 3.0, "Fetcher", {"tool_name": "search_papers", "result": "5 papers", "duration_ms": 1840.0, "error": None},
           parent_seq=r.seq - 2, node_id="tool:Fetcher/search_papers", branch_id="gather/1", cost_usd=0.001)
    r.emit("step_end", 2.45, "Fetcher", {"status": "completed", "duration_ms": 1350.0, "output_preview": "12 items"},
           parent_seq=b0, node_id="step:news", branch_id="gather/0")
    r.emit("step_end", 3.05, "Fetcher", {"status": "completed", "duration_ms": 1950.0, "output_preview": "5 papers"},
           parent_seq=b1, node_id="step:papers", branch_id="gather/1")
    r.emit("step_end", 3.1, "", {"status": "completed", "duration_ms": 2050.0}, parent_seq=g, node_id="step:gather")
    # an event type this reader has never heard of, plus an unknown field
    r.emit("context_rebalance", 3.12, "", {"note": "future event type"}, parent_seq=w, future_field={"x": 1})
    lp = r.emit("step_start", 3.15, "", {"name": "review_loop", "pattern": "loop"}, parent_seq=w, node_id="step:review_loop")
    t = 3.2
    for i in range(3):
        ps = r.emit("step_start", t, "Editor", {"name": "polish", "iteration": i + 1}, parent_seq=lp, node_id="step:polish")
        r.llm(t + 0.02, "Editor", 0.7, ps, prompt=400 + 50 * i, completion=90, cost=0.000114 + 0.0000075 * i,
              node="agent:Editor")
        r.emit("step_end", t + 0.75, "Editor", {"status": "completed", "duration_ms": 750.0,
                                                 "output_preview": f"Draft v{i + 2}"}, parent_seq=ps, node_id="step:polish")
        t += 0.8
    r.emit("step_end", t, "", {"status": "completed", "duration_ms": round((t - 3.15) * 1000, 1)},
           parent_seq=lp, node_id="step:review_loop")
    d = r.emit("step_start", t + 0.05, "", {"name": "decide", "pattern": "route"}, parent_seq=w, node_id="step:decide")
    r.emit("agent_handoff", t + 0.1, "Editor", {"from_agent": "Editor", "to_agent": "Publisher", "kind": "route",
                                                "reason": "Draft approved by reviewer score 0.92",
                                                "context_passed": {"score": 0.92}}, parent_seq=d, node_id="step:decide")
    r.emit("step_end", t + 0.15, "", {"status": "completed", "duration_ms": 100.0, "route": "publish"},
           parent_seq=d, node_id="step:decide")
    pb = r.emit("step_start", t + 0.2, "Publisher", {"name": "publish"}, parent_seq=w, node_id="step:publish")
    r.tool(t + 0.25, "Publisher", "post_to_blog", {"title": "Weekly digest"}, 0.6, pb, result="posted /digest/42")
    r.emit("step_end", t + 0.9, "Publisher", {"status": "completed", "duration_ms": 700.0, "output_preview": "posted"},
           parent_seq=pb, node_id="step:publish")
    r.emit("workflow_end", t + 0.95, "", {"status": "completed", "duration_ms": round((t + 0.93) * 1000, 1)}, parent_seq=w)
    r.emit("session_end", t + 1.0, "", {}, parent_seq=s0)
    r.write("flow_parallel_loop.jsonl")


def legacy_v10() -> None:
    """A schema 1.0 file: no run_id, parent_seq, node_id; no workflow events."""
    r = _Run("legacy-sess-10", None, schema="1.0")
    r.emit("session_start", 0.0, "", {})
    r.emit("agent_start", 0.1, "Assistant", {"role": "Assistant"})
    r.emit("message_added", 0.15, "Assistant", {"role": "user", "content": "What is 17 * 23?"}, messages_count=1)
    r.llm(0.2, "Assistant", 0.5, None, prompt=90, completion=20, cost=0.000026, finish="tool_calls")
    r.tool(0.75, "Assistant", "calculator", {"expression": "17*23"}, 0.01, None, result="391")
    r.llm(0.8, "Assistant", 0.4, None, prompt=130, completion=12, cost=0.000027)
    r.emit("agent_handoff", 1.25, "Assistant", {"from_agent": "Assistant", "to_agent": "Checker",
                                                "reason": "Double-check the arithmetic", "context_passed": {"answer": 391}})
    r.emit("agent_end", 1.26, "Assistant", {})
    r.emit("agent_start", 1.3, "Checker", {"role": "Checker"})
    r.llm(1.35, "Checker", 0.45, None, prompt=60, completion=8, cost=0.000014)
    r.emit("agent_end", 1.85, "Checker", {})
    r.emit("session_end", 1.9, "", {})
    r.write("legacy_v10.jsonl")


if __name__ == "__main__":
    team_handoff()
    flow_parallel_loop()
    legacy_v10()
