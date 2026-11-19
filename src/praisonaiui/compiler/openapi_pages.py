"""Endpoint pages from OpenAPI specs (docs/features/openapi.md).

``build_api_reference`` turns each loaded spec into one Markdown page per
operation and webhook, written with the docs components a hand-written API page
uses (``<ParamField>``, ``<ResponseField>``, ``<Expandable>``, ``<Tabs>`` for
``oneOf``/``anyOf``, ``<RequestExample>`` (compiler/code_samples.py), ``<ResponseExample>``) and the
``<ApiPlayground>`` endpoint bar (its Try-it data: compiler/playground.py). The compiler
publishes them like any page (one pipeline, R3): the browser renders the source,
the agent ``.md`` export, ``llms*.txt``, the sitemap and site search come from it. The sidebar
entries go where the spec is named: a group's pages, a tab's groups, or an
"API Reference" group for ``api.openapi``.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from praisonaiui.compiler.openapi import (
    ApiSpec,
    Operation,
    SpecSource,
    endpoint_ref,
    find_operation,
    same_source,
    spec_sources,
)
from praisonaiui.schema.models import NavGroupConfig

if TYPE_CHECKING:
    from pathlib import Path

    from praisonaiui.compiler.docs_scanner import DocPage
    from praisonaiui.schema.models import Config

DEFAULT_DIRECTORY = "api-reference"
MAX_DEPTH = 6  # nested properties shown below a field
_CYCLE = object()  # sample(): a schema repeating one it sits in
LIVE = ("interactive", "auth")  # display modes with Try it
_PARAMS = (("path", "Path parameters"), ("query", "Query parameters"),
           ("header", "Headers"), ("cookie", "Cookies"))


@dataclass
class ApiPage:
    """One generated endpoint page: its docs slug, sidebar group path and source."""

    slug: str  # "api-reference/pets/list-pets" (route: /docs/<slug>)
    title: str
    description: str
    text: str  # the Markdown source, front matter included
    group: tuple[str, ...]  # sidebar group labels, outermost first; () ungrouped
    hidden: bool  # x-hidden: built, routable, not in the sidebar
    order: int = 0  # the group's place in the spec's `tags` list
    playground: dict | None = None  # Try-it data, published as openapi/try/<slug>.json (compiler/playground.py)
    frontmatter: dict = field(default_factory=dict)  # from the operation's x-aiui metadata (sidebarTitle, tag, ...)
    pointer: str = ""  # the operation's JSON pointer in its spec


@dataclass
class Embed:
    """A hand-written page showing one endpoint: front matter ``openapi:`` (``spec`` and ``op``
    set: the generated reference joins the page) or ``api:`` (neither: the bar and Try it
    from the page's own ``<ParamField>``s, compiler/playground.py ``manual_data``)."""

    slug: str
    method: str  # "GET", or "webhook"
    path: str  # the path, or the webhook name
    mode: str  # playground display: front matter `playground:`, else api.playground.display
    spec: ApiSpec | None = None
    op: Operation | None = None
    playground: dict | None = None  # Try-it data (openapi/try/<slug>.json)
    frontmatter: dict = field(default_factory=dict)  # the page's own


@dataclass
class ApiSection:
    """The pages of one spec placed at one config location (``ref.where``)."""

    ref: SpecSource
    spec: ApiSpec
    pages: list[ApiPage] = field(default_factory=list)
    listed: set[str] = field(default_factory=set)  # pointers of operations navigation lists: only these get pages

    @property
    def location(self) -> str:
        return self.ref.where.split(".openapi")[0]  # "navigation.tabs[0].groups[1]", or "api"

    def entries(self) -> list[str | NavGroupConfig]:
        """Sidebar entries: ungrouped pages, then one group per tag (nested by
        3.2 ``parent``), in the spec's tag order. x-hidden pages are left out.
        None when navigation lists the operations (they sit where listed)."""
        root: dict = {"pages": [], "groups": {}}
        if self.listed:
            return []
        for page in sorted(self.pages, key=lambda p: p.order):
            if page.hidden:
                continue
            node = root
            for label in page.group:
                node = node["groups"].setdefault(label, {"pages": [], "groups": {}})
            node["pages"].append(page.slug)

        def build(node: dict) -> list[str | NavGroupConfig]:
            return [*node["pages"], *(NavGroupConfig(group=label, pages=build(child))
                                      for label, child in node["groups"].items())]

        return build(root)


@dataclass
class ApiReference:
    """Every generated page, and the config with their sidebar entries placed."""

    sections: list[ApiSection]
    config: "Config"  # navigation with the spec entries added (ui-config tabs, manual sidebar)
    extra: list[NavGroupConfig]  # entries for `api.openapi` specs, at the end of the sidebar
    embeds: dict["Path", Embed] = field(default_factory=dict)  # hand-written endpoint pages by file
    issues: list[tuple["Path | None", str, str]] = field(default_factory=list)  # (page or None: config, key, message)

    @property
    def pages(self) -> list[ApiPage]:
        return [p for s in self.sections for p in s.pages]

    def sidebar_extra(self, manual: bool) -> list[NavGroupConfig]:
        """Entries the sidebar adds after its own. Without a manual sidebar the
        tab groups only assign pages to tabs, so their spec parts come here."""
        if manual or not self.config.navigation:
            return self.extra
        slugs = {p.slug for p in self.pages}
        tabs = [t for t in self.config.navigation.tabs]
        found = [_only(g, slugs, t.hidden) for t in tabs for g in t.groups]
        return [g for g in found if g] + self.extra


def _only(group: NavGroupConfig, slugs: set[str], hidden: bool) -> NavGroupConfig | None:
    """``group`` with only its generated pages (and groups holding some), or None."""
    pages = [_only(p, slugs, False) if hasattr(p, "group") else p for p in group.pages
             if hasattr(p, "group") or (isinstance(p, str) and p in slugs)]  # not `{label, href}` links
    pages = [p for p in pages if p]
    update = {"pages": pages, "root": None, "directory": None, "hidden": group.hidden or hidden}
    return group.model_copy(update=update) if pages else None


def kebab(text: str | None) -> str:
    """``listPets`` / ``list_pets`` / ``List pets`` -> ``list-pets``."""
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", str(text or ""))
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def _path(text: str | None) -> str:
    """``/API/v2/`` -> ``api/v2``: kebab-case segments (no ``..``, never leaves the docs folder)."""
    return "/".join(filter(None, map(kebab, str(text or "").split("/"))))


def op_slug(op: Operation) -> str:
    """operationId (stable when the summary is reworded), else summary, else method and path."""
    return kebab(op.operation_id) or kebab(op.summary) or kebab(
        f"{op.method} {re.sub(r'[{}]', '', op.path)}") or "endpoint"


def _tags(spec: ApiSpec) -> dict[str, dict]:
    return {str(t["name"]): t for t in spec.document.get("tags") or []
            if isinstance(t, dict) and t.get("name") is not None}


def tag_label(tag: dict, name: str) -> str:
    """A group's label: ``x-group``, ``x-displayName``, ``summary`` (3.2), then the name."""
    return str(tag.get("x-group") or tag.get("x-displayName") or tag.get("summary") or name)


def nav_tag(op: Operation, tags: dict[str, dict]) -> str | None:
    """The tag whose group holds ``op``: its first tag of ``kind`` nav (or none)."""
    return next((t for t in op.tags if tags.get(t, {}).get("kind", "nav") == "nav"), None)


def group_path(name: str | None, tags: dict[str, dict]) -> tuple[str, ...]:
    """Labels from the outermost 3.2 ``parent`` down to ``name`` (a cycle stops the walk)."""
    out: list[str] = []
    seen: set[str] = set()
    while name is not None and name not in seen:
        seen.add(name)
        out.insert(0, tag_label(tags.get(name, {}), name))
        parent = tags.get(name, {}).get("parent")
        name = str(parent) if parent is not None and str(parent) in tags else None
    return tuple(out)


def page_settings(op: Operation) -> dict:
    """An operation's ``x-aiui`` (over ``x-mint``, the key other docs tools write): ``metadata``
    (front matter: title, sidebarTitle, description, playground, tag, og:*, ...), ``content``
    (Markdown above the generated part) and ``href`` (the page URL)."""
    out: dict = {"metadata": {}}
    for key in ("x-mint", "x-aiui"):
        ext = op.extensions.get(key)
        if isinstance(ext, dict):
            out.update({k: v for k, v in ext.items() if k != "metadata"})
            out["metadata"].update(ext["metadata"] if isinstance(ext.get("metadata"), dict) else {})
    return out


def _nav_entries(config: "Config") -> list[tuple[str, int, tuple]]:
    """``(group location, index, endpoint_ref)`` for each ``METHOD /path`` entry in navigation."""
    out: list[tuple[str, int, tuple]] = []

    def walk(pages: list, where: str) -> None:
        for k, p in enumerate(pages):
            if hasattr(p, "group"):
                walk(p.pages, f"{where}.pages[{k}]")
            elif ref := endpoint_ref(p):
                out.append((where, k, ref))

    nav = config.navigation
    for i, t in enumerate(nav.tabs if nav else []):
        for j, g in enumerate(t.groups):
            walk(g.pages, f"navigation.tabs[{i}].groups[{j}]")
    for j, g in enumerate(nav.groups if nav else []):
        walk(g.pages, f"navigation.groups[{j}]")
    walk(nav.pages if nav else [], "navigation")
    return out


def _inside(where: str, location: str) -> bool:
    return where == location or where.startswith(location + ".") or location == "api"


def build_api_reference(config: "Config", specs: dict[str, ApiSpec], taken: set[str] | None = None,
                        written: "list[DocPage] | None" = None) -> ApiReference | None:
    """Pages for every spec the config names, or None when it names none.
    ``taken``: slugs of hand-written pages; a generated page never replaces one.
    ``written``: hand-written pages with ``openapi:`` or ``api:`` front matter (:class:`Embed`)."""
    from praisonaiui.compiler.playground import (  # it builds on this module
        playground_data,
        playground_mode,
    )
    refs = spec_sources(config)
    in_nav = {r.source for r in refs if not r.where.startswith("api.")}
    taken = set(taken or ())
    params = config.api.params if config.api else None
    expand = bool(params and params.expanded == "all")
    examples = config.api.examples if config.api else None
    languages = examples.languages if examples else None
    prefill = examples.prefill if examples else True
    sections: list[ApiSection] = []
    done: set[tuple] = set()
    for ref in refs:
        spec = specs.get(ref.source)
        key = (ref.source, ref.directory)
        if spec is None or not spec.document or key in done or (
                ref.where.startswith("api.") and ref.source in in_nav):
            continue
        done.add(key)
        sections.append(ApiSection(ref, spec))
    issues: list[tuple[Path | None, str, str]] = []
    embeds: dict[Path, Embed] = {}
    claimed: dict[tuple[str, str], str] = {}  # (spec source, operation pointer) -> the page showing it
    ordered = list({id(s): s for s in [*(x.spec for x in sections), *specs.values()] if s.document}.values())
    for page in written or ():
        fm, key = page.frontmatter, "openapi" if "openapi" in page.frontmatter else "api"
        ref = endpoint_ref(fm.get(key))
        mode = playground_mode(config.api, fm)
        if key == "api" and ref and not ref[0] and ref[1] != "webhook":
            embeds[page.path.resolve()] = Embed(page.slug, ref[1], ref[2], mode, frontmatter=fm)
            continue
        hit = next(((sp, op) for sp in ordered if ref and (not ref[0] or same_source(sp.source, ref[0]))
                    and (op := find_operation(sp, ref[1], ref[2]))), None) if key == "openapi" else None
        if hit is None:
            issues.append((page.path, key, _missing(key, fm.get(key), ref, specs)))
            continue
        sp, op = hit
        embeds[page.path.resolve()] = Embed(page.slug, ref[1], ref[2], mode, sp, op, playground_data(sp, op, prefill)
                                  if mode in LIVE and not op.webhook else None, fm)
        claimed.setdefault((sp.source, op.pointer), page.slug)
    chosen: dict[tuple[str, int], tuple[ApiSection, Operation] | str | None] = {}
    for where, k, (file, method, path) in _nav_entries(config):
        near = sorted((s for s in sections if _inside(where, s.location)), key=lambda s: -len(s.location))
        cands = [s for s in sections if same_source(s.spec.source, file)] if file else [*near, *sections]
        hit = next(((s, op) for s in cands if (op := find_operation(s.spec, method, path))), None)
        if hit is None:
            issues.append((None, "navigation", _missing("navigation", f"{file or ''} {method} {path}".strip(),
                                                        (file, method, path), specs)))
        elif (hit[0].spec.source, hit[1].pointer) in claimed:
            hit = claimed[(hit[0].spec.source, hit[1].pointer)]
        elif _inside(where, hit[0].location):
            hit[0].listed.add(hit[1].pointer)
        chosen[(where, k)] = hit
    for hit in chosen.values():  # listed elsewhere, from a spec whose own group lists operations
        if isinstance(hit, tuple) and hit[0].listed:
            hit[0].listed.add(hit[1].pointer)
    if not sections and not embeds and not chosen:
        return None
    for s in sections:
        skip = {p for (src, p) in claimed if src == s.spec.source}
        s.pages = _pages(s.spec, s.ref.directory, taken, expand, languages, config.api, prefill, s.listed, skip)
    slugs = {(s.spec.source, p.pointer): p.slug for s in sections for p in s.pages}
    found = {at: hit if isinstance(hit, str) or hit is None else slugs.get((hit[0].spec.source, hit[1].pointer))
             for at, hit in chosen.items()}
    return ApiReference(sections, *_place(config, sections, found), embeds, issues)


def _missing(key: str, value: object, ref: tuple | None, specs: dict[str, ApiSpec]) -> str:
    if ref is None:
        form = "'METHOD /path'" if key == "api" else "'METHOD /path', 'spec.yaml METHOD /path' or 'webhook name'"
        return f"{key}: {value!r} should be {form}"
    if ref[0] and not any(same_source(s, ref[0]) for s in specs):
        return f"{key}: '{value}' names a spec that is not loaded ({ref[0]})"
    return f"{key}: '{value}' matches no operation in {'that spec' if ref[0] else 'the OpenAPI specs'}"


def _pages(spec: ApiSpec, directory: str | None, taken: set[str], expand: bool = False,
           languages: list[str] | None = None, api: Any = None, prefill: bool = True,
           only: set[str] | None = None, skip: set[str] | None = None) -> list[ApiPage]:
    """``only``: pointers of the operations to build (all when empty); ``skip``: ones a hand-written page shows."""
    from praisonaiui.compiler.playground import TRY_DIR, playground_data, playground_mode
    tags = _tags(spec)
    order = {name: i for i, name in enumerate(tags)}
    folder = _path(directory) or DEFAULT_DIRECTORY
    pages = []
    for op in spec.operations:
        if op.excluded or (only and op.pointer not in only) or op.pointer in (skip or ()):
            continue
        tag = nav_tag(op, tags)
        group = group_path(tag, tags) or (("Webhooks",) if op.webhook else ())
        settings = page_settings(op)
        meta = {k: v for k, v in settings.pop("metadata").items() if isinstance(k, str) and (
            isinstance(v, (str, int, float, bool)) or (isinstance(v, list) and all(isinstance(x, str) for x in v)))}
        href = settings.get("href") if isinstance(settings.get("href"), str) else ""
        slug = _path(re.sub(r"^/?docs/", "", href)) or "/".join(x for x in (
            folder, kebab(tag) if tag else "webhooks" if op.webhook else "", op_slug(op)) if x)
        n, base = 1, slug
        while slug in taken:  # a duplicate gets -2, -3 (never replaces a page)
            n += 1
            slug = f"{base}-{n}"
        taken.add(slug)
        title = str(meta.pop("title", "") or op.summary or kebab(op.operation_id).replace("-", " ").capitalize()
                    or f"{op.method} {op.path}")
        description = str(meta.pop("description", "") or _first_line(op.description) or (
            f"Webhook {op.path}" if op.webhook else f"{op.method} {op.path}"))
        mode = playground_mode(api, meta)
        live = mode in LIVE and not op.webhook
        content = settings.get("content") if isinstance(settings.get("content"), str) else ""
        text = page_markdown(spec, op, title, description, expand=expand, languages=languages, playground=mode,
                             src=f"/{TRY_DIR}/{slug}.json" if live else "", meta=meta, content=content)
        pages.append(ApiPage(slug, title, description, text, group, op.hidden,
                             order.get(tag, len(order)) if tag else len(order) + 1 if op.webhook else -1,
                             playground_data(spec, op, prefill) if live else None, meta, op.pointer))
    return pages


def _place(config: "Config", sections: list[ApiSection],
           found: dict[tuple[str, int], str | None]) -> tuple["Config", list[NavGroupConfig]]:
    """The config with each section's entries where it is named, ``METHOD /path`` entries
    replaced by their page (``found``; None: dropped), and the ``api.openapi`` sections'
    "API Reference" groups."""
    at: dict[str, list[ApiSection]] = {}
    for s in sections:
        at.setdefault(s.location, []).append(s)

    def entries(pages: list, where: str) -> list:
        out = [group(p, f"{where}.pages[{k}]") if hasattr(p, "group") else found.get((where, k), p)
               for k, p in enumerate(pages)]
        return [p for p in out if p is not None]

    def group(g: NavGroupConfig, where: str) -> NavGroupConfig:
        pages = entries(g.pages, where) + [e for s in at.get(where, []) for e in s.entries()]
        return g.model_copy(update={"pages": pages})

    def wrapped(s: ApiSection, label: str) -> list[NavGroupConfig]:
        items = s.entries()
        loose = [e for e in items if isinstance(e, str)]
        return [NavGroupConfig(group=label, pages=loose)] * bool(loose) + [
            e for e in items if not isinstance(e, str)]

    nav = config.navigation
    if nav:
        tabs = []
        for i, t in enumerate(nav.tabs):
            w = f"navigation.tabs[{i}]"
            groups = [group(g, f"{w}.groups[{j}]") for j, g in enumerate(t.groups)]
            groups += [g for s in at.get(w, []) for g in wrapped(s, "API Reference")]
            tabs.append(t.model_copy(update={"groups": groups}))
        nav = nav.model_copy(update={
            "tabs": tabs,
            "groups": [group(g, f"navigation.groups[{j}]") for j, g in enumerate(nav.groups)],
            "pages": entries(nav.pages, "navigation"),
        })
    api = at.get("api", [])
    extra = [NavGroupConfig(group="API Reference" if len(api) == 1 else s.spec.title, pages=s.entries())
             for s in api if s.entries()]
    return config.model_copy(update={"navigation": nav}), extra


def _first_line(text: str | None) -> str:
    line = next((x.strip() for x in str(text or "").splitlines() if x.strip()), "")
    return line[:160].rstrip()


def _prose(text: Any) -> str:
    """Spec Markdown, with docs component tags in it escaped (shown, not run)."""
    return re.sub(r"<(?=/?[A-Z])", "&lt;", str(text or "").strip())


def _attr(value: Any) -> str:
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return text.replace('"', "'").replace("\n", " ")


def _ref_name(schema: Any) -> str | None:
    ref = schema.get("$ref") if isinstance(schema, dict) else None
    return ref.rsplit("/", 1)[-1] if isinstance(ref, str) else None


def merged(spec: ApiSpec, schema: Any, depth: int = 0) -> dict:
    """``schema`` with its ``$ref`` followed and ``allOf`` folded in (properties, required)."""
    s = spec.resolve(schema)
    if not isinstance(s, dict):
        return {}
    if not isinstance(s.get("allOf"), list) or depth > 8:
        return s
    out = {k: v for k, v in s.items() if k != "allOf"}
    props: dict = {}
    required: list = []
    for part in [*s["allOf"], {k: v for k, v in out.items() if k in ("properties", "required")}]:
        p = merged(spec, part, depth + 1)
        props.update(p.get("properties") or {})
        required += p.get("required") or []
        for k, v in p.items():
            out.setdefault(k, v)
    if props:
        out.update(properties=props, type=out.get("type") or "object")
    if required:
        out["required"] = list(dict.fromkeys(required))
    return out


def type_label(spec: ApiSpec, schema: Any, depth: int = 0) -> str:
    """``string``, ``string<uuid>``, ``Pet[]``, ``integer | null``, ``Cat | Dog``."""
    if not isinstance(schema, dict) or depth > 4:
        return ""
    s = merged(spec, schema)
    for key in ("oneOf", "anyOf"):
        if isinstance(s.get(key), list):
            return " | ".join(dict.fromkeys(filter(None, (type_label(spec, x, depth + 1) for x in s[key]))))
    types = s.get("type") if isinstance(s.get("type"), list) else [s["type"]] if s.get("type") else []
    if not types and "properties" in s:
        types = ["object"]
    out = []
    for t in types:
        if t == "array":
            inner = type_label(spec, s.get("items"), depth + 1) or "any"
            out.append(f"({inner})[]" if " | " in inner else f"{inner}[]")
        elif t == "object" and _ref_name(schema):
            out.append(_ref_name(schema))
        elif s.get("format") and t in ("string", "integer", "number"):
            out.append(f"{t}<{s['format']}>")
        else:
            out.append(str(t))
    return " | ".join(out) or _ref_name(schema) or ("enum" if s.get("enum") else "")


def _one(spec: ApiSpec, schema: Any) -> Any:
    """``schema``, or its only non-null ``oneOf``/``anyOf`` choice (``Pet | null`` shows a Pet)."""
    for _ in range(4):
        s = merged(spec, schema)
        subs = next((s[k] for k in ("oneOf", "anyOf") if isinstance(s.get(k), list)), None)
        rest = [x for x in subs or [] if merged(spec, x).get("type") != "null"]
        if "properties" in s or len(rest) != 1:
            return schema
        schema = rest[0]
    return schema


def _children(spec: ApiSpec, schema: Any) -> tuple[dict, list, Any]:
    """(properties, required, the schema that holds them): an object's, or its array items'."""
    schema = _one(spec, schema)
    s = merged(spec, schema)
    if "properties" not in s and isinstance(s.get("items"), dict):
        holder = _one(spec, s["items"])
        inner = merged(spec, holder)
        return inner.get("properties") or {}, inner.get("required") or [], holder
    return s.get("properties") or {}, s.get("required") or [], schema


def options(spec: ApiSpec, schema: Any, items: bool = True) -> list[tuple[str, Any]]:
    """The ``oneOf``/``anyOf`` choices shown as tabs, ``(title, schema)``: titled by
    ``title``, the ``$ref`` name, the type, else "Option n". ``null`` is left out (the type shows it)."""
    s = merged(spec, _one(spec, schema))
    if items and "properties" not in s and isinstance(s.get("items"), dict):
        s = merged(spec, _one(spec, s["items"]))
    subs = next((s[k] for k in ("oneOf", "anyOf") if isinstance(s.get(k), list)), [])
    subs = [x for x in subs if merged(spec, x).get("type") != "null"]
    if len(subs) < 2:
        return []
    titles = []
    for i, x in enumerate(subs, 1):
        label = type_label(spec, x)
        own = spec.resolve(x)
        titles.append(str(own.get("title") if isinstance(own, dict) and own.get("title") else _ref_name(x)
                          or (label if label not in ("", "object") else f"Option {i}")))
    return [(t if titles.count(t) == 1 else f"{t} {i}", x) for i, (t, x) in enumerate(zip(titles, subs), 1)]


def _code(value: Any) -> str:
    """``value`` as inline code (JSON for non-strings)."""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    return f"`` {text} ``" if "`" in text else f"`{text}`"


def _plain(value: Any) -> str:
    return value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)


