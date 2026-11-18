"""OpenAPI 3.0/3.1/3.2 loading for the docs compiler: file or URL, JSON or YAML,
external ``$ref``s bundled, 3.0 normalised to 3.1. A bad spec never raises; its
problems are SpecIssues. Stdlib and PyYAML only. See docs/features/openapi.md."""

from __future__ import annotations

import copy
import datetime as _dt
import functools
import json
import re
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Literal
from urllib.parse import unquote, urljoin, urlparse

import yaml

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config

Fetch = Callable[[str], str]  # url -> text
_COMPONENT = re.compile(r"^/components/([^/]+)/([^/]+)$")
# Path Item methods in display order (`query` is OpenAPI 3.2).
METHODS = ("get", "put", "post", "delete", "options", "head", "patch", "trace", "query")


@dataclass
class SpecIssue:
    """One problem: file path or URL, JSON pointer in that file, 1-based line."""

    severity: Literal["error", "warning"]
    message: str
    file: str
    pointer: str = "#"
    line: int | None = None

    def __str__(self) -> str:
        where = f"{self.file}:{self.line}" if self.line else self.file
        return f"{where}: {self.message} (at {self.pointer})"


@dataclass
class Operation:
    """One operation or webhook. Top-level ``$ref``s resolved; schemas keep theirs."""

    method: str  # "GET", "QUERY", or an additionalOperations key upper-cased
    path: str  # "/pets/{id}", or the webhook name
    operation_id: str | None
    tags: list[str]
    summary: str | None
    description: str | None
    parameters: list[dict[str, Any]]  # path-level merged, operation-level wins
    request_body: dict[str, Any] | None
    responses: dict[str, dict[str, Any]]  # status code string -> Response
    security: list[dict[str, list[str]]]  # effective: operation, else document
    servers: list[dict[str, Any]]  # effective: operation, path item, else document
    deprecated: bool
    hidden: bool  # x-hidden: page built, not in navigation
    excluded: bool  # x-excluded: no page
    webhook: bool
    pointer: str  # "#/paths/~1pets/get"
    extensions: dict[str, Any] = field(default_factory=dict)  # every x-* key
    raw: dict[str, Any] = field(default_factory=dict)  # the Operation object

    @property
    def tag(self) -> str | None:
        return self.tags[0] if self.tags else None


@dataclass
class ApiSpec:
    """A loaded spec. ``bundled``: as written, external refs pulled in (only
    ``#/...`` refs remain), safe to publish. ``document``: the same normalised
    to 3.1 rules (3.1 and 3.2 unchanged). Both are JSON-serialisable."""

    source: str  # as configured
    location: str  # absolute path or URL read
    slug: str = ""  # unique per build: output file name
    openapi: str = ""  # declared version, e.g. "3.0.3"
    bundled: dict[str, Any] = field(default_factory=dict)
    document: dict[str, Any] = field(default_factory=dict)
    operations: list[Operation] = field(default_factory=list)
    issues: list[SpecIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)

    @property
    def title(self) -> str:
        return str((self.document.get("info") or {}).get("title") or self.slug)

    def resolve(self, node: Any) -> Any:
        """Follow a ``#/...`` ref chain; sibling keys override the target's."""
        for _ in range(64):
            if not (isinstance(node, dict) and isinstance(node.get("$ref"), str)):
                return node
            target = resolve_pointer(self.document, node["$ref"])
            if target is None:
                return node
            extra = {k: v for k, v in node.items() if k != "$ref"}
            node = {**target, **extra} if extra and isinstance(target, dict) else target
        return node

    def dereference(self, node: Any, _stack: tuple[str, ...] = ()) -> Any:
        """A copy with every ref inlined; a ref into its own ancestors stays a
        ref with ``"x-circular": true``."""
        if isinstance(node, list):
            return [self.dereference(x, _stack) for x in node]
        if not isinstance(node, dict):
            return node
        ref = node.get("$ref")
        if isinstance(ref, str):
            if ref in _stack:
                return {"$ref": ref, "x-circular": True}
            target = self.resolve(node)
            if not (isinstance(target, dict) and target.get("$ref") == ref):
                return self.dereference(target, (*_stack, ref))
        return {k: self.dereference(v, _stack) for k, v in node.items()}


