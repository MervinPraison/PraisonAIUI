"""``::: package.module`` blocks: Python API reference from docstrings (compiler/python_api.py)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from typer.testing import CliRunner

from praisonaiui.cli import app as cli_app
from praisonaiui.compiler.python_api import ApiReferenceError, PythonApi
from praisonaiui.compiler.snippets import Snippets

CORE = '''"""Core client.

Use :class:`Client` to talk to <servers>.
"""
raise RuntimeError("never imported")


def connect(url: str, *, timeout: float = 5.0, **options) -> "Client":
    """Open a client.

    Args:
        url (str): Where to connect.
        timeout: Seconds to wait,
            then give up.
        retries (int, optional): Taken by ``**options``.

    Returns:
        Client: The connected client.

    Raises:
        ValueError: If ``url`` is empty.

    Example:
        >>> connect("http://x").ping()
        True
    """


class Client(Base):
    """A client.

    Parameters
    ----------
    url : str
        The server.
    verbose : bool, optional
        Print more.

    Notes
    -----
    Not thread safe.
    """

    retries: int = 3
    """How often to retry."""

    def __init__(self, url, verbose=False):
        self.url = url

    @property
    def closed(self) -> bool:
        """Whether it is closed."""

    async def fetch(self, path: str) -> bytes:
        """Fetch a path.

        :param path: The path.
        :type path: str
        :returns: The body.
        :rtype: bytes
        :raises KeyError: When missing.

        .. note:: Cached for a minute.
        """

    def _hidden(self):
        pass


def _private():
    pass
'''

INIT = '''"""Demo package."""
from .core import Client, connect

__all__ = ["Client", "connect", "VERSION"]

VERSION = "1.0"
"""The package version."""
'''


def _project(tmp_path: Path) -> Path:
    for name, text in {"src/demo/__init__.py": INIT, "src/demo/core.py": CORE}.items():
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_text(text, encoding="utf-8")
    return tmp_path


def test_google_numpy_and_rest_docstrings_render_with_fields(tmp_path):
    md = PythonApi(_project(tmp_path)).markdown("demo.core", {})
    assert md.startswith("## `demo.core` {#demo-core}\n\nCore client.\n\nUse `Client` to talk to &lt;servers>.")
    # Google: signature types and defaults, docstring text, a documented **kwargs key, returns, raises, example
    assert "def connect(url: str, *, timeout: float = 5.0, **options) -> Client\n```" in md
    assert '<ParamField name="url" type="str" required id="demo-core-connect-url">\n  Where to connect.\n</ParamField>' in md
    assert '<ParamField name="timeout" type="float" default="5.0" id="demo-core-connect-timeout">\n  Seconds to wait,\n  then give up.' in md
    assert '<ParamField name="retries" type="int" id="demo-core-connect-retries">' in md
    assert "**Returns**\n\n- `Client`: The connected client." in md
    assert "**Raises**\n\n- `ValueError`: If ``url`` is empty." in md
    assert '**Example**\n\n```python\n>>> connect("http://x").ping()\nTrue\n```' in md
    # NumPy: constructor parameters, a Notes callout, bases, attributes (annotated and property)
    assert "### `Client` {#demo-core-Client}\n\n```python\nClient(url, verbose=False)\n```\n\nBases: `Base`" in md
    assert '<ParamField name="verbose" type="bool" default="False" id="demo-core-Client-verbose">\n  Print more.' in md
    assert '<ResponseField name="retries" type="int" default="3" id="demo-core-Client-retries">\n  How often to retry.' in md
    assert '<ResponseField name="closed" type="bool" id="demo-core-Client-closed">' in md
    assert "<Note>\nNot thread safe.\n</Note>" in md
    # reST fields and directive; a method heading one level down
    assert "#### `Client.fetch()` {#demo-core-Client-fetch}\n\n```python\nasync def fetch(path: str) -> bytes" in md
    assert '<ParamField name="path" type="str" required id="demo-core-Client-fetch-path">\n  The path.' in md
    assert "- `bytes`: The body." in md and "- `KeyError`: When missing." in md
    assert "<Note>\nCached for a minute.\n</Note>" in md
    assert ":param" not in md and "_hidden" not in md and "_private" not in md


def test_all_and_reexports_members_option_and_private(tmp_path):
    api = PythonApi(_project(tmp_path))
    md = api.markdown("demo", {})
    # __all__ order; re-exported objects anchored by the documented path; a documented constant
    assert md.index("### `Client`") < md.index("### `connect()`")
    assert "{#demo-Client}" in md and "{#demo-Client-fetch}" in md
    assert '<ResponseField name="VERSION" default="\'1.0\'" id="demo-VERSION">\n  The package version.' in md
    only = api.markdown("demo.core.Client", {"members": ["fetch"], "heading_level": 3})
    assert only.startswith("### `Client`") and "#### `Client.fetch()`" in only
    assert "Client.closed" not in only
    assert "_hidden" in api.markdown("demo.core.Client", {"private": True})
    assert "#### " not in api.markdown("demo.core.Client", {"members": False, "heading_level": 3})
    source = api.markdown("demo.core.connect", {"show_source": True})
    assert '<Accordion title="Source code">' in source and "def connect(url: str" in source
    with pytest.raises(ApiReferenceError, match="has no member 'nope'"):
        api.markdown("demo.core.Client", {"members": ["nope"]})
    with pytest.raises(ApiReferenceError, match="no module 'missing'"):
        api.markdown("missing.mod", {})


def test_cache_follows_file_changes(tmp_path):
    api = PythonApi(_project(tmp_path))
    assert "Open a client." in api.markdown("demo.core.connect", {})
    core = tmp_path / "src/demo/core.py"
    core.write_text(CORE.replace("Open a client.", "Open a new client."), encoding="utf-8")
    os.utime(core, ns=(core.stat().st_mtime_ns + 10**9,) * 2)
    assert "Open a new client." in api.markdown("demo.core.connect", {})


def test_directive_in_snippets_pass_options_code_and_7016(tmp_path):
    _project(tmp_path)
    page = ("# API\n\n::: demo.core.Client\n    members: [fetch]\n    heading_level: 3\n\n"
            "```md\n::: demo.core\n```\n\n::: demo.gone\n\n::: demo.core\n    colour: red\n")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/api.md").write_text(page, encoding="utf-8")
    s = Snippets(tmp_path, tmp_path / "docs")
    text = s.read(tmp_path / "docs/api.md")
    assert "### `Client` {#demo-core-Client}" in text and "#### `Client.fetch()`" in text
    assert "```md\n::: demo.core\n```" in text  # in code: left alone
    found = sorted((i.code, i.line, i.message) for i in s.issues)
    assert [f[:2] for f in found] == [(7016, 11), (7016, 13)]
    assert "has no member 'gone'" in found[0][2] and "unknown option 'colour'" in found[1][2]
    assert "::: demo.gone" in text and len(s.errors()) == 2


def _site(tmp_path: Path, page: str) -> Path:
    _project(tmp_path)
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs/index.md").write_text(page, encoding="utf-8")
    (tmp_path / "aiui.yaml").write_text("site:\n  title: T\nseo:\n  site_url: https://example.com\n"
                                        "content:\n  docs:\n    dir: ./docs\n", encoding="utf-8")
    return tmp_path / "aiui.yaml"


def test_build_publishes_the_reference_everywhere(tmp_path):
    cfg, out = _site(tmp_path, "# API\n\n::: demo.core.connect\n"), tmp_path / "out"
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(out)])
    assert result.exit_code == 0, result.output
    assert '<ParamField name="url" type="str"' in (out / "docs/index.source.md").read_text()
    agent = (out / "docs/index.md").read_text()
    assert "- `url` (str, required)" in agent and "Where to connect." in agent
    assert "Where to connect." in (out / "llms-full.txt").read_text()
    assert "Seconds to wait" in (out / "search-index.json").read_text()
    report = json.loads(CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--format", "json"]).output)
    assert report["warnings"] == []


def test_build_fails_on_an_unknown_module_and_validate_reports_7016(tmp_path):
    cfg = _site(tmp_path, "# API\n\n::: demo.core.nothing\n")
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(tmp_path / "out")])
    assert result.exit_code != 0 and "has no member 'nothing'" in " ".join(result.output.split())
    report = json.loads(CliRunner().invoke(cli_app, ["validate", "-c", str(cfg), "--format", "json"]).output)
    assert (7016, "docs/index.md", 3) in {(w["code"], w["file"], w["line"]) for w in report["warnings"]}
    # content.docs.reference.paths: where modules are looked up
    (tmp_path / "docs/index.md").write_text("# API\n\n::: core.connect\n", encoding="utf-8")
    cfg.write_text(cfg.read_text() + "    reference:\n      paths: [src/demo]\n", encoding="utf-8")
    result = CliRunner().invoke(cli_app, ["build", "-c", str(cfg), "-o", str(tmp_path / "out")])
    assert result.exit_code == 0, result.output
    assert "{#core-connect}" in (tmp_path / "out/docs/index.source.md").read_text()