def _number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _bounds(lo: Any, hi: Any) -> str:
    """``1 - 100``, ``>= 1``, ``<= 100`` (or "" with neither)."""
    lo, hi = (v if _number(v) else None for v in (lo, hi))
    if lo is not None and hi is not None:
        return f"{lo} - {hi}" if lo != hi else str(lo)
    return f">= {lo}" if lo is not None else f"<= {hi}" if hi is not None else ""


def _range(s: dict) -> str:
    """``1 <= x < 100``, ``x >= 1``, ``x <= 100`` from (exclusive) minimum / maximum."""
    lo = ("<", s["exclusiveMinimum"]) if _number(s.get("exclusiveMinimum")) else (
        ("<=", s["minimum"]) if _number(s.get("minimum")) else None)
    hi = ("<", s["exclusiveMaximum"]) if _number(s.get("exclusiveMaximum")) else (
        ("<=", s["maximum"]) if _number(s.get("maximum")) else None)
    if lo and hi:
        return f"{lo[1]} {lo[0]} x {hi[0]} {hi[1]}"
    if lo:
        return f"x {'>' if lo[0] == '<' else '>='} {lo[1]}"
    return f"x {hi[0]} {hi[1]}" if hi else ""


def details(spec: ApiSpec, schema: Any) -> list[str]:
    """What a field's description leaves out: enum options, const, ranges, lengths,
    pattern, an example, additional properties and ``not``. One line each."""
    s = merged(spec, _one(spec, schema))
    items = merged(spec, s["items"]) if isinstance(s.get("items"), dict) else {}
    out = []
    enum = next((x["enum"] for x in (s, items) if isinstance(x.get("enum"), list) and x["enum"]), None)
    if enum:
        out.append("Available options: " + ", ".join(_code(v) for v in enum))
    if "const" in s:
        out.append(f"Allowed value: {_code(s['const'])}")
    if text := _range(s):
        out.append(f"Required range: {_code(text)}")
    if text := _bounds(s.get("minLength"), s.get("maxLength")):
        out.append(f"Required string length: {_code(text)}")
    if text := _bounds(s.get("minItems"), s.get("maxItems")):
        out.append(f"Required array length: {_code(text)} elements")
    if isinstance(s.get("pattern"), str):
        out.append(f"Pattern: {_code(s['pattern'])}")
    examples = s.get("examples") if isinstance(s.get("examples"), list) else []
    if examples and len(text := _code(examples[0])) <= 120:
        out.append(f"Example: {text}")
    if isinstance(s.get("additionalProperties"), dict):
        out.append(f"Additional properties: {_code(type_label(spec, s['additionalProperties']) or 'any')}")
    if isinstance(s.get("not"), dict):
        out.append(f"Must not match: {_code(type_label(spec, s['not']) or _plain(s['not'])[:120])}")
    return out