def pointer_parts(fragment: str) -> list[str]:
    """'#/paths/~1pets/get' -> ['paths', '/pets', 'get'] (RFC 6901)."""
    frag = unquote(fragment.lstrip("#")).lstrip("/")
    return [p.replace("~1", "/").replace("~0", "~") for p in frag.split("/")] if frag else []


def to_pointer(parts: list[Any]) -> str:
    return "#" + "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in parts)


def resolve_pointer(doc: Any, fragment: str) -> Any:
    """The node at ``fragment`` in ``doc``, or ``None``."""
    for part in pointer_parts(fragment):
        if isinstance(doc, dict) and part in doc:
            doc = doc[part]
        elif isinstance(doc, list) and part.isdigit() and int(part) < len(doc):
            doc = doc[int(part)]
        else:
            return None
    return doc


_ONE = ("items", "additionalProperties", "not", "contains", "propertyNames", "if", "then", "else")
_MANY = ("allOf", "anyOf", "oneOf", "prefixItems")
_MAP = ("properties", "patternProperties", "$defs", "dependentSchemas")


def normalise_30(doc: dict[str, Any]) -> None:
    """Rewrite an OpenAPI 3.0 document in place to 3.1 (JSON Schema 2020-12) rules."""
    seen: set[int] = set()

    def schema(s: Any) -> None:
        if not isinstance(s, dict) or id(s) in seen:
            return
        seen.add(id(s))
        if s.pop("nullable", None) is True:
            if isinstance(s.get("type"), str):
                s["type"] = [s["type"], "null"]
                if isinstance(s.get("enum"), list) and None not in s["enum"]:
                    s["enum"].append(None)
            elif "type" not in s:
                inner = dict(s)
                s.clear()
                s["anyOf"] = [inner, {"type": "null"}]
        for key, bound in (("exclusiveMinimum", "minimum"), ("exclusiveMaximum", "maximum")):
            if isinstance(s.get(key), bool):
                if s.pop(key) and bound in s:
                    s[key] = s.pop(bound)
        if "example" in s and "examples" not in s:
            s["examples"] = [s.pop("example")]
        subs = [s.get(k) for k in _ONE] + [x for k in _MANY for x in s.get(k) or []]
        subs += [x for k in _MAP if isinstance(s.get(k), dict) for x in s[k].values()]
        for sub in subs:
            schema(sub)

    def walk(node: Any, key: str | None = None) -> None:
        for k, v in node.items() if isinstance(node, dict) else enumerate(node):
            if k == "schema":
                schema(v)
            elif k == "schemas" and key == "components" and isinstance(v, dict):
                for s in v.values():
                    schema(s)
            elif k not in ("example", "examples") and isinstance(v, (dict, list)):
                walk(v, k if isinstance(k, str) else None)

    walk(doc)
    doc["openapi"] = "3.1.0"


def extract_operations(spec: ApiSpec) -> list[Operation]:
    """Every operation and webhook of ``spec.document``, in document order."""
    out: list[Operation] = []
    for section in ("paths", "webhooks"):
        for path, item in (spec.document.get(section) or {}).items():
            item = spec.resolve(item)
            if not isinstance(item, dict):
                continue
            ops = [(m, [m], item[m]) for m in METHODS if isinstance(item.get(m), dict)]
            extra = item.get("additionalOperations")  # 3.2 custom methods
            ops += [(m, ["additionalOperations", m], op) for m, op in
                    (extra.items() if isinstance(extra, dict) else []) if isinstance(op, dict)]
            for method, ptr, op in ops:
                out.append(_operation(spec, item, method, op, str(path), section == "webhooks",
                                      to_pointer([section, path, *ptr])))
    return out


