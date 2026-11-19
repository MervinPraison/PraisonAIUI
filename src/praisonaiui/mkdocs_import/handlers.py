"""Built-in MkDocs → PraisonAI UI handlers.

Each handler owns one slice of ``mkdocs.yml``. Replace one by registering
another handler with the same ``name``.
"""

from __future__ import annotations

from typing import Any, Optional
from urllib.parse import urlparse

from praisonaiui.mkdocs_import.loader import named_entries
from praisonaiui.mkdocs_import.model import (
    AiuiDraft,
    Finding,
    GroupDraft,
    MkDocsDocument,
    NavEntry,
    TabDraft,
)

_DROPPED_PLUGINS = {
    "mkdocstrings": "API pages are not generated from docstrings",
    "redirects": "redirect rules are not copied",
    "macros": "macros are not expanded",
    "awesome-pages": "awesome-pages nav files are not read",
    "git-revision-date": "revision dates are not copied",
    "git-revision-date-localized": "revision dates are not copied",
    "mike": "versioned docs are not copied",
    "mermaid2": "Mermaid fences still render; the mermaid2 plugin itself is not used",
}

_SOCIAL_KEYS = (
    ("github", "github"),
    ("x-twitter", "x"),
    ("twitter", "x"),
    ("youtube", "youtube"),
)


class SiteHandler:
    """Site name, description, URL, repository, and social links."""

    name = "site"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        raw = doc.raw
        title = _text(raw.get("site_name"))
        if title:
            draft.site_title = title
            findings.append(Finding("transferred", "site_name", f"Site title: {title}"))
        else:
            findings.append(Finding("note", "site_name", "site_name is missing; title is Docs"))

        description = _text(raw.get("site_description"))
        if description:
            draft.site_description = description

        site_url = _text(raw.get("site_url"))
        if site_url:
            draft.site_url = site_url.rstrip("/")

        repo_url = _text(raw.get("repo_url"))
        if not repo_url:
            repo_name = _text(raw.get("repo_name"))
            if repo_name and "/" in repo_name and " " not in repo_name:
                repo_url = f"https://github.com/{repo_name.strip('/')}"
        if repo_url:
            draft.repo_url = repo_url

        copyright_text = _text(raw.get("copyright"))
        if copyright_text:
            draft.copyright = (
                copyright_text.replace("&copy;", "©").replace("&#169;", "©").strip()
            )

        for key, href in _social_links(raw.get("extra")):
            draft.socials.setdefault(key, href)
        if draft.repo_url:
            draft.socials.setdefault("github", draft.repo_url)


class ContentHandler:
    """Docs directory and ``exclude_docs``."""

    name = "content"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        docs_dir = _text(doc.raw.get("docs_dir")) or "docs"
        draft.docs_dir = docs_dir
        findings.append(Finding("transferred", "docs_dir", f"Docs directory: {docs_dir}"))

        exclude = _exclude_patterns(doc.raw.get("exclude_docs"))
        if exclude:
            draft.exclude = exclude
            findings.append(
                Finding("transferred", "exclude_docs", f"Excluded {len(exclude)} path pattern(s)")
            )


class ThemeHandler:
    """PraisonAI UI Paper theme. MkDocs palette colours are not copied."""

    name = "theme"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        draft.preset = "paper"
        draft.mode = "system"
        theme = doc.raw.get("theme")
        if isinstance(theme, dict):
            for note in doc.loader_notes:
                if note.startswith("!ENV"):
                    findings.append(
                        Finding(
                            "note",
                            "theme_env",
                            "theme.name used !ENV. The shared praisonai-docs-theme package is not applied.",
                        )
                    )
                    break
            primary = _primary_colour(theme.get("palette"))
            if primary:
                findings.append(
                    Finding(
                        "note",
                        "theme",
                        f"MkDocs primary colour {primary!r} is not copied. The site uses the PraisonAI UI Paper theme.",
                    )
                )


class NavHandler:
    """MkDocs ``nav`` → docs tabs and groups. Page slugs keep their file stem."""

    name = "nav"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        nav = doc.raw.get("nav")
        if not isinstance(nav, list) or not nav:
            findings.append(Finding("note", "nav", "No nav list; the docs sidebar stays automatic."))
            return

        entries = _parse_nav(nav)
        draft.tabs = _tabs_from_entries(entries)
        pages = [page for tab in draft.tabs for group in tab.groups for page in group.pages]
        findings.append(
            Finding(
                "transferred",
                "nav",
                f"Navigation: {len(pages)} page(s) in {len(draft.tabs)} tab(s)",
            )
        )
        if _has_nested_section(entries):
            findings.append(
                Finding(
                    "note",
                    "nav_depth",
                    "Nested sections become groups inside their top-level tab.",
                )
            )