def _condition(spec: ApiSpec, test: Any) -> str:
    """``method = card``, ``kind is cat or dog``, ``id is set`` for an ``if`` that tests
    sibling properties with ``const`` / ``enum`` / ``required``; "" when it does more."""
    test = spec.resolve(test)
    if not isinstance(test, dict) or set(test) - {"properties", "required", "type"}:
        return ""
    props = test.get("properties") if isinstance(test.get("properties"), dict) else {}
    parts = []
    for name, sub in props.items():
        sub = spec.resolve(sub)
        if isinstance(sub, dict) and "const" in sub:
            parts.append(f"{name} = {_plain(sub['const'])}")
        elif isinstance(sub, dict) and isinstance(sub.get("enum"), list):
            parts.append(f"{name} is " + " or ".join(map(_plain, sub["enum"])))
        else:
            return ""
    parts += [f"{n} is set" for n in test.get("required") or [] if n not in props]
    return " and ".join(parts)


def conditions(spec: ApiSpec, schema: Any, depth: int = 0) -> dict[str, list[str]]:
    """``{property: ["required if method = card"]}`` from an object's ``dependentRequired``,
    ``dependentSchemas`` and ``if``/``then``/``else`` (its ``allOf`` parts too)."""
    s = spec.resolve(schema)
    out: dict[str, list[str]] = {}
    if not isinstance(s, dict) or depth > 8:
        return out

    def add(names: Any, label: str) -> None:
        for n in names if isinstance(names, list) else []:
            out.setdefault(str(n), []).append(label)

    for key, names in (s["dependentRequired"] if isinstance(s.get("dependentRequired"), dict) else {}).items():
        add(names, f"required if {key} is set")
    for key, sub in (s["dependentSchemas"] if isinstance(s.get("dependentSchemas"), dict) else {}).items():
        sub = spec.resolve(sub)
        add(sub.get("required") if isinstance(sub, dict) else None, f"required if {key} is set")
    if isinstance(s.get("if"), dict):
        cond = _condition(spec, s["if"])
        for branch, word in (("then", "if"), ("else", "unless")):
            target = spec.resolve(s.get(branch))
            if isinstance(target, dict):
                add(target.get("required"), f"required {word} {cond}" if cond else "conditionally required")
    for part in s["allOf"] if isinstance(s.get("allOf"), list) else []:
        for name, labels in conditions(spec, part, depth + 1).items():
            out.setdefault(name, []).extend(labels)
    return out


