"""Unit tests for MkDocs Material markdown preprocessing (mirrors frontend logic)."""

from __future__ import annotations

import re

MKDOCS_ICON_MAP = {
    ":material-file-document:": "📄",
    ":material-puzzle:": "🧩",
    ":material-palette:": "🎨",
}

TAB_HEADING_PREFIX = "\u200btab:"


def replace_mkdocs_icons(text: str) -> str:
    result = text
    for shortcode, emoji in MKDOCS_ICON_MAP.items():
        result = result.replace(shortcode, emoji)
    result = re.sub(r":material-[\w-]+:", "•", result)
    result = re.sub(r":octicons-[\w-]+(?:-\d+)?:", "•", result)
    return result


def strip_mkdocs_grid_wrappers(text: str) -> str:
    text = re.sub(r"<div[^>]*markdown[^>]*>\s*", "", text, flags=re.IGNORECASE)
    return re.sub(r"</div>\s*", "", text, flags=re.IGNORECASE)


def convert_mkdocs_tabs(md: str) -> str:
    lines = md.split("\n")
    out: list[str] = []
    i = 0

    while i < len(lines):
        tab_match = re.match(r'^===\s+"([^"]+)"\s*$', lines[i])
        if not tab_match:
            out.append(lines[i])
            i += 1
            continue

        title = tab_match.group(1)
        i += 1
        while i < len(lines) and lines[i].strip() == "":
            i += 1

        block: list[str] = []
        while i < len(lines):
            if re.match(r'^===\s+"[^"]+"\s*$', lines[i]):
                break
            if (
                lines[i].strip() == ""
                and i + 1 < len(lines)
                and re.match(r'^===\s+"[^"]+"\s*$', lines[i + 1])
            ):
                break

            if lines[i].startswith("    ") or lines[i].lstrip().startswith("```"):
                block.append(lines[i][4:] if lines[i].startswith("    ") else lines[i])
                i += 1
                continue

            if block and lines[i].strip() == "":
                block.append("")
                i += 1
                continue

            break

        out.append(f"### {TAB_HEADING_PREFIX}{title}")
        out.append("")
        out.extend(block)
        out.append("")

    return "\n".join(out)


def preprocess_mkdocs_markdown(md: str) -> str:
    result = strip_mkdocs_grid_wrappers(md)
    result = replace_mkdocs_icons(result)
    return convert_mkdocs_tabs(result)


class TestMkdocsPreprocess:
    def test_strip_grid_wrappers(self):
        md = '<div class="grid cards" markdown>\n\n- item\n\n</div>'
        assert "<div" not in preprocess_mkdocs_markdown(md)
        assert "</div>" not in preprocess_mkdocs_markdown(md)
        assert "- item" in preprocess_mkdocs_markdown(md)

    def test_replace_material_icons(self):
        md = "- :material-file-document: **YAML-Driven**"
        out = preprocess_mkdocs_markdown(md)
        assert "📄" in out
        assert ":material-file-document:" not in out

    def test_convert_tabs_with_indented_code(self):
        md = '''=== "Python"

    ```bash
    pip install praisonaiui
    ```

=== "Node.js"

    ```bash
    npm install praisonaiui
    ```
'''
        out = preprocess_mkdocs_markdown(md)
        assert '=== "Python"' not in out
        assert f"### {TAB_HEADING_PREFIX}Python" in out
        assert f"### {TAB_HEADING_PREFIX}Node.js" in out
        assert "pip install praisonaiui" in out
        assert "npm install praisonaiui" in out
        assert "```bash" in out

    def test_unknown_material_icon_becomes_bullet(self):
        md = ":material-unknown-icon:"
        out = preprocess_mkdocs_markdown(md)
        assert out == "•"