class PluginsHandler:
    """Search is kept. Other MkDocs plugins are reported and skipped."""

    name = "plugins"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        if "plugins" not in doc.raw:
            draft.search_enabled = True
            return

        names = [name for name, _options in named_entries(doc.raw.get("plugins"))]
        draft.search_enabled = "search" in names
        if draft.search_enabled:
            findings.append(Finding("transferred", "search", "Search stays enabled"))

        for name in names:
            if name == "search":
                continue
            reason = _DROPPED_PLUGINS.get(name, "this MkDocs plugin is not run")
            level: Any = "note" if name == "mermaid2" else "dropped"
            findings.append(Finding(level, f"plugin:{name}", f"{name}: {reason}"))


class MarkdownHandler:
    """Markdown stays as authored. Snippet includes are the one real loss."""

    name = "markdown"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        del draft
        names = [name for name, _options in named_entries(doc.raw.get("markdown_extensions"))]
        if not names:
            return
        if "pymdownx.snippets" in names:
            findings.append(
                Finding(
                    "dropped",
                    "snippets",
                    "pymdownx.snippets includes are not expanded; the include lines stay in the page.",
                )
            )
        findings.append(
            Finding(
                "note",
                "markdown",
                "Admonitions, tabs, tables, and Mermaid fences render in the docs page. Other extensions stay as Markdown.",
            )
        )


class ExtrasHandler:
    """Report MkDocs features that have no AIUI field. Nothing here is executed."""

    name = "extras"

    def apply(self, doc: MkDocsDocument, draft: AiuiDraft, findings: list[Finding]) -> None:
        del draft
        raw = doc.raw
        _drop(findings, raw, "hooks", "MkDocs hooks are not run")
        _drop(findings, raw, "watch", "watch paths are not copied")
        _drop(findings, raw, "edit_uri", "edit links are not copied")
        if raw.get("extra_css"):
            findings.append(Finding("dropped", "extra_css", "extra_css is not copied"))
        if raw.get("extra_javascript"):
            findings.append(Finding("dropped", "extra_javascript", "extra_javascript is not copied"))

        theme = raw.get("theme")
        if isinstance(theme, dict) and theme.get("custom_dir"):
            findings.append(
                Finding(
                    "dropped",
                    "custom_dir",
                    f"Theme overrides in {theme.get('custom_dir')} are not copied",
                )
            )

        for note in doc.loader_notes:
            if note.startswith("ignored YAML tag"):
                findings.append(Finding("dropped", "python_tag", note))

        extra = raw.get("extra")
        if isinstance(extra, dict) and any(key != "social" for key in extra):
            findings.append(
                Finding("dropped", "extra", "extra keys other than social links are not copied")
            )


def builtin_handlers() -> list[Any]:
    """Fresh built-in handlers, in the order they should run."""
    return [
        SiteHandler(),
        ContentHandler(),
        ThemeHandler(),
        NavHandler(),
        PluginsHandler(),
        MarkdownHandler(),
        ExtrasHandler(),
    ]