def field_lines(spec: ApiSpec, tag: str, at: str, name: str, schema: Any, *,
                required: bool = False, description: Any = None, deprecated: bool = False,
                skip: str = "", indent: str = "", stack: tuple = (), post: Any = (),
                expand: bool = False) -> list[str]:
    """One ``<ParamField>`` / ``<ResponseField>``: type, pills (``post``: conditional
    requirements), description and :func:`details`, then what it holds (:func:`nested`).
    ``skip``: ``readOnly`` in requests, ``writeOnly`` in responses."""
    s = merged(spec, schema)
    attrs = f'{at}="{_attr(name)}"'
    if label := type_label(spec, schema):
        attrs += f' type="{_attr(label)}"'
    attrs += " required" * required + " deprecated" * bool(deprecated or s.get("deprecated"))
    if "default" in s:
        attrs += f' default="{_attr(s["default"])}"'
    if pills := [p.replace(",", ";") for p in dict.fromkeys(post)]:
        attrs += f' post="{_attr(", ".join(pills))}"'
    lines = [f"{indent}<{tag} {attrs}>"]
    text = "\n\n".join(x for x in (_prose(description or s.get("description")), *details(spec, schema)) if x)
    lines += [f"{indent}  {line}".rstrip() for line in text.splitlines()]
    lines += nested(spec, tag, at, name, schema, skip=skip, indent=indent + "  ", stack=stack, expand=expand)
    return [*lines, f"{indent}</{tag}>"]