def _operation(spec: ApiSpec, item: dict, method: str, op: dict, path: str,
               webhook: bool, pointer: str) -> Operation:
    doc = spec.document
    params: dict[tuple, dict] = {}
    for p in [*(item.get("parameters") or []), *(op.get("parameters") or [])]:
        p = spec.resolve(p)
        if isinstance(p, dict):
            params[(p.get("name"), p.get("in"))] = p
    return Operation(
        method=method.upper(), path=path, operation_id=op.get("operationId"),
        tags=[str(t) for t in op.get("tags") or []],
        summary=op.get("summary") or item.get("summary"),
        description=op.get("description") or item.get("description"),
        parameters=list(params.values()),
        request_body=spec.resolve(op["requestBody"]) if op.get("requestBody") else None,
        responses={str(c): spec.resolve(r) for c, r in (op.get("responses") or {}).items()},
        security=op["security"] if "security" in op else (doc.get("security") or []),
        servers=op.get("servers") or item.get("servers") or doc.get("servers") or [],
        deprecated=bool(op.get("deprecated")), hidden=bool(op.get("x-hidden")),
        excluded=bool(op.get("x-excluded")), webhook=webhook, pointer=pointer,
        extensions={k: v for k, v in op.items() if k.startswith("x-")}, raw=op,
    )


def check_operations(spec: ApiSpec) -> list[tuple[str, str, str]]:
    """(severity, message, pointer) findings about paths and operations."""
    found = [("error", f"Path '{p}' must start with '/'", to_pointer(["paths", p]))
             for p in spec.document.get("paths") or {} if not str(p).startswith("/")]
    ids: dict[str, str] = {}
    for op in spec.operations:
        if op.operation_id in ids:
            found.append(("error", f"Duplicate operationId '{op.operation_id}' "
                          f"(also at {ids[op.operation_id]})", op.pointer))
        elif op.operation_id:
            ids[op.operation_id] = op.pointer
        declared = {p.get("name") for p in op.parameters if p.get("in") == "path"}
        for var in [] if op.webhook else re.findall(r"{([^{}]+)}", op.path):
            if var not in declared:
                found.append(("warning", f"{op.method} {op.path}: path parameter '{var}' "
                              "is not declared", op.pointer))
    tags = [t for t in spec.document.get("tags") or [] if isinstance(t, dict)]
    parents = {str(t.get("name")): t.get("parent") for t in tags}
    for i, t in enumerate(tags):
        name, parent, where = str(t.get("name")), t.get("parent"), to_pointer(["tags", i])
        if [str(x.get("name")) for x in tags].index(name) != i:
            found.append(("warning", f"Duplicate tag '{name}'", where))
        if parent is not None and str(parent) not in parents:
            found.append(("warning", f"Tag '{name}': parent '{parent}' is not a declared tag", where))
        seen, up = {name}, parent
        while up is not None and str(up) in parents and str(up) not in seen:
            seen.add(str(up))
            up = parents[str(up)]
        if up is not None and str(up) == name:
            found.append(("warning", f"Tag '{name}': its parents form a cycle", where))
    return found


def is_url(source: str) -> bool:
    return urlparse(source).scheme in ("http", "https")


def fetch_url(url: str) -> str:
    """GET ``url`` (localhost works) and return its text."""
    req = urllib.request.Request(url, headers={"User-Agent": "aiui"})
    with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - http(s) only
        return resp.read(32 * 1024 * 1024).decode("utf-8-sig")


def parse_text(text: str) -> Any:
    """JSON when it looks like JSON, else YAML. Raises ValueError naming the line."""
    try:
        if text.lstrip().startswith("{"):
            return json.loads(text)
        return yaml.safe_load(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"line {e.lineno}: {e.msg}") from e
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        raise ValueError(f"line {mark.line + 1 if mark else '?'}: {getattr(e, 'problem', None) or e}") from e


@functools.lru_cache(maxsize=8)
def _compose(text: str) -> yaml.Node | None:
    try:
        return yaml.compose(text, Loader=yaml.SafeLoader)
    except yaml.YAMLError:
        return None


def line_of(text: str, pointer: str) -> int | None:
    """1-based line of ``pointer`` in ``text`` (a mapping entry: its key's line)."""
    node = _compose(text)
    line = node.start_mark.line + 1 if node is not None else None
    for part in pointer_parts(pointer):
        if isinstance(node, yaml.MappingNode):
            pair = next(((k, v) for k, v in node.value if str(k.value) == part), None)
            node, line = (pair[1], pair[0].start_mark.line + 1) if pair else (None, line)
        elif isinstance(node, yaml.SequenceNode) and part.isdigit() and int(part) < len(node.value):
            node = node.value[int(part)]
            line = node.start_mark.line + 1
        else:
            break
    return line


def _unique(name: str, taken: Any, sep: str) -> str:
    n = 1
    while (name if n == 1 else f"{name}{sep}{n}") in taken:
        n += 1
    return name if n == 1 else f"{name}{sep}{n}"


