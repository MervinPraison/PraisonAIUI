"""Content languages: ``navigation.languages`` (docs/features/navigation.md#languages).

The default language is served at the docs root; every other one from its folder
(``docs/fr/guide.md`` at ``/docs/fr/guide``). With versions, a language folder sits
inside the version's folder (``docs/v1/fr/`` at ``/docs/v1/fr/...``). Each page names
its translations (``hreflang`` links, sitemap alternates) and its ``<html lang>``.
The browser mirror is ``src/frontend/src/docs/languages.ts``.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path

from praisonaiui.compiler import versions
from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.compiler.seo import is_noindex

#: The ``seo`` map key of a page's translation in ``code`` (seo.render writes a ``<link rel=alternate>``).
HREFLANG = "hreflang:"


def resolved(navigation) -> list[tuple[object, str]]:
    """``(language, folder)`` pairs; the default language (the first ``default: true``, else the first) has ``""``."""
    langs = list(navigation.languages) if navigation else []
    if not langs:
        return []
    default = next((lang for lang in langs if lang.default), langs[0])
    return [(lang, "" if lang is default else lang.language) for lang in langs]


def roots(navigation) -> tuple[str, ...]:
    """The folders whose pages are top-level sidebar entries: each version's and language's,
    and each language's inside each version (``v1``, ``fr``, ``v1/fr``)."""
    vs = [sub for _, sub in versions.resolved(navigation)] or [""]
    ls = [sub for _, sub in resolved(navigation)] or [""]
    return tuple(dict.fromkeys("/".join(p for p in (v, lang) if p) for v in vs for lang in ls if v or lang))


def split(path: str, navigation, base: str) -> tuple[str, object, str, str]:
    """A page path as ``(version root, language, language folder, rest)``:
    ``/docs/v1/fr/guide`` is ``("/docs/v1", fr, "fr", "/guide")``."""
    pair = versions.version_of(path, versions.resolved(navigation), base)
    root = versions.prefix(pair[1] if pair else "", base)
    rest = path[len(root):]
    langs = resolved(navigation)
    for lang, sub in langs:
        if sub and (rest == f"/{sub}" or rest.startswith(f"/{sub}/")):
            return root, lang, sub, rest[len(sub) + 1:]
    return root, next(lang for lang, sub in langs if not sub), "", rest


def apply(nav: dict, navigation, base: str) -> tuple[dict[str, str], set[str]]:
    """Name each indexable page's translations in its ``seo`` map (``hreflang:<code>`` and
    ``hreflang:x-default``, the default language's page); returns each page's language code
    and the pages kept out of ``llms.txt`` (other languages, unless ``index: true``)."""
    langs = resolved(navigation)
    if not langs:
        return {}, set()
    items: dict[str, dict] = {}

    def walk(entries: list[dict]) -> None:
        for item in entries:
            if item.get("path"):
                items.setdefault(item["path"], item)
            walk(item.get("children") or [])

    walk(nav.get("items", []))

    def find(path: str) -> str | None:  # a folder's page by either name: /docs/fr and /docs/fr/index
        bare = path.removesuffix("/index")
        return next((p for p in (path, bare, f"{bare}/index") if p in items), None)

    code: dict[str, str] = {}
    other: set[str] = set()
    for path, item in items.items():
        root, lang, sub, rest = split(path, navigation, base)
        code[path] = lang.language
        if sub and not lang.index:
            other.add(path)
        seo = item.get("seo") or {}
        if item.get("noindex") or is_noindex(seo.get("robots")):
            continue
        alts = {lg.language: find(f"{root}/{s}{rest}" if s else root + rest) for lg, s in langs if not lg.hidden}
        alts = {c: p for c, p in alts.items() if p and not items[p].get("noindex")}
        if len(alts) > 1:
            default = next(lg.language for lg, s in langs if not s)
            extra = {f"{HREFLANG}{c}": p for c, p in alts.items()}
            if default in alts:
                extra[f"{HREFLANG}x-default"] = alts[default]
            item["seo"] = {**extra, **seo}
    return code, other


def issues(navigation, docs_dir: Path) -> list[ContentIssue]:
    """7020: two languages with one code, more than one default, or a version folder inside a
    language folder (``docs/fr/v1/``: a language goes inside its version, ``docs/v1/fr/``)."""
    langs = resolved(navigation)
    out: list[ContentIssue] = []
    hint = "Give each language its own code; mark one language `default: true`"
    for name, n in Counter(lang.language for lang, _ in langs).items():
        if n > 1:
            out.append(ContentIssue(7020, "navigation", 0, f"{n} languages use the code '{name}'", hint))
    if sum(bool(lang.default) for lang, _ in langs) > 1:
        out.append(ContentIssue(7020, "navigation", 0, "more than one language is marked default: true", hint))
    for _, lsub in langs:
        for _, vsub in versions.resolved(navigation):
            if lsub and vsub and (docs_dir / lsub / vsub).is_dir():
                out.append(ContentIssue(7020, f"docs/{lsub}/{vsub}", 0,
                                        f"version folder '{vsub}' is inside language folder '{lsub}'",
                                        f"Move it to docs/{vsub}/{lsub}/ (a language goes inside its version)"))
    return out
