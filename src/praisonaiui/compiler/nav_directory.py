"""Directory listings (``directory: card | accordion`` on a nav group, or
``content.docs.nav.directory``): the build lists a group's pages on the group's
own page, or writes that page when the group has none. The listing is plain
``<CardGroup>`` / ``<AccordionGroup>`` markup, so the one Markdown pipeline
renders it; the agent-ready ``.md`` gets a link list."""

from __future__ import annotations

from pathlib import Path

from praisonaiui.compiler import agent_markdown as am


def _walk(items: list[dict]):
    for item in items:
        yield item
        yield from _walk(item.get("children") or [])


def listing(kind: str, pages: list[dict]) -> str:
    """The human listing of ``pages`` (nav items with a path) as docs components."""
    esc = lambda text: str(text).replace('"', "'").replace("<", "&lt;")  # noqa: E731 (one tag, read once)
    if kind == "accordion":
        rows = [f'<Accordion title="{esc(p["title"])}">\n{esc(p.get("description", ""))}\n\n'
                f'[Open {esc(p["title"])}]({p["path"]})\n</Accordion>' for p in pages]
        return "<AccordionGroup>\n" + "\n".join(rows) + "\n</AccordionGroup>\n"
    rows = [f'<Card title="{esc(p["title"])}" href="{esc(p["path"])}">{esc(p.get("description", ""))}</Card>' for p in pages]
    return "<CardGroup cols={2}>\n" + "\n".join(rows) + "\n</CardGroup>\n"


def write_directory_pages(nav: dict, output_dir: Path, docs_base: str, site: str) -> list[str]:
    """Append each listing group's pages to its page's published Markdown, or write the page."""
    written: list[str] = []
    base = docs_base.rstrip("/") or "/"
    for item in _walk(nav.get("items", [])):
        kind, path = item.get("directory"), item.get("path")
        pages = [c for c in item.get("children") or [] if c.get("path") and not c.get("hidden")]
        if not kind or not path or not pages:
            continue
        md = output_dir / am.page_md_path(path, base).lstrip("/")
        source = md.with_name(md.name[: -len(".md")] + am.SOURCE_SUFFIX)
        links = "\n".join(
            f"- [{c['title']}]({am.rewrite_target(c['path'], base, base, site)})"
            + (f": {c['description']}" if c.get("description") else "")
            for c in pages
        )
        if source.is_file():
            source.write_text(source.read_text(encoding="utf-8") + "\n\n" + listing(kind, pages), encoding="utf-8")
            if md.is_file():
                md.write_text(md.read_text(encoding="utf-8") + "\n" + links + "\n", encoding="utf-8")
        else:
            md.parent.mkdir(parents=True, exist_ok=True)
            source.write_text(f"# {item['title']}\n\n" + listing(kind, pages), encoding="utf-8")
            md.write_text(f"# {item['title']}\n\n{links}\n", encoding="utf-8")
            written.append(md.relative_to(output_dir).as_posix())
    return written