class _Bundler:
    """Pulls external ``$ref``s into the root. A ``#/components/<kind>/<name>``
    target keeps its kind and name (``_2`` on a clash); any other target is
    inlined, or put in ``components/schemas`` when inlining would loop."""

    def __init__(self, fetch: Fetch, root: str):
        self.fetch, self.root, self.issues = fetch, root, []
        self.texts: dict[str, str] = {}  # loc -> source text, for line numbers
        self.docs: dict[str, Any] = {}  # loc -> parsed (None: unreadable)
        self.added: dict[tuple, tuple[str, str]] = {}  # (loc, ptr) -> (kind, name)
        self.components: dict[str, dict[str, Any]] = {}  # kind -> name -> node
        self.inlined: dict[tuple, Any] = {}  # (loc, ptr) -> walked node
        self.active: set[tuple] = set()  # (loc, ptr) being inlined: a hit is a cycle

    def load(self, loc: str, at: tuple = ()) -> Any:
        if loc not in self.docs:
            self.docs[loc] = None
            try:
                text = self.fetch(loc) if is_url(loc) else Path(loc).read_text("utf-8-sig")
                self.texts[loc] = text
                self.docs[loc] = parse_text(text)
            except (OSError, ValueError) as e:
                self.issue("error", f"Cannot read {loc}: {e}", *(at or (loc,)))
        return self.docs[loc]

    def issue(self, severity: str, message: str, file: str, pointer: str = "#") -> None:
        line = line_of(self.texts[file], pointer) if file in self.texts else None
        self.issues.append(SpecIssue(severity, message, file, pointer, line))  # type: ignore[arg-type]

    def walk(self, node: Any, loc: str, path: list) -> Any:
        if isinstance(node, list):
            return [self.walk(x, loc, [*path, i]) for i, x in enumerate(node)]
        if isinstance(node, (_dt.date, _dt.datetime)):
            return node.isoformat()  # YAML dates: keep the spec JSON-serialisable
        if not isinstance(node, dict):
            return node
        if isinstance(node.get("$ref"), str):
            return self.ref(node, loc, path)
        return {str(k): self.walk(v, loc, [*path, k]) for k, v in node.items()}

    def ref(self, node: dict, loc: str, path: list) -> Any:
        file_part, _, frag = node["$ref"].partition("#")
        frag, here, parts = "#" + frag, (loc, to_pointer(path)), pointer_parts(frag)
        target_loc = loc if not file_part else urljoin(loc, file_part) if (
            is_url(loc) or is_url(file_part)) else str((Path(loc).parent / file_part).resolve())
        siblings = {k: self.walk(v, loc, [*path, k]) for k, v in node.items() if k != "$ref"}
        target = resolve_pointer(self.load(target_loc, here), frag)
        if target is None:
            if self.docs.get(target_loc) is not None:  # an unreadable file is reported once
                self.issue("error", f"$ref '{node['$ref']}' does not resolve", *here)
            return dict(node)
        if target_loc == self.root:
            return {"$ref": frag, **siblings}
        key, m = (target_loc, frag), _COMPONENT.match(frag[1:])
        if key not in self.added and (m or key in self.active):
            kind = m.group(1) if m else "schemas"
            name = (parts or [Path(urlparse(target_loc).path).stem])[-1]
            name = re.sub(r"[^A-Za-z0-9_.-]", "_", name) or "Schema"
            root = ((self.docs[self.root] or {}).get("components") or {}).get(kind) or {}
            taken = self.components.setdefault(kind, {})
            name = _unique(name, {*taken, *root}, "_")
            taken[name], self.added[key] = None, (kind, name)
            if m:
                taken[name] = self.walk(target, target_loc, parts)
        if key not in self.added and key not in self.inlined:
            self.active.add(key)
            out = self.walk(target, target_loc, parts)
            self.active.discard(key)
            if key in self.added:  # it refers to itself: keep it as a component
                self.components["schemas"][self.added[key][1]] = out
            else:
                self.inlined[key] = out
        if key in self.added:
            return {"$ref": to_pointer(["components", *self.added[key]]), **siblings}
        out = self.inlined[key]
        return {**out, **siblings} if siblings and isinstance(out, dict) else out


