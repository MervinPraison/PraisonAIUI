"""Docs markdown has one retry layer: the React docs loader.

src/frontend/src/docs/docLoader.ts gives every .md request a time limit per
attempt, retries it with a fresh request and caches the answer. The legacy
fetch-retry plugin used to retry .md too, only after a failure (so a stalled
request still hung for its full 20-30 s) and even after the reader had moved
on (an aborted request). Two layers would multiply attempts.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FETCH_RETRY = ROOT / "src/praisonaiui/templates/frontend/plugins/fetch-retry.js"
CONTENT = ROOT / "src/frontend/src/Content.tsx"
LOADER = ROOT / "src/frontend/src/docs/docLoader.ts"


def test_fetch_retry_leaves_markdown_to_the_docs_loader():
    source = FETCH_RETRY.read_text(encoding="utf-8")
    assert ".md'" not in source and '.md"' not in source
    for manifest in ("docs-nav.json", "ui-config.json", "route-manifest.json"):
        assert manifest in source


def test_fetch_retry_never_retries_an_aborted_request():
    source = FETCH_RETRY.read_text(encoding="utf-8")
    assert "AbortError" in source
    assert "isAbort(err, init)" in source


def test_docs_content_loads_through_the_bounded_loader():
    content = CONTENT.read_text(encoding="utf-8")
    assert "loadDoc(mdUrl, controller.signal)" in content
    assert "fetch(mdUrl" not in content  # no unbounded fetch of its own
    loader = LOADER.read_text(encoding="utf-8")
    assert "ATTEMPT_TIMEOUTS_MS = [5_000, 5_000, 10_000]" in loader
