"""Ask AI over a built docs site on ``aiui serve`` / ``aiui dev`` (docs_assistant.py,
docs/features/ai-ready-docs.md#ask-ai): retrieval and citations, the event stream with
a fake model (no real API call ever), the no-key fallback, search, the config switch
and the guards."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from starlette.testclient import TestClient

from praisonaiui import docs_assistant as da
from praisonaiui.cli import _static_site_app
from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config

DOCS = {
    "index.md": "---\ntitle: Home\n---\n# Home\n\nWelcome to Acme.\n",
    "guide/install.md": "---\ntitle: Install\n---\n# Install\n\n## Using pip\n\nRun pip install acme to "
    "get the package.\n\n## Upgrading\n\nRun pip install --upgrade acme for newer releases.\n",
    "guide/themes.md": "---\ntitle: Themes\n---\n# Themes\n\n## Presets\n\nPick a preset theme in aiui.yaml.\n",
}


def _build(tmp_path: Path, extra: str = "") -> Path:
    for rel, text in DOCS.items():
        f = tmp_path / "docs" / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(text, encoding="utf-8")
    config = Config.model_validate(
        yaml.safe_load(f"site: {{title: Acme Docs}}\ncontent:\n  docs:\n    dir: docs\n{extra}")
    )
    out = tmp_path / "out"
    assert Compiler(config, base_path=tmp_path).compile(output_dir=out).success
    return out


def _events(text: str) -> list[tuple[str, object]]:
    out = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


class FakeLlm:
    """Records what it was asked and streams a cited answer."""

    def __init__(self, chunks=("Run `pip install acme` ", "[1]."), fail: bool = False):
        self.chunks, self.fail, self.calls = chunks, fail, []

    async def __call__(self, model: str, msgs: list):
        self.calls.append((model, msgs))
        for c in self.chunks:
            yield c
        if self.fail:
            raise da.LlmError("The model provider answered HTTP 401.")


def _client(out: Path, llm=None, monkeypatch=None) -> TestClient:
    """The served site; with ``llm`` a (fake) key is set and the model is ``llm``."""
    if llm is not None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
        monkeypatch.setattr(da, "stream_completion", llm)
    return TestClient(_static_site_app(out))


@pytest.fixture(autouse=True)
def _no_key(monkeypatch):
    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_BASE", "AIUI_ASSISTANT_MODEL", "OPENAI_MODEL_NAME"):
        monkeypatch.delenv(name, raising=False)


def test_retrieve_ranks_sections_and_finds_a_long_question(tmp_path: Path, monkeypatch) -> None:
    index = json.loads((_build(tmp_path) / "search-index.json").read_text())
    prepared = da.prepare(index)
    # Not every word is in one section: the loose ranking still finds it.
    hits = da.retrieve(index, prepared, "How can I upgrade acme to the newest version please?")
    assert hits[0]["path"] == "/docs/guide/install#upgrading"
    assert [h["n"] for h in hits] == list(range(1, len(hits) + 1))
    assert "--upgrade" in hits[0]["text"]


def test_ask_streams_sources_then_a_cited_answer(tmp_path: Path, monkeypatch) -> None:
    llm = FakeLlm()
    client = _client(_build(tmp_path, "    assistant: {instructions: Say Acme in capitals.}\n"), llm, monkeypatch)
    res = client.post("/api/docs/ask", json={"question": "How do I install with pip?",
                                             "history": [{"role": "user", "content": "hi"}, {"role": "x", "content": "y"}]})
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/event-stream")
    events = _events(res.text)
    assert [e[0] for e in events] == ["sources", "text", "text", "done"]
    first = events[0][1][0]
    assert first["n"] == 1 and first["url"] == "/docs/guide/install#using-pip" and "text" not in first
    assert "".join(e[1]["text"] for e in events if e[0] == "text") == "Run `pip install acme` [1]."
    model, msgs = llm.calls[0]
    assert model == "gpt-4o-mini"
    assert "[1] Install > Using pip (/docs/guide/install#using-pip)" in msgs[0]["content"]
    assert "Say Acme in capitals." in msgs[0]["content"] and "Acme Docs" in msgs[0]["content"]
    assert [m["role"] for m in msgs] == ["system", "user", "user"]  # the bad history turn is dropped


def test_quoted_passage_reaches_the_model(tmp_path: Path, monkeypatch) -> None:
    llm = FakeLlm()
    client = _client(_build(tmp_path), llm, monkeypatch)
    client.post("/api/docs/ask", json={"question": "What does this do?", "context": "pip install --upgrade acme",
                                       "page": "/docs/guide/install"})
    ask = llm.calls[0][1][-1]["content"]
    assert ask.startswith("About this passage on /docs/guide/install:\n\n> pip install --upgrade acme")


def test_without_a_key_the_reader_gets_the_sections(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(_static_site_app(_build(tmp_path)))
    config = client.get("/ui-config.json").json()
    assert config["assistant"] == {"url": "/api/docs/ask", "ai": False}
    assert config["mcp"]["url"] == "/mcp"  # both entries on one config
    events = _events(client.post("/api/docs/ask", json={"question": "preset theme"}).text)
    assert [e[0] for e in events] == ["sources", "unavailable"]
    assert events[0][1][0]["path"].startswith("/docs/guide/themes")


def test_a_failed_model_call_is_an_error_event(tmp_path: Path, monkeypatch) -> None:
    client = _client(_build(tmp_path), FakeLlm(chunks=(), fail=True), monkeypatch)
    events = _events(client.post("/api/docs/ask", json={"question": "install"}).text)
    assert events[-1] == ("error", {"message": "The model provider answered HTTP 401."})


def test_search_endpoint(tmp_path: Path, monkeypatch) -> None:
    client = TestClient(_static_site_app(_build(tmp_path)))
    results = client.get("/api/docs/search", params={"q": "upgrade", "limit": "2"}).json()["results"]
    assert results[0]["url"] == "/docs/guide/install#upgrading" and "score" not in results[0]
    assert client.get("/api/docs/search").json() == {"results": []}


def test_config_starters_endpoint_and_off_switch(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")
    out = _build(tmp_path, "    assistant: {starters: ['How do I install?'], endpoint: 'https://api.example.com/api/docs/ask'}\n"
                           "    mcp: false\n")
    built = json.loads((out / "ui-config.json").read_text())["assistant"]
    assert built == {"starters": ["How do I install?"], "endpoint": "https://api.example.com/api/docs/ask"}
    served = TestClient(_static_site_app(out)).get("/ui-config.json").json()
    assert served["assistant"]["ai"] is True and served["assistant"]["starters"] == ["How do I install?"]
    assert "sk-test" not in json.dumps(served)

    off = _build(tmp_path / "off", "    assistant: false\n")
    client = TestClient(_static_site_app(off))
    assert client.get("/ui-config.json").json()["assistant"] is False
    assert client.post("/api/docs/ask", json={"question": "x"}).status_code != 200
    with pytest.raises(ValueError):
        Config.model_validate({"site": {"title": "x"}, "content": {"docs": {"dir": "d", "assistant": {"endpoint": "ftp://x"}}}})


@pytest.mark.parametrize("body, code", [
    ({"question": ""}, 400),
    ({"question": "x" * (da.MAX_QUESTION + 1)}, 400),
    ([1, 2], 400),
    ({"question": "x", "context": "y" * (da.MAX_BODY_BYTES + 1)}, 413),
])
def test_bad_bodies_are_refused(tmp_path: Path, monkeypatch, body, code) -> None:
    client = _client(_build(tmp_path), FakeLlm(), monkeypatch)
    assert client.post("/api/docs/ask", json=body).status_code == code


def test_guards(tmp_path: Path, monkeypatch) -> None:
    client = _client(_build(tmp_path), FakeLlm(), monkeypatch)
    assert client.get("/api/docs/ask").status_code == 405
    assert client.post("/api/docs/ask", content=b"q", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 415
    cross = client.post("/api/docs/ask", json={"question": "x"}, headers={"origin": "https://evil.example", "sec-fetch-site": "cross-site"})
    assert cross.status_code == 403
    # text/plain (no preflight from a static host) is accepted
    assert client.post("/api/docs/ask", content=json.dumps({"question": "install"}),
                       headers={"content-type": "text/plain"}).status_code == 200
    codes = [client.post("/api/docs/ask", json={"question": "install"}).status_code for _ in range(da.RATE_LIMIT)]
    assert codes[-1] == 429


def test_sse_deltas_reads_an_openai_stream() -> None:
    lines = [b'data: {"choices":[{"delta":{"role":"assistant"}}]}\n', b"\n",
             b'data: {"choices":[{"delta":{"content":"Hello"}}]}\n', b": keep-alive\n",
             b'data: {"choices":[{"delta":{"content":" [1]"}}]}\n', b"data: [DONE]\n",
             b'data: {"choices":[{"delta":{"content":"late"}}]}\n']
    assert list(da.sse_deltas(lines)) == ["Hello", " [1]"]


def test_model_and_readiness_come_from_the_environment() -> None:
    assert da.model_name(None, {}) == "gpt-4o-mini"
    assert da.model_name(None, {"OPENAI_MODEL_NAME": "m1", "AIUI_ASSISTANT_MODEL": "m2"}) == "m2"
    assert da.model_name("cfg", {"AIUI_ASSISTANT_MODEL": "m2"}) == "cfg"
    assert not da.llm_ready("gpt-4o-mini", {})
    assert da.llm_ready("gpt-4o-mini", {"OPENAI_API_KEY": "k"})
    assert da.llm_ready("llama3", {"OPENAI_BASE_URL": "http://localhost:11434/v1"})


def test_the_standard_library_client_streams_from_a_compatible_server(monkeypatch) -> None:
    """A local OpenAI-compatible server stands in for the provider (no network)."""
    import asyncio
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    seen = {}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):  # noqa: N802
            seen["path"], seen["auth"] = self.path, self.headers.get("Authorization")
            seen["body"] = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            status = 401 if seen["body"]["model"] == "bad" else 200
            self.send_response(status)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if status == 200:
                for t in ("Hi", " [1]"):
                    self.wfile.write(f'data: {{"choices":[{{"delta":{{"content":"{t}"}}}}]}}\n\n'.encode())
                self.wfile.write(b"data: [DONE]\n\n")

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("OPENAI_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-real")

    async def run(model):
        return [t async for t in da.stream_completion(model, [{"role": "user", "content": "q"}])]

    try:
        assert asyncio.run(run("local-model")) == ["Hi", " [1]"]
        assert seen["path"] == "/v1/chat/completions" and seen["auth"] == "Bearer sk-test-not-real"
        assert seen["body"]["stream"] is True and seen["body"]["model"] == "local-model"
        with pytest.raises(da.LlmError, match="HTTP 401"):
            asyncio.run(run("bad"))
    finally:
        server.shutdown()