def _fields(spec: ApiSpec, tag: str, at: str, holder: Any, props: dict, req: list, *, skip: str,
            indent: str, stack: tuple, expand: bool, gap: bool) -> list[str]:
    conds = conditions(spec, holder)
    out: list[str] = []
    for key, sub in props.items():
        if skip and merged(spec, sub).get(skip):
            continue
        out += field_lines(spec, tag, at, str(key), sub, required=key in req, skip=skip, indent=indent,
                           stack=stack, post=() if key in req else conds.get(str(key), ()), expand=expand)
        out += [""] * gap
    return out


def nested(spec: ApiSpec, tag: str, at: str, name: str, schema: Any, *, skip: str = "", indent: str = "",
           stack: tuple = (), expand: bool = False, boxed: bool = True, gap: bool = False,
           top: bool = False) -> list[str]:
    """A schema's properties (in an ``<Expandable>`` when ``boxed``; ``expand``: open)
    and its ``oneOf``/``anyOf`` choices as ``<Tabs>``. A recursive schema stops one
    level down (``top``: a body or response itself, not yet a level)."""
    props, req, holder = _children(spec, schema)
    ref = _ref_name(holder)
    if len(stack) >= MAX_DEPTH or (ref is not None and ref in stack):
        return []
    stack = (*stack, name if top else ref or name)
    out: list[str] = []
    if props:
        inner = _fields(spec, tag, at, holder, props, req, skip=skip, indent=indent + "  " * boxed,
                        stack=stack, expand=expand, gap=gap)
        out += [f'{indent}<Expandable title="{_attr(name)} properties"{" defaultOpen" * expand}>',
                *inner, f"{indent}</Expandable>"] if boxed else inner
    if choices := options(spec, schema):
        out.append(f'{indent}<Tabs sync="false">')
        for title, sub in choices:
            s = merged(spec, sub)
            kind = "" if "properties" in s or not type_label(spec, sub) else f"Type: {_code(type_label(spec, sub))}"
            needs = "Requires " + ", ".join(map(_code, s["required"])) + "." if (
                s.get("required") and "properties" not in s) else ""
            text = "\n\n".join(x for x in (kind, _prose(s.get("description")), needs, *details(spec, sub)) if x)
            out.append(f'{indent}  <Tab title="{_attr(title)}">')
            out += [f"{indent}    {line}".rstrip() for line in text.splitlines()]
            out += nested(spec, tag, at, title, sub, skip=skip, indent=indent + "    ", stack=stack,
                          expand=expand, boxed=False, gap=gap)
            out.append(f"{indent}  </Tab>")
        out.append(f"{indent}</Tabs>")
    return out


def _media(content: Any) -> tuple[str, dict]:
    """The content type shown first (JSON preferred) and its media object."""
    content = content if isinstance(content, dict) else {}
    kind = next((k for k in content if "json" in k), next(iter(content), ""))
    return kind, content.get(kind) if isinstance(content.get(kind), dict) else {}


