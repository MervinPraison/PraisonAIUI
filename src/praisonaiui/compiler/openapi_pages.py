"""Endpoint pages from OpenAPI specs (docs/features/openapi.md).

``build_api_reference`` turns each loaded spec into one Markdown page per
operation and webhook, written with the docs components a hand-written API page
uses (``<ParamField>``, ``<ResponseField>``, ``<Expandable>``). The compiler
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

from praisonaiui.compiler.openapi import ApiSpec, Operation, SpecSource, spec_sources
from praisonaiui.schema.models import NavGroupConfig

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config

DEFAULT_DIRECTORY = "api-reference"
MAX_DEPTH = 6  # nested properties shown below a field
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


@dataclass
class ApiSection:
    """The pages of one spec placed at one config location (``ref.where``)."""

    ref: SpecSource
    spec: ApiSpec
    pages: list[ApiPage] = field(default_factory=list)

    def entries(self) -> list[str | NavGroupConfig]:
        """Sidebar entries: ungrouped pages, then one group per tag (nested by
        3.2 ``parent``), in the spec's tag order. x-hidden pages are left out."""
        root: dict = {"pages": [], "groups": {}}
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
    pages = [p if isinstance(p, str) else _only(p, slugs, False) for p in group.pages
             if not isinstance(p, str) or p in slugs]
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


def build_api_reference(config: "Config", specs: dict[str, ApiSpec],
                        taken: set[str] | None = None) -> ApiReference | None:
    """Pages for every spec the config names, or None when it names none.
    ``taken``: slugs of hand-written pages; a generated page never replaces one."""
    refs = spec_sources(config)
    in_nav = {r.source for r in refs if not r.where.startswith("api.")}
    taken = set(taken or ())
    sections: list[ApiSection] = []
    done: set[tuple] = set()
    for ref in refs:
        spec = specs.get(ref.source)
        key = (ref.source, ref.directory)
        if spec is None or not spec.document or key in done or (
                ref.where.startswith("api.") and ref.source in in_nav):
            continue
        done.add(key)
        sections.append(ApiSection(ref, spec, _pages(spec, ref.directory, taken)))
    if not sections:
        return None
    return ApiReference(sections, *_place(config, sections))


def _pages(spec: ApiSpec, directory: str | None, taken: set[str]) -> list[ApiPage]:
    tags = _tags(spec)
    order = {name: i for i, name in enumerate(tags)}
    folder = _path(directory) or DEFAULT_DIRECTORY
    pages = []
    for op in spec.operations:
        if op.excluded:
            continue
        tag = nav_tag(op, tags)
        group = group_path(tag, tags) or (("Webhooks",) if op.webhook else ())
        mint = op.extensions.get("x-mint")
        href = mint.get("href") if isinstance(mint, dict) and isinstance(mint.get("href"), str) else ""
        slug = _path(re.sub(r"^/?docs/", "", href)) or "/".join(x for x in (
            folder, kebab(tag) if tag else "webhooks" if op.webhook else "", op_slug(op)) if x)
        n, base = 1, slug
        while slug in taken:  # a duplicate gets -2, -3 (never replaces a page)
            n += 1
            slug = f"{base}-{n}"
        taken.add(slug)
        title = str(op.summary or kebab(op.operation_id).replace("-", " ").capitalize()
                    or f"{op.method} {op.path}")
        description = _first_line(op.description) or (
            f"Webhook {op.path}" if op.webhook else f"{op.method} {op.path}")
        pages.append(ApiPage(slug, title, description, page_markdown(spec, op, title, description),
                             group, op.hidden, order.get(tag, len(order)) if tag else
                             len(order) + 1 if op.webhook else -1))
    return pages


def _place(config: "Config", sections: list[ApiSection]) -> tuple["Config", list[NavGroupConfig]]:
    """The config with each section's entries where it is named, and the
    ``api.openapi`` sections' "API Reference" groups."""
    at: dict[str, list[ApiSection]] = {}
    for s in sections:
        at.setdefault(s.ref.where.split(".openapi")[0], []).append(s)

    def group(g: NavGroupConfig, where: str) -> NavGroupConfig:
        pages = [p if isinstance(p, str) else group(p, f"{where}.pages[{k}]") for k, p in enumerate(g.pages)]
        pages += [e for s in at.get(where, []) for e in s.entries()]
        return g.model_copy(update={"pages": pages})

    def wrapped(s: ApiSection, label: str) -> list[NavGroupConfig]:
        entries = s.entries()
        loose = [e for e in entries if isinstance(e, str)]
        return [NavGroupConfig(group=label, pages=loose)] * bool(loose) + [
            e for e in entries if not isinstance(e, str)]

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
            "pages": [p if isinstance(p, str) else group(p, f"navigation.pages[{k}]")
                      for k, p in enumerate(nav.pages)],
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


def _children(spec: ApiSpec, schema: Any) -> tuple[dict, list, Any]:
    """(properties, required, the schema that holds them): an object's, or its array items'."""
    s = merged(spec, schema)
    if "properties" not in s and isinstance(s.get("items"), dict):
        inner = merged(spec, s["items"])
        return inner.get("properties") or {}, inner.get("required") or [], s["items"]
    return s.get("properties") or {}, s.get("required") or [], schema


