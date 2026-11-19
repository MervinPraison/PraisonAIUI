"""The split search index (compiler/search_index.py write_shards, searchShards.ts).

``search-index.json`` stays as it was; ``search-index/`` holds the same entries in
parts. ``src/frontend/src/docs/search-shards.fixture.json`` is this writer's output
for a fixed index: the frontend test ranks every query over it and over the whole
index and expects the same results, so the two sides cannot drift apart. Regenerate
it with ``AIUI_REGEN_FIXTURES=1 pytest tests/unit/test_search_shards.py``.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from praisonaiui.compiler import Compiler
from praisonaiui.compiler.search_index import SHARDS_DIR, tokenize, write_shards
from praisonaiui.schema.models import Config

FIXTURE = Path(__file__).resolve().parents[2] / "src/frontend/src/docs/search-shards.fixture.json"


def _compact(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _written(root: Path) -> dict:
    return {p.relative_to(root).as_posix(): json.loads(p.read_text(encoding="utf-8"))
            for p in sorted(root.rglob("*.json"))}


def test_the_frontend_fixture_is_this_writers_output(tmp_path):
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    write_shards(tmp_path, fixture["full"]["pages"], _compact(fixture["full"]), fixture["shardChars"])
    files = _written(tmp_path / SHARDS_DIR)
    if os.environ.get("AIUI_REGEN_FIXTURES"):
        FIXTURE.write_text(json.dumps({**fixture, "files": files}, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    assert files == fixture["files"], "regenerate: AIUI_REGEN_FIXTURES=1 pytest tests/unit/test_search_shards.py"
    assert len(fixture["files"]["meta.json"]["shards"]) > 3  # several word files, as on a real site


def test_tokenize_finds_the_words_the_dialog_finds():
    # searchRank.ts: text.toLowerCase().match(/[\p{L}\p{N}]+/gu)
    assert tokenize("Run `aiui build` (v2): ÉCOLE, naïve-café; 2026!") == ["run", "aiui", "build", "v2", "école", "naïve", "café", "2026"]
    assert tokenize("snake_case x.y") == ["snake", "case", "x", "y"]
    assert tokenize("தமிழ்") == ["தம", "ழ"]  # vowel signs are marks (Mc/Mn), not letters, in both
    assert tokenize("Straße ٣٤") == ["straße", "٣٤"]


def test_meta_counts_words_and_postings_point_at_sections(tmp_path):
    pages = [
        {"p": "/docs/a", "t": "A", "d": "", "s": [{"h": "", "a": "", "l": 1, "x": "alpha beta alpha"},
                                                  {"h": "Beta", "a": "beta", "l": 2, "x": "gamma"}], "k": ["kw"], "b": 2.0},
        {"p": "/docs/b", "t": "B", "d": "", "s": [{"h": "Gamma", "a": "g", "l": 2, "x": "beta"}]},
    ]
    files = write_shards(tmp_path, pages, "{}")
    meta = json.loads((tmp_path / SHARDS_DIR / "meta.json").read_text(encoding="utf-8"))
    assert meta["version"] == 2 and len(meta["key"]) == 10
    assert meta["pages"][0] == {"p": "/docs/a", "s": [["", "", 3], ["Beta", "beta", 3]], "k": ["kw"], "b": 2.0}
    assert meta["pages"][1] == {"p": "/docs/b", "s": [["Gamma", "g", 3]]}  # heading counted twice
    assert meta["words"] == ["alpha", "beta", "gamma"] and meta["shards"] == [0]
    w0 = json.loads((tmp_path / SHARDS_DIR / meta["key"] / "w0.json").read_text(encoding="utf-8"))
    # Section ids 0, 1, 2 as gaps; counts over one after a colon.
    assert w0 == ["0:2", "0,1:2,1", "1,1:2"]
    assert json.loads((tmp_path / SHARDS_DIR / meta["key"] / "p1.json").read_text(encoding="utf-8")) == ["beta"]
    assert sorted(files) == sorted([f"{SHARDS_DIR}/meta.json", f"{SHARDS_DIR}/{meta['key']}/w0.json",
                                    f"{SHARDS_DIR}/{meta['key']}/p0.json", f"{SHARDS_DIR}/{meta['key']}/p1.json"])


def _build(tmp_path: Path, **docs) -> Path:
    (tmp_path / "docs").mkdir(exist_ok=True)
    (tmp_path / "docs" / "index.md").write_text("---\ntitle: Home\n---\n\nWelcome home.\n\n## Install\n\npip install aiui\n")
    (tmp_path / "docs" / "guide.md").write_text("---\ntitle: Guide\n---\n\nA guide to quasars.\n")
    data = {"site": {"title": "S"}, "style": "docs", "content": {"docs": {"dir": "docs", **docs}}}
    out = tmp_path / "out"
    result = Compiler(Config.model_validate(data), base_path=tmp_path).compile(out)
    assert result.success, result.error
    return out


def test_a_build_writes_both_and_the_parts_match_the_whole_file(tmp_path):
    out = _build(tmp_path)
    full = json.loads((out / "search-index.json").read_text(encoding="utf-8"))
    assert full["version"] == 1 and {p["p"] for p in full["pages"]} >= {"/docs/guide"}  # unchanged format
    meta = json.loads((out / SHARDS_DIR / "meta.json").read_text(encoding="utf-8"))
    assert [p["p"] for p in meta["pages"]] == [p["p"] for p in full["pages"]]
    for i, page in enumerate(full["pages"]):
        text = json.loads((out / SHARDS_DIR / meta["key"] / f"p{i}.json").read_text(encoding="utf-8"))
        assert text == [s["x"] for s in page["s"]]
    assert "quasars" in meta["words"]


def test_a_rebuild_replaces_the_parts_and_search_off_removes_them(tmp_path):
    out = _build(tmp_path)
    old = json.loads((out / SHARDS_DIR / "meta.json").read_text(encoding="utf-8"))["key"]
    (tmp_path / "docs" / "guide.md").write_text("---\ntitle: Guide\n---\n\nA guide to pulsars.\n")
    data = {"site": {"title": "S"}, "style": "docs", "content": {"docs": {"dir": "docs"}}}
    assert Compiler(Config.model_validate(data), base_path=tmp_path).compile(out).success
    assert [p.name for p in (out / SHARDS_DIR).iterdir() if p.is_dir()] != [old]  # one key folder, the new one
    assert len([p for p in (out / SHARDS_DIR).iterdir() if p.is_dir()]) == 1
    off = {**data, "search": {"enabled": False}}
    assert Compiler(Config.model_validate(off), base_path=tmp_path).compile(out).success
    assert not (out / SHARDS_DIR).exists()


def test_a_site_with_sign_in_has_no_parts_and_hides_stale_ones(tmp_path, monkeypatch):
    monkeypatch.setenv("DOCS_PASSWORD", "pass")
    out = _build(tmp_path, auth={"password": "env:DOCS_PASSWORD"})
    assert (out / "search-index.json").is_file()
    assert not (out / SHARDS_DIR).exists()  # not cut per reader: the dialog reads the filtered whole file
    (out / SHARDS_DIR / "k").mkdir(parents=True)  # left by an older build
    (out / SHARDS_DIR / "meta.json").write_text("{}")
    from praisonaiui.cli import _static_site_app

    site = TestClient(_static_site_app(out), base_url="http://localhost")
    assert site.get("/search-index/meta.json").status_code == 404


@pytest.mark.parametrize("name", ["meta.json"])
def test_parts_are_compact_json(tmp_path, name):
    out = _build(tmp_path)
    assert "\n" not in (out / SHARDS_DIR / name).read_text(encoding="utf-8")