def server_url(server: Any) -> str:
    """A server's URL, its ``{variables}`` set to their defaults."""
    server = server if isinstance(server, dict) else {}
    variables = server.get("variables") or {}
    return re.sub(r"{([^{}]+)}", lambda m: str((variables.get(m.group(1)) or {}).get("default", m.group(0))),
                  str(server.get("url") or "")).rstrip("/")


def _schema_fields(spec: ApiSpec, schema: Any, tag: str, at: str, whole: str, skip: str,
                   required: bool = False, expand: bool = False) -> list[str]:
    """An object's properties, one field each, and its ``oneOf``/``anyOf`` choices as
    tabs; any other schema one field named ``whole``."""
    s = merged(spec, _one(spec, schema)) if schema else {}
    if not s:
        return []
    if "properties" not in s and not options(spec, schema, items=False):
        return [*field_lines(spec, tag, at, whole, schema, required=required, skip=skip, expand=expand), ""]
    return [*nested(spec, tag, at, whole, schema, skip=skip, expand=expand, boxed=False, gap=True, top=True), ""]


def sample(spec: ApiSpec, schema: Any, depth: int = 0, skip: str = "", stack: tuple = ()) -> Any:
    """An example value: the schema's own example, else one made from its type
    (a property that would repeat a schema it sits in is left out)."""
    ref = _ref_name(schema)
    if ref in stack:
        return _CYCLE
    stack = (*stack, ref) if ref else stack
    s = merged(spec, schema)
    for key in ("x-default", "example", "default", "const"):  # x-default: the value Try it starts with
        if key in s:
            return s[key]
    if isinstance(s.get("examples"), list) and s["examples"]:
        return s["examples"][0]
    if isinstance(s.get("enum"), list) and s["enum"]:
        return s["enum"][0]
    for key in ("oneOf", "anyOf"):
        subs = [x for x in s[key] if merged(spec, x).get("type") != "null"] if isinstance(s.get(key), list) else []
        if subs and depth < MAX_DEPTH and "properties" not in s:
            return sample(spec, subs[0], depth + 1, skip, stack)
    types = s.get("type") if isinstance(s.get("type"), list) else [s.get("type")]
    t = next((x for x in types if x not in (None, "null")), "object" if "properties" in s else None)
    if t == "object" or "properties" in s:
        if depth >= MAX_DEPTH:
            return {}
        values = {k: sample(spec, v, depth + 1, skip, stack) for k, v in (s.get("properties") or {}).items()
                  if not (skip and merged(spec, v).get(skip))}
        return {k: v for k, v in values.items() if v is not _CYCLE}
    if t == "array":
        item = sample(spec, s.get("items"), depth + 1, skip, stack) if depth < MAX_DEPTH else _CYCLE
        return [] if item is _CYCLE else [item]
    formats = {"date-time": "2024-01-01T00:00:00Z", "date": "2024-01-01", "email": "user@example.com",
               "uuid": "3c90c3cc-0d44-4b50-8888-8dd25736052a", "uri": "https://example.com"}
    return {"integer": 123, "number": 123.45, "boolean": True, "string": formats.get(
        s.get("format"), "<string>")}.get(t) if t else None


def media_examples(spec: ApiSpec, kind: str, media: dict, skip: str = "") -> list[tuple[str, Any]]:
    """``(label, value)`` per example of one content type: each entry of an ``examples``
    map (label: its ``summary``, else its key), else ``example``, else for JSON one
    made from the schema (:func:`sample`)."""
    if "example" in media:
        return [("", media["example"])]
    found = []
    for key, entry in (media.get("examples") or {}).items() if isinstance(media.get("examples"), dict) else ():
        entry = spec.resolve(entry)
        value = next((entry[k] for k in ("dataValue", "value", "serializedValue", "externalValue")
                      if isinstance(entry, dict) and k in entry), _CYCLE)
        if value is not _CYCLE:
            found.append((str(entry.get("summary") or key), value))
    if found or "json" not in kind or not media.get("schema"):
        return found
    value = sample(spec, media["schema"], skip=skip)
    return [] if value is _CYCLE or value is None else [("", value)]


def _example_text(kind: str, value: Any) -> str:
    """An example as shown: JSON pretty-printed (a JSON string parsed first), other text as written."""
    if isinstance(value, str) and "json" in kind:
        try:
            value = json.loads(value)
        except ValueError:
            pass
    return value if isinstance(value, str) and "json" not in kind else json.dumps(value, indent=2, ensure_ascii=False)


def _fence(lang: str, title: str, code: str) -> list[str]:
    ticks = "`" * max([3, *(len(m) + 1 for m in re.findall(r"`{3,}", code))])
    return [f'{ticks}{lang} title="{title}"', code, ticks]


def _lang(kind: str) -> str:
    """The fence language for a content type."""
    return next((lang for key, lang in (("json", "json"), ("xml", "xml"), ("html", "html"), ("yaml", "yaml"),
                                        ("javascript", "js"), ("csv", "csv")) if key in kind), "text")


def response_examples(spec: ApiSpec, responses: dict[str, Any]) -> list[str]:
    """``<ResponseExample>``: one tab per status code, content type and named example."""
    out: list[str] = []
    for code, response in responses.items():
        content = spec.resolve(response).get("content") if isinstance(spec.resolve(response), dict) else None
        kinds = [(k, m) for k, m in content.items() if isinstance(m, dict)] if isinstance(content, dict) else []
        kinds.sort(key=lambda km: "json" not in km[0])
        for kind, media in kinds:
            for label, value in media_examples(spec, kind, media, "writeOnly"):
                text = _example_text(kind, value)
                title = " · ".join(x for x in (str(code), kind if len(kinds) > 1 else "", label) if x)
                out += [*_fence(_lang(kind), _attr(title), text), ""]
    return ["<ResponseExample>", "", *out, "</ResponseExample>", ""] if out else []


def _body_lines(spec: ApiSpec, body: dict | None, heading: str, skip: str = "readOnly",
                expand: bool = False) -> list[str]:
    """A request body's fields (``skip``: ``writeOnly`` for a payload the API sends)."""
    kind, media = _media((body or {}).get("content"))
    if not kind:
        return []
    intro = f"`{kind}`" + (f": {_prose(body.get('description'))}" if body.get("description") else "")
    return [heading, "", intro, "", *_schema_fields(spec, media.get("schema"), "ParamField", "body", "body",
                                                     skip, bool(body.get("required")), expand)]


def _response_lines(spec: ApiSpec, responses: dict[str, dict], heading: str, expand: bool = False) -> list[str]:
    out = [heading, ""] if responses else []
    for code, response in responses.items():
        response = response if isinstance(response, dict) else {}
        kind, media = _media(response.get("content"))
        kinds = ", ".join(f"`{k}`" for k in response.get("content") or {}) if kind else ""
        intro = " ".join(x for x in (_prose(response.get("description")), f"({kinds})" if kinds else "") if x)
        out += [f"### {code}", "", *([intro, ""] if intro else []),
                *_schema_fields(spec, media.get("schema"), "ResponseField", "name", "response", "writeOnly",
                                expand=expand)]
    return out