def field_lines(spec: ApiSpec, tag: str, at: str, name: str, schema: Any, *,
                required: bool = False, description: Any = None, deprecated: bool = False,
                skip: str = "", indent: str = "", stack: tuple = ()) -> list[str]:
    """One ``<ParamField>`` / ``<ResponseField>``, its object properties nested in
    ``<Expandable>`` (refs resolved, allOf merged; a recursive schema stops).
    ``skip``: ``readOnly`` in requests, ``writeOnly`` in responses."""
    s = merged(spec, schema)
    attrs = f'{at}="{_attr(name)}"'
    if label := type_label(spec, schema):
        attrs += f' type="{_attr(label)}"'
    attrs += " required" * required + " deprecated" * bool(deprecated or s.get("deprecated"))
    if "default" in s:
        attrs += f' default="{_attr(s["default"])}"'
    lines = [f"{indent}<{tag} {attrs}>"]
    text = _prose(description or s.get("description"))
    if isinstance(s.get("enum"), list):
        options = ", ".join(f"`{json.dumps(v, ensure_ascii=False)}`" for v in s["enum"])
        text += ("\n\n" if text else "") + f"Available options: {options}"
    lines += [f"{indent}  {line}".rstrip() for line in text.splitlines()]
    props, req, holder = _children(spec, schema)
    ref = _ref_name(holder)
    if props and len(stack) < MAX_DEPTH and (ref is None or ref not in stack):
        lines.append(f'{indent}  <Expandable title="{_attr(name)} properties">')
        for key, sub in props.items():
            if isinstance(sub, dict) and merged(spec, sub).get(skip):
                continue
            lines += field_lines(spec, tag, at, str(key), sub, required=key in req, skip=skip,
                                 indent=indent + "    ", stack=(*stack, ref or name))
        lines.append(f"{indent}  </Expandable>")
    return [*lines, f"{indent}</{tag}>"]


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
                   required: bool = False) -> list[str]:
    """An object's properties, one field each; any other schema one field named ``whole``."""
    s = merged(spec, schema) if schema else {}
    if "properties" not in s:
        return [*field_lines(spec, tag, at, whole, schema, required=required, skip=skip), ""] if s else []
    req = s.get("required") or []
    return [line for key, sub in s["properties"].items() if not merged(spec, sub).get(skip)
            for line in (*field_lines(spec, tag, at, str(key), sub, required=key in req, skip=skip), "")]


def _body_lines(spec: ApiSpec, body: dict | None, heading: str, skip: str = "readOnly") -> list[str]:
    """A request body's fields (``skip``: ``writeOnly`` for a payload the API sends)."""
    kind, media = _media((body or {}).get("content"))
    if not kind:
        return []
    intro = f"`{kind}`" + (f": {_prose(body.get('description'))}" if body.get("description") else "")
    return [heading, "", intro, "", *_schema_fields(spec, media.get("schema"), "ParamField", "body", "body",
                                                     skip, bool(body.get("required")))]


def _response_lines(spec: ApiSpec, responses: dict[str, dict], heading: str) -> list[str]:
    out = [heading, ""] if responses else []
    for code, response in responses.items():
        response = response if isinstance(response, dict) else {}
        kind, media = _media(response.get("content"))
        intro = " ".join(x for x in (_prose(response.get("description")), f"(`{kind}`)" if kind else "") if x)
        out += [f"### {code}", "", *([intro, ""] if intro else []),
                *_schema_fields(spec, media.get("schema"), "ResponseField", "name", "response", "writeOnly")]
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


def page_markdown(spec: ApiSpec, op: Operation, title: str, description: str) -> str:
    """The Markdown source of one endpoint page."""
    keywords = [f"{op.method} {op.path}", *([op.operation_id] if op.operation_id else []),
                *dict.fromkeys(str(p.get("name")) for p in op.parameters if p.get("name"))]
    _kind, media = _media((op.request_body or {}).get("content"))
    keywords += [str(k) for k in _children(spec, media.get("schema"))[0]] if media.get("schema") else []
    front = {"title": title, "description": description,
             "openapi": f"{spec.source} {'webhook ' if op.webhook else ''}{op.method} {op.path}",
             "keywords": list(dict.fromkeys(keywords))}
    lines = ["---", *(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in front.items()), "---", "",
             f"# {_prose(title)}", ""]
    if op.webhook:
        lines += [f"`{op.method}` webhook `{op.path}`: your server receives this request.", ""]
    else:
        lines += [f"`{op.method}` `{op.path}`", ""]
        servers = [s for s in op.servers if isinstance(s, dict) and s.get("url")]
        if servers:
            urls = ", ".join(f"`{server_url(s)}`" for s in servers)
            lines += [f"{'Servers' if len(servers) > 1 else 'Server'}: {urls}", ""]
    if op.deprecated:
        lines += ["<Warning>This endpoint is deprecated.</Warning>", ""]
    if text := _prose(op.description):
        lines += [text, ""]
    for where, heading in _PARAMS:
        params = [p for p in op.parameters if p.get("in") == where]
        lines += [f"## {heading}", ""] if params else []
        for p in params:  # a cookie is listed as a header field: ParamField has no cookie slot
            lines += [*field_lines(spec, "ParamField", "header" if where == "cookie" else where,
                                   str(p.get("name")), p.get("schema") or {}, required=bool(p.get("required")),
                                   description=p.get("description"), deprecated=bool(p.get("deprecated"))), ""]
    lines += (_body_lines(spec, op.request_body, "## Payload", "writeOnly") if op.webhook
              else _body_lines(spec, op.request_body, "## Body"))
    lines += _response_lines(spec, op.responses, "## Your response" if op.webhook else "## Response")
    lines += _callback_lines(spec, op)
    lines += [f"[OpenAPI spec](/openapi/{spec.slug}.json)", ""]
    return "\n".join(lines).rstrip() + "\n"


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