def _text(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _social_links(extra: Any) -> list[tuple[str, str]]:
    if not isinstance(extra, dict):
        return []
    social = extra.get("social")
    if not isinstance(social, list):
        return []
    found: list[tuple[str, str]] = []
    for item in social:
        if not isinstance(item, dict):
            continue
        href = _text(item.get("link") or item.get("href"))
        icon = (_text(item.get("icon")) or "").lower()
        if not href or not _http(href):
            continue
        for needle, key in _SOCIAL_KEYS:
            if needle in icon:
                found.append((key, href))
                break
    return found


def _http(href: str) -> bool:
    parsed = urlparse(href)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _exclude_patterns(value: Any) -> list[str]:
    lines: list[str] = []
    if isinstance(value, str):
        lines = value.splitlines()
    elif isinstance(value, list):
        lines = [str(item) for item in value]
    patterns: list[str] = []
    for line in lines:
        item = line.strip().lstrip("/")
        if not item or item.startswith("#"):
            continue
        if item.endswith("/"):
            name = item.rstrip("/")
            if name:
                patterns.append(f"{name}/**")
        else:
            patterns.append(item)
    return patterns


def _primary_colour(palette: Any) -> Optional[str]:
    entries = palette if isinstance(palette, list) else [palette]
    for entry in entries:
        if isinstance(entry, dict) and entry.get("primary"):
            return str(entry["primary"])
    return None


def _parse_nav(nav: list[Any]) -> list[NavEntry]:
    entries: list[NavEntry] = []
    for item in nav:
        entries.extend(_parse_item(item))
    return entries


def _parse_item(item: Any) -> list[NavEntry]:
    if isinstance(item, str):
        return [NavEntry(title=_title_from_path(item), slug=_slug(item))]
    if not isinstance(item, dict):
        return []
    entries: list[NavEntry] = []
    for title, value in item.items():
        if isinstance(value, str):
            entries.append(NavEntry(title=str(title), slug=_slug(value)))
        elif isinstance(value, list):
            children: list[NavEntry] = []
            for child in value:
                children.extend(_parse_item(child))
            entries.append(NavEntry(title=str(title), children=children))
    return entries


def _slug(path: str) -> str:
    text = path.strip().replace("\\", "/").lstrip("/")
    lower = text.lower()
    for ext in (".mdx", ".md"):
        if lower.endswith(ext):
            text = text[: -len(ext)]
            break
    return text or "index"


def _title_from_path(path: str) -> str:
    stem = _slug(path).split("/")[-1]
    if stem.lower() == "index":
        return "Home"
    return stem.replace("-", " ").replace("_", " ").title()


def _is_leaf(entry: NavEntry) -> bool:
    return bool(entry.slug) and not entry.children


def _tabs_from_entries(entries: list[NavEntry]) -> list[TabDraft]:
    leaves = [entry for entry in entries if _is_leaf(entry)]
    # A long list of loose pages would become one tab per page. Keep those together.
    collapse_leaves = len(leaves) > 8
    tabs: list[TabDraft] = []

    if collapse_leaves and leaves:
        tabs.append(TabDraft(tab="Documentation", groups=_groups_from_leaves(leaves)))

    for entry in entries:
        if collapse_leaves and _is_leaf(entry):
            continue
        if _is_leaf(entry) and entry.slug:
            tabs.append(
                TabDraft(
                    tab=entry.title,
                    groups=[GroupDraft(group=entry.title, pages=[entry.slug])],
                )
            )
            continue
        groups = _groups_from_section(entry)
        if groups:
            tabs.append(TabDraft(tab=entry.title, groups=groups))
    return tabs


def _groups_from_leaves(leaves: list[NavEntry]) -> list[GroupDraft]:
    return [GroupDraft(group=entry.title, pages=[entry.slug] if entry.slug else []) for entry in leaves]


def _groups_from_section(section: NavEntry) -> list[GroupDraft]:
    direct: list[str] = []
    groups: list[GroupDraft] = []
    for child in section.children:
        if child.children:
            pages = _flatten_slugs(child)
            if pages:
                groups.append(GroupDraft(group=child.title, pages=pages, prefix=_common_prefix(pages)))
        elif child.slug:
            direct.append(child.slug)
    if direct:
        groups.insert(
            0,
            GroupDraft(group=section.title, pages=direct, prefix=_common_prefix(direct)),
        )
    elif section.slug:
        groups.insert(0, GroupDraft(group=section.title, pages=[section.slug]))
    return [group for group in groups if group.pages]


def _flatten_slugs(entry: NavEntry) -> list[str]:
    found: list[str] = []
    if entry.slug:
        found.append(entry.slug)
    for child in entry.children:
        found.extend(_flatten_slugs(child))
    return found


def _common_prefix(slugs: list[str]) -> Optional[str]:
    prefixes: list[str] = []
    for slug in slugs:
        parts = slug.split("/")
        if len(parts) < 2 or not parts[0]:
            return None
        prefixes.append(parts[0])
    if prefixes and len(set(prefixes)) == 1:
        return prefixes[0]
    return None


def _has_nested_section(entries: list[NavEntry]) -> bool:
    for entry in entries:
        for child in entry.children:
            if child.children:
                return True
    return False


def _drop(findings: list[Finding], raw: dict[str, Any], key: str, message: str) -> None:
    if raw.get(key):
        findings.append(Finding("dropped", key, message))