def _callback_lines(spec: ApiSpec, op: Operation) -> list[str]:
    callbacks = op.raw.get("callbacks") if isinstance(op.raw.get("callbacks"), dict) else {}
    out: list[str] = []
    for name, callback in callbacks.items():
        for expression, item in (spec.resolve(callback) or {}).items():
            item = spec.resolve(item)
            for method, cb in (item.items() if isinstance(item, dict) else []):
                if not isinstance(cb, dict) or method.startswith("x-") or method in ("parameters", "servers"):
                    continue
                out += [f"### {name}", "", f"`{method.upper()}` `{expression}`", ""]
                if text := _prose(cb.get("summary") or cb.get("description")):
                    out += [text, ""]
                body = spec.resolve(cb.get("requestBody")) if cb.get("requestBody") else None
                out += _body_lines(spec, body, "#### Body", "writeOnly")
                codes = ", ".join(f"`{c}`" for c in cb.get("responses") or {})
                out += [f"Your server answers: {codes}.", ""] if codes else []
    return ["## Callbacks", "", *out] if out else []


def bar(method: str, path: str, playground: str = "interactive", src: str = "") -> list[str]:
    """The endpoint bar (docs/ApiFields.tsx), with ``src`` its Try it button (``auth``: for signed-in
    readers only); ``none``: plain text."""
    if playground == "none":
        return [f"`{method}` `{path}`", ""]
    live = bool(src) and playground in LIVE
    return [f'<ApiPlayground method="{method}" path="{_attr(path)}"' + (f' src="{_attr(src)}"' if live else "")
            + (' display="auth"' if live and playground == "auth" else "") + " />", ""]


def keywords(spec: ApiSpec, op: Operation) -> list[str]:
    """Search terms of an endpoint page: ``METHOD /path``, the operationId, parameter and body field names."""
    words = [f"{op.method} {op.path}", *([op.operation_id] if op.operation_id else []),
             *(str(p.get("name")) for p in op.parameters if p.get("name"))]
    _kind, media = _media((op.request_body or {}).get("content"))
    words += [str(k) for k in _children(spec, media.get("schema"))[0]] if media.get("schema") else []
    return list(dict.fromkeys(words))


def endpoint_head(spec: ApiSpec, op: Operation, playground: str = "interactive", src: str = "") -> list[str]:
    """Under the title: the endpoint bar (a webhook's line), its servers and a deprecation notice."""
    lines = ([f"`{op.method}` webhook `{op.path}`: your server receives this request.", ""] if op.webhook
             else bar(op.method, op.path, playground, src))
    servers = [s for s in op.servers if isinstance(s, dict) and s.get("url")] if not op.webhook else []
    if servers:
        urls = ", ".join(f"`{server_url(s)}`" for s in servers)
        lines += [f"{'Servers' if len(servers) > 1 else 'Server'}: {urls}", ""]
    return lines + (["<Warning>This endpoint is deprecated.</Warning>", ""] if op.deprecated else [])


def security_options(spec: ApiSpec, op: Operation) -> list[list[dict]]:
    """The operation's ``security`` alternatives (any one is enough), each a list of the schemes
    sent together: ``{id, type, in, name}`` (apiKey), ``{id, type, scheme}`` (http) or
    ``{id, type, scopes}`` (oauth2, openIdConnect), with ``description``, ``format``
    (bearerFormat) and ``default`` (``x-default``). ``[]``: authentication is optional."""
    schemes = (spec.document.get("components") or {}).get("securitySchemes") or {}
    out: list[list[dict]] = []
    for need in op.security if isinstance(op.security, list) else []:
        option = []
        for name, scopes in (need.items() if isinstance(need, dict) else ()):
            s = spec.resolve(schemes.get(name)) if isinstance(schemes, dict) else None
            kind = s.get("type") if isinstance(s, dict) else None
            if kind == "apiKey" and s.get("in") in ("header", "query", "cookie"):
                one = {"in": s["in"], "name": str(s.get("name") or "api_key")}
            elif kind == "http":
                one = {"scheme": str(s.get("scheme") or "bearer")}
            elif kind in ("oauth2", "openIdConnect"):
                one = {"scopes": [str(x) for x in scopes]} if isinstance(scopes, list) and scopes else {}
            else:
                continue  # mutualTLS: a browser cannot send it
            one = {"id": str(name), "type": kind, **one}
            for key, src in (("description", "description"), ("format", "bearerFormat"), ("default", "x-default")):
                if isinstance(s.get(src), str) and s[src]:
                    one[key] = s[src]
            option.append(one)
        out.append(option)
    return out


def _auth_text(s: dict) -> str:
    scheme = str(s.get("scheme", "")).lower()
    if s["type"] == "apiKey":
        text = f"API key, sent as the `{s['name']}` cookie." if s["in"] == "cookie" else "API key."
    elif s["type"] == "http" and scheme == "basic":
        text = "Basic authentication header of the form `Basic <encoded-value>`, where `<encoded-value>` " \
               "is the base64-encoded `username:password`."
    elif s["type"] == "http" and scheme != "bearer":
        text = f"Authentication header of the form `{s['scheme']} <token>`."
    else:
        text = f"{'OAuth 2.0 access token' if s['type'] != 'http' else 'Bearer token'}" \
               f"{' (' + s['format'] + ')' if s.get('format') else ''}, sent as `Bearer <token>`."
    scopes = "Scopes: " + ", ".join(map(_code, s["scopes"])) + "." if s.get("scopes") else ""
    return "\n\n".join(x for x in (text, _prose(s.get("description")), scopes) if x)


def auth_lines(spec: ApiSpec, op: Operation) -> list[str]:
    """The "Authorization" section: a field per security scheme, required when every alternative needs it."""
    options = [] if op.webhook else security_options(spec, op)
    unique = list({s["id"]: s for option in options for s in option}.values())
    if not unique:
        return []
    lines = ["## Authorization", ""]
    if len(options) > 1:
        names = [" and ".join(_code(s["id"]) for s in o) or "none" for o in options]
        lines += [f"Any one of: {', '.join(names)}.", ""]
    for s in unique:
        at, name = ("header", "Authorization") if s["type"] != "apiKey" else (
            "header" if s["in"] == "cookie" else s["in"], s["name"])
        lines += [*field_lines(spec, "ParamField", at, name, {"type": "string"}, description=_auth_text(s),
                               required=all(any(x["id"] == s["id"] for x in o) for o in options)), ""]
    return lines