def load_spec(source: str, base_path: Path | str | None = None, *,
              fetch: Fetch | None = None) -> ApiSpec:
    """Load, bundle, normalise and check one spec: a path (relative to
    ``base_path``, default cwd) or an http(s) URL. ``document`` stays empty
    when the spec is unreadable or not OpenAPI 3.x; see ``spec.issues``."""
    loc = source if is_url(source) else str((Path(base_path or Path.cwd()) / source).resolve())
    spec = ApiSpec(source=source, location=loc)
    b = _Bundler(fetch or fetch_url, loc)
    raw = b.load(loc)
    spec.issues = b.issues
    if not isinstance(raw, dict):
        if raw is not None:
            b.issue("error", "The spec is not a JSON/YAML object", loc)
        return spec
    version = str(raw.get("openapi") or "")
    if raw.get("swagger"):
        b.issue("error", "Swagger 2.0 is not supported; convert it to OpenAPI 3 "
                "(e.g. https://converter.swagger.io)", loc, "#/swagger")
        return spec
    if not re.match(r"^3\.[012]\.\d+", version):
        b.issue("error", f"Unsupported or missing 'openapi' version '{version}' "
                "(3.0, 3.1 and 3.2 are supported)", loc, "#/openapi" if version else "#")
        return spec
    info = raw.get("info")
    if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
        b.issue("error", "'info' needs a 'title' and a 'version'", loc, "#/info")
    spec.openapi, spec.bundled = version, b.walk(raw, loc, [])
    for kind, entries in b.components.items():
        spec.bundled.setdefault("components", {}).setdefault(kind, {}).update(entries)
    spec.document = copy.deepcopy(spec.bundled)
    if version.startswith("3.0"):
        normalise_30(spec.document)
    spec.operations = extract_operations(spec)
    for severity, message, pointer in check_operations(spec):
        b.issue(severity, message, loc, pointer)
    return spec


@dataclass(frozen=True)
class SpecSource:
    """Where the config names a spec (``where``: ``navigation.tabs[0].openapi[1]``)."""

    source: str
    directory: str | None  # from {source, directory}: endpoint pages' folder
    where: str


def _entries(value: Any, where: str) -> list[SpecSource]:
    if isinstance(value, list):
        return [e for i, v in enumerate(value) for e in _entries(v, f"{where}[{i}]")]
    if isinstance(value, str):
        return [SpecSource(value, None, where)]
    return [SpecSource(value.source, value.directory, where)] if value is not None else []


def spec_sources(config: "Config") -> list[SpecSource]:
    """Every spec reference: ``api.openapi``, then tabs and their (nested) groups,
    then the root ``navigation.groups`` and ``navigation.pages`` groups."""
    out = _entries(config.api.openapi, "api.openapi") if config.api else []

    def group(g: Any, where: str) -> None:
        out.extend(_entries(g.openapi, f"{where}.openapi"))
        for k, page in enumerate(g.pages):
            if hasattr(page, "group"):  # a nested group (not a page name or a link)
                group(page, f"{where}.pages[{k}]")

    nav = config.navigation
    for i, tab in enumerate(nav.tabs if nav else []):
        out.extend(_entries(tab.openapi, f"navigation.tabs[{i}].openapi"))
        for j, g in enumerate(tab.groups):
            group(g, f"navigation.tabs[{i}].groups[{j}]")
    for key in ("groups", "pages"):
        for j, g in enumerate(getattr(nav, key) if nav else []):
            if hasattr(g, "group"):
                group(g, f"navigation.{key}[{j}]")
    return out


def load_config_specs(config: "Config", base_path: Path | str | None = None, *,
                      fetch: Fetch | None = None) -> dict[str, ApiSpec]:
    """``{source: ApiSpec}``, each spec loaded once, with a unique ``slug``."""
    specs: dict[str, ApiSpec] = {}
    for ref in spec_sources(config):
        if ref.source not in specs:
            stem = re.sub(r"[^a-z0-9]+", "-", Path(urlparse(ref.source).path).stem.lower())
            slug = _unique(stem.strip("-") or "openapi", {"index", *(s.slug for s in specs.values())}, "-")
            specs[ref.source] = load_spec(ref.source, base_path, fetch=fetch)
            specs[ref.source].slug = slug
    return specs
