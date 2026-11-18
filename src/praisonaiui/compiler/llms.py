"""``llms.txt`` and ``llms-full.txt`` (docs/features/ai-ready-docs.md).

``llms.txt`` has one ``##`` section per nav group linking each page's agent-ready
``.md``; ``llms-full.txt`` holds those pages. Both are also at ``/.well-known/``;
a file of the same name next to ``aiui.yaml`` is published instead.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from praisonaiui.compiler.agent_markdown import instructions_block

if TYPE_CHECKING:
    from praisonaiui.compiler.compiler import Compiler


def _indexed(c: Compiler, items: list[dict]) -> list[dict]:
    return [p for p in c._collect_nav_pages({"items": items}) if not p["noindex"]]


def _header(c: Compiler) -> list[str]:
    site = c.config.site
    lines = [f"# {site.title}", "", f"> {site.description or f'Documentation for {site.title}'}"]
    block = instructions_block(c.config.markdown.instructions if c.config.markdown else None)
    return lines + ["", block] if block else lines


def _index(c: Compiler, items: list[dict], full: bool) -> str:
    """One section per top-level nav group; pages outside a group first, as ``Docs``."""
    loose = [item for item in items if not item.get("children")]
    sections = [("Docs", _indexed(c, loose))]
    sections += [(item["title"], _indexed(c, [item])) for item in items if item.get("children")]
    lines = _header(c)
    for name, pages in sections:
        lines += ["", f"## {name}", ""] if pages else []
        for page in pages:
            entry = f"- [{page['title']}]({c._md_url(page['path'])})"
            lines.append(f"{entry}: {page['description']}" if page["description"] else entry)
    if c._spec_files:  # OpenAPI specs, as published (openapi/<slug>.json)
        lines += ["", "## OpenAPI specs", ""]
        lines += [f"- [{title}]({c._absolute_url('/' + file)})" for title, file in c._spec_files]
    if full:
        url = c._absolute_url("/llms-full.txt")
        lines += ["", "## Optional", "", f"- [Complete documentation]({url}): All pages in one file"]
    return "\n".join(lines) + "\n"


def _full(c: Compiler, pages: list[dict]) -> str:
    parts = ["\n".join(_header(c))]
    for page in pages:
        src = c._resolve_md_source(page["path"])
        if src:
            md = c._agent_markdown(src, page["title"], page["description"], instructions=False)
            first, _, rest = md.partition("\n")
            parts.append(f"{first}\n\nSource: {c._page_url(page['path'].rstrip('/') or '/')}\n{rest.rstrip()}")
    return "\n\n---\n\n".join(parts) + "\n" if len(parts) > 1 else ""


def write_llms_files(c: Compiler, output_dir: Path, nav: dict) -> list[str]:
    """Write llms-full.txt and llms.txt (and their /.well-known/ copies); return their paths."""
    names = ("llms-full.txt", "llms.txt")
    for name in names:
        (output_dir / name).unlink(missing_ok=True)
        (output_dir / ".well-known" / name).unlink(missing_ok=True)
    items = nav.get("items", [])
    if c._site_noindex() or not _indexed(c, items):
        return []
    files: list[str] = []
    for name in names:
        custom = c._custom_root_file(name)
        if custom:
            text = custom.read_text(encoding="utf-8")
        elif name == "llms.txt":
            text = _index(c, items, full="llms-full.txt" in files)
        else:
            text = _full(c, _indexed(c, items))
        for path in (output_dir / name, output_dir / ".well-known" / name) if text else ():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            files.append(path.relative_to(output_dir).as_posix())
    return files