def endpoint_reference(spec: ApiSpec, op: Operation, *, expand: bool = False,
                       languages: list[str] | None = None) -> list[str]:
    """Authorization, parameters, body, responses, request and response examples, callbacks and the spec link."""
    from praisonaiui.compiler.code_samples import request_examples  # it builds on this module
    lines: list[str] = auth_lines(spec, op)
    for where, heading in _PARAMS:
        params = [p for p in op.parameters if p.get("in") == where]
        lines += [f"## {heading}", ""] if params else []
        for p in params:  # a cookie is listed as a header field: ParamField has no cookie slot
            lines += [*field_lines(spec, "ParamField", "header" if where == "cookie" else where,
                                   str(p.get("name")), p.get("schema") or {}, required=bool(p.get("required")),
                                   description=p.get("description"), deprecated=bool(p.get("deprecated")),
                                   expand=expand), ""]
    lines += (_body_lines(spec, op.request_body, "## Payload", "writeOnly", expand) if op.webhook
              else _body_lines(spec, op.request_body, "## Body", expand=expand))
    lines += _response_lines(spec, op.responses, "## Your response" if op.webhook else "## Response", expand)
    lines += request_examples(spec, op, languages)
    lines += response_examples(spec, op.responses)
    lines += _callback_lines(spec, op)
    return lines + [f"[OpenAPI spec](/openapi/{spec.slug}.json)", ""]


def _front_line(key: str, value: Any) -> str:
    name = key if re.fullmatch(r"[A-Za-z_][\w-]*", key) else json.dumps(key)  # "og:image": quoted
    return f"{name}: {json.dumps(value, ensure_ascii=False)}"


def page_markdown(spec: ApiSpec, op: Operation, title: str, description: str, *, expand: bool = False,
                  languages: list[str] | None = None, playground: str = "interactive", src: str = "",
                  meta: dict | None = None, content: str = "") -> str:
    """The Markdown source of one endpoint page (``expand``: nested properties open, ``api.params.expanded: all``;
    ``languages``: request example languages, ``api.examples.languages``; ``playground``: the display mode,
    :func:`~praisonaiui.compiler.playground.playground_mode`; ``src``: its Try-it data URL (modes with Try it);
    ``meta``: more front matter and ``content``: Markdown above the description, from :func:`page_settings`)."""
    front = {"title": title, "description": description,
             "openapi": f"{spec.source} {'webhook ' if op.webhook else ''}{op.method} {op.path}",
             "keywords": keywords(spec, op), **(meta or {})}
    lines = ["---", *(_front_line(k, v) for k, v in front.items()), "---", "", f"# {_prose(title)}", "",
             *endpoint_head(spec, op, playground, src)]
    lines += [content.strip(), ""] if content.strip() else []
    if text := _prose(op.description):
        lines += [text, ""]
    lines += endpoint_reference(spec, op, expand=expand, languages=languages)
    return "\n".join(lines).rstrip() + "\n"


_FRONT = re.compile(r"\A(---[ \t]*\r?\n(?:.*?\r?\n)?)(---[ \t]*(?:\r?\n|\Z))", re.S)


def embed_markdown(text: str, embed: Embed, *, expand: bool = False,
                   languages: list[str] | None = None, servers: list[str] | None = None) -> str:
    """A hand-written endpoint page with its endpoint joined in: the bar (and servers, deprecation)
    under the page's ``#`` title, the page's own Markdown, then (``openapi:``) the generated
    reference. Missing ``title``, ``description`` and ``keywords`` come from the operation;
    the spec's description shows when the page has no text of its own."""
    from praisonaiui.compiler.playground import TRY_DIR
    m = _FRONT.match(text)
    front, close, body = (m[1], m[2], text[m.end():]) if m else ("---\n", "---\n", text)
    lines = body.split("\n")
    first = next((i for i, line in enumerate(lines) if line.strip()), len(lines))
    h1 = first < len(lines) and re.match(r"#\s", lines[first]) is not None
    top, rest = (lines[: first + 1], lines[first + 1:]) if h1 else ([], lines)
    src = f"/{TRY_DIR}/{embed.slug}.json" if embed.mode in LIVE and embed.method != "webhook" else ""
    spec, op = embed.spec, embed.op
    if spec is None or op is None:  # `api:`: the bar and the configured servers
        head = bar(embed.method, embed.path, embed.mode, src)
        head += [f"{'Servers' if len(servers or []) > 1 else 'Server'}: "
                 + ", ".join(f"`{u}`" for u in servers or []), ""] if servers else []
        tail: list[str] = []
        add: dict = {"keywords": [f"{embed.method} {embed.path}"]}
    else:
        head = endpoint_head(spec, op, embed.mode, src)
        own = "\n".join(rest).strip()
        tail = [*([_prose(op.description), ""] if not own and op.description else []),
                *endpoint_reference(spec, op, expand=expand, languages=languages)]
        add = {"title": None if h1 else op.summary, "description": _first_line(op.description),
               "keywords": keywords(spec, op)}
    front += "".join(_front_line(k, v) + "\n" for k, v in add.items() if v and k not in embed.frontmatter)
    return front + close + "\n".join([*top, "", *head, *rest, "", *tail]).rstrip() + "\n"


def strip_excluded(document: dict) -> dict:
    """A copy of a spec without its ``x-excluded`` operations (and path items left empty)."""
    out = dict(document)
    for section in ("paths", "webhooks"):
        items = document.get(section)
        if not isinstance(items, dict):
            continue
        kept = {}
        for path, item in items.items():
            if isinstance(item, dict):
                item = {k: v for k, v in item.items() if not (isinstance(v, dict) and v.get("x-excluded"))}
                if not any(isinstance(v, dict) and k not in ("parameters", "servers") and not k.startswith("x-")
                           for k, v in item.items()) and "$ref" not in item:
                    continue
            kept[path] = item
        out[section] = kept
    return out


def api_catalog(catalog_url: str, apis: list[tuple[ApiSpec, str, str | None]]) -> dict:
    """The RFC 9727 API catalog (a linkset) for ``(spec, spec URL, first endpoint page URL)``."""
    linkset: list[dict] = []
    for spec, spec_url, doc_url in apis:
        server = next((u for u in map(server_url, spec.document.get("servers") or [])
                       if u.startswith("http")), None)
        entry = {"anchor": server or spec_url,
                 "service-desc": [{"href": spec_url, "type": "application/vnd.oai.openapi+json"}]}
        if doc_url:
            entry["service-doc"] = [{"href": doc_url, "type": "text/html"}]
        linkset.append(entry)
    return {"linkset": [{"anchor": catalog_url, "item": [{"href": e["anchor"]} for e in linkset],
                         "profile": [{"href": "https://www.rfc-editor.org/info/rfc9727"}]}, *linkset]}
