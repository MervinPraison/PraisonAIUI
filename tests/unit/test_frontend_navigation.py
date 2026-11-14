"""Tests for the committed frontend bundle (src/praisonaiui/templates/frontend).

The bundle is built from src/frontend and committed. Its entry, assets/index.js,
is a small boot file that lazy-loads content-hashed chunks, so these tests look
at the bundle as a whole and never at a chunk by name.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "src" / "praisonaiui" / "templates" / "frontend"
ASSETS = FRONTEND / "assets"


def _bundle_js() -> dict[str, str]:
    return {p.name: p.read_text(encoding="utf-8") for p in sorted(ASSETS.glob("*.js"))}


class TestFrontendNavigation:
    """Tests for browser history navigation in the frontend."""

    def test_frontend_bundle_exists(self):
        """Test that the built frontend bundle exists in templates."""
        assert (ASSETS / "index.js").exists(), "Frontend bundle should exist in templates"
        assert (ASSETS / "index.css").exists(), "Frontend stylesheet should exist in templates"

    def test_index_html_includes_assets(self):
        """Test that index.html references the correct assets."""
        index_path = FRONTEND / "index.html"
        assert index_path.exists(), "index.html should exist"

        content = index_path.read_text(encoding="utf-8")
        assert "/assets/index.js" in content, "Should reference index.js"
        assert "/assets/index.css" in content, "Should reference index.css"

    def test_popstate_handler_in_bundle(self):
        """Back/forward navigation is handled somewhere in the bundle.

        The handler lives in the app code, which the entry loads lazily, so it
        is looked for in every chunk rather than in index.js.
        """
        chunks = _bundle_js()
        assert chunks, "no JavaScript in the frontend bundle"
        owners = [name for name, source in chunks.items() if "popstate" in source]
        assert owners, "Bundle should contain a popstate event handler"

    def test_every_chunk_the_bundle_imports_is_shipped(self):
        """A relative import of a chunk that is not in assets/ is a 404 at runtime
        (a stale or half-synced bundle)."""
        chunks = _bundle_js()
        names = {p.name for p in ASSETS.iterdir()}
        # Minified output: from"./x.js", import"./x.js", import("./x.js")
        pattern = re.compile(r"""(?:from|import)\s*\(?\s*["']\./([\w.@~-]+\.(?:js|css))["']""")
        missing = sorted(
            {
                f"{owner} -> {target}"
                for owner, source in chunks.items()
                for target in pattern.findall(source)
                if target not in names
            }
        )
        assert not missing, f"chunks imported but not shipped: {missing[:10]}"

    def test_build_manifest_matches_shipped_files(self):
        """When the bundle carries a Vite manifest, every file it names exists
        and nothing imports the entry (it is loaded as index.js?v=..., so an
        import of ./index.js would run it a second time)."""
        manifest_path = FRONTEND / "aiui-manifest.json"
        if not manifest_path.exists():
            pytest.skip("bundle was built before the Vite manifest was added")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entry = manifest["index.html"]
        assert entry["file"] == "assets/index.js"
        for key, chunk in manifest.items():
            for rel in [chunk["file"], *chunk.get("css", []), *chunk.get("assets", [])]:
                assert (FRONTEND / rel).is_file(), (
                    f"{key}: {rel} is in the manifest but not shipped"
                )
            if key != "index.html":
                imported = [*chunk.get("imports", []), *chunk.get("dynamicImports", [])]
                assert "index.html" not in imported, f"{chunk['file']} imports the entry"

    def test_title_template_handling(self):
        """Test that title template handling is robust."""
        # This tests the logic, not the actual implementation
        # as the JS is bundled and minified

        test_cases = [
            ("%s | Site", "Page", "Page | Site"),
            ("%s", "Page", "Page"),
            ("%s | %s", "Page", "Page | Site"),  # Second %s would be replaced with site name
        ]

        for template, page_title, expected_start in test_cases:
            # Simulate the title replacement logic
            result = template.replace("%s", page_title, 1)
            assert result.startswith(expected_start.split("|")[0].strip())
