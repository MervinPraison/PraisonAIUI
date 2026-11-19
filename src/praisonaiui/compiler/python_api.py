"""Python API reference from docstrings: a ``::: package.module`` line in a docs page.

Expanded in the snippets pass (compiler/snippets.py), so the page, search, the agent
``.md``, ``llms-full.txt`` and ``aiui validate`` see the same text. Source is read with
``ast`` (nothing is imported) from ``content.docs.reference.paths``. Google, NumPy and
reST docstrings become ``<ParamField>`` / ``<ResponseField>`` rows, lists and code fences.
Options are YAML on indented lines under the block. See docs/features/api-reference-python.md.
"""

from __future__ import annotations

import ast
import re
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Union

import yaml

DEFAULT_PATHS = ("src", ".")
OPTIONS = {"members": (list, bool), "private": bool, "show_source": bool, "heading_level": int}
DIRECTIVE = re.compile(r"^:::[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*((?:\n[ \t]+\S[^\n]*)*)$", re.M)

_SECTION = {
    "args": "params", "arguments": "params", "parameters": "params", "params": "params",
    "keyword args": "params", "keyword arguments": "params", "other parameters": "params",
    "attributes": "attributes", "returns": "returns", "return": "returns", "yields": "yields",
    "yield": "yields", "raises": "raises", "raise": "raises", "exceptions": "raises",
    "examples": "Examples", "example": "Examples", "note": "Note", "notes": "Note",
    "warning": "Warning", "warnings": "Warning", "see also": "See also", "references": "References",
}
_GOOGLE = re.compile(rf"^({'|'.join(_SECTION)})\s*:\s*$", re.I)
_REST_FIELD = re.compile(r"^:(param|parameter|arg|argument|key|keyword|type|returns?|rtype|raises?|except|exception"
                         r"|yields?|ytype|var|ivar|cvar|vartype)(?:\s+([^:]+?))?:\s*(.*)$")
_ITEM_GOOGLE = re.compile(r"^(\*{0,2}[A-Za-z_][\w.]*)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$")
_ITEM_NUMPY = re.compile(r"^(\*{0,2}[A-Za-z_][\w.]*)\s*(?::\s*(.*))?$")
_TYPE_FIRST = re.compile(r"^([\w.]+(?:\[[^\]]*\])?(?:\s*\|\s*[\w.]+(?:\[[^\]]*\])?)*):\s+(.*)$", re.S)
_ROLE = re.compile(r":(?:py:)?(?:class|func|meth|attr|mod|obj|exc|data|const|ref|term):`~?([^`]+)`")
_CODE_SPAN = re.compile(r"(`+).+?\1")
_REST_BLOCK = re.compile(r"^\.\.\s+(code-block|code|sourcecode|note|warning|tip|important|deprecated)::\s*(.*)$")
_CALLOUT = {"note": "Note", "warning": "Warning", "tip": "Tip", "important": "Warning", "deprecated": "Warning"}
_FUNC = (ast.FunctionDef, ast.AsyncFunctionDef)

Node = Union[ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef]
_CACHE: dict[Path, tuple[int, ast.Module, list[str]]] = {}  # file -> (mtime, tree, lines); kept across `aiui dev` builds


class ApiReferenceError(LookupError):
    """A ``:::`` block that names nothing, or has options that are not understood (7016)."""


@dataclass
class _Obj:
    node: Node
    path: str  # the full dotted name
    file: Path
    lines: list[str]
    owner: str = ""  # the class a method or nested class sits in (``Outer.Inner``)

    @property
    def qualname(self) -> str:
        return self.path if isinstance(self.node, ast.Module) else f"{self.owner}.{self.node.name}".lstrip(".")


def parse(path: Path) -> tuple[ast.Module, list[str]]:
    """``path``'s syntax tree and lines, cached by modification time."""
    mtime = path.stat().st_mtime_ns
    hit = _CACHE.get(path)
    if hit is None or hit[0] != mtime:
        source = path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source)
        except SyntaxError as e:
            raise ApiReferenceError(f"{path.name} line {e.lineno} is not valid Python") from e
        hit = _CACHE[path] = (mtime, tree, source.splitlines())
    return hit[1], hit[2]


def options(text: str) -> dict:
    """The YAML options under a directive (an ``options:`` mapping works too)."""
    try:
        data = yaml.safe_load(textwrap.dedent(text)) if text.strip() else {}
    except yaml.YAMLError as e:
        raise ApiReferenceError(f"its options are not valid YAML ({str(e).splitlines()[0]})") from e
    if isinstance(data, dict) and isinstance(data.get("options"), dict) and len(data) == 1:
        data = data["options"]
    if not isinstance(data, dict):
        raise ApiReferenceError("its options must be key: value lines")
    for key, value in data.items():
        if key not in OPTIONS:
            raise ApiReferenceError(f"unknown option '{key}' (known: {', '.join(OPTIONS)})")
        if not isinstance(value, OPTIONS[key]) or (key == "heading_level" and (value is True or not 1 <= value <= 6)):
            raise ApiReferenceError(f"option '{key}' has the wrong type")
    return data


class PythonApi:
    """Finds and renders the objects ``:::`` blocks name.

    Args:
        root: The project folder.
        paths: Folders under ``root`` searched in order for a module's file.
    """

    def __init__(self, root: Path, paths: list[str] | tuple[str, ...] = DEFAULT_PATHS):
        self.roots = [(root / p).resolve() for p in paths]

    def module_file(self, name: str) -> Path | None:
        rel = Path(*name.split("."))
        for base in self.roots:
            for candidate in (base / rel / "__init__.py", base / rel.parent / f"{rel.name}.py",
                              base / rel.parent / f"{rel.name}.pyi"):
                if candidate.is_file():
                    return candidate
        return None

    def find(self, target: str, depth: int = 0) -> _Obj:
        """The module, class, function or method ``target`` names (re-exports followed)."""
        parts = target.split(".")
        for cut in range(len(parts), 0, -1):
            module = ".".join(parts[:cut])
            file = self.module_file(module)
            if file is None:
                continue
            tree, lines = parse(file)
            obj = _Obj(tree, module, file, lines)
            for name in parts[cut:]:
                found = self._member(obj, name, depth)
                if found is None:
                    raise ApiReferenceError(f"'{obj.path}' has no member '{name}'")
                obj = found
            return obj
        searched = ", ".join(str(r) for r in self.roots)
        raise ApiReferenceError(f"no module '{parts[0]}' found (looked in {searched})")

    def _member(self, obj: _Obj, name: str, depth: int = 0) -> _Obj | None:
        body = obj.node.body
        owner = "" if isinstance(obj.node, ast.Module) else obj.qualname
        for node in reversed(body):  # the last definition wins, as at run time
            if isinstance(node, (*_FUNC, ast.ClassDef)) and node.name == name:
                return _Obj(node, f"{obj.path}.{name}", obj.file, obj.lines, owner)
        if not isinstance(obj.node, ast.Module) or depth > 5:  # re-exports: `from .x import Name`
            return None
        package = obj.path if obj.file.stem == "__init__" else obj.path.rpartition(".")[0]
        for node in body:
            if isinstance(node, ast.ImportFrom):
                for alias in node.names:
                    if (alias.asname or alias.name) == name:
                        base = package.split(".")[: len(package.split(".")) - node.level + 1] if node.level else []
                        source = ".".join([*base, *([node.module] if node.module else [])])
                        try:
                            return self.find(f"{source}.{alias.name}", depth + 1)
                        except ApiReferenceError:
                            return None
        return None

    def markdown(self, target: str, opts: dict) -> str:
        """The Markdown for one ``::: target`` block.

        Args:
            target: A dotted module path, optionally followed by a class, function or method.
            opts: The block's options (``members``, ``private``, ``show_source``, ``heading_level``).

        Returns:
            str: Headings, signatures and field rows for the docs Markdown pipeline.

        Raises:
            ApiReferenceError: When ``target`` names nothing, or a listed member does not exist.
        """
        obj = self.find(target)
        level = opts.get("heading_level", 2)
        out = self._render(obj, level, opts, root=True)
        return "\n".join(out).strip("\n")

    # -- members ----------------------------------------------------------

    def _members(self, obj: _Obj, opts: dict, root: bool) -> tuple[list[_Obj], list[tuple[str, ast.stmt, str | None]]]:
        """``obj``'s documented members (headings) and attributes (field rows)."""
        node, private = obj.node, opts.get("private", False)
        wanted = opts.get("members", True) if root else True
        if wanted is False:
            return [], []
        names = list(wanted) if isinstance(wanted, list) else None
        if names is None and isinstance(node, ast.Module):
            names = _dunder_all(node)
        attrs = _attributes(node)
        found: list[_Obj] = []
        if names is not None:
            by_name = {a[0]: a for a in attrs}
            attrs = [by_name[n] for n in names if n in by_name]
            for name in names:
                if name in by_name:
                    continue
                member = self._member(obj, str(name))
                if member is None and isinstance(wanted, list):
                    raise ApiReferenceError(f"'{obj.path}' has no member '{name}'")
                if member is not None and not isinstance(member.node, ast.Module):
                    member.path = f"{obj.path}.{name}"  # anchors follow the documented path
                    found.append(member)
            return found, attrs
        for child in node.body:
            if not isinstance(child, (*_FUNC, ast.ClassDef)) or not (not child.name.startswith('_') or private and not child.name.startswith('__')):
                continue
            if isinstance(child, _FUNC) and (_property(child) or any(
                    ast.unparse(d).endswith("overload") for d in child.decorator_list)):
                continue
            found.append(_Obj(child, f"{obj.path}.{child.name}", obj.file, obj.lines,
                              "" if isinstance(node, ast.Module) else obj.qualname))
        return found, [a for a in attrs if not a[0].startswith('_') or private and not a[0].startswith('__')]

    # -- rendering --------------------------------------------------------

    def _render(self, obj: _Obj, level: int, opts: dict, root: bool = False) -> list[str]:
        node, anchor = obj.node, obj.path.replace(".", "-")
        is_method = bool(obj.owner)
        label = f"{obj.qualname}()" if isinstance(node, _FUNC) else obj.qualname
        out = [f"{'#' * min(level, 6)} `{label}` {{#{anchor}}}", ""]
        doc = ast.get_docstring(node) or ""
        init = next((n for n in node.body if isinstance(n, _FUNC) and n.name == "__init__"), None) \
            if isinstance(node, ast.ClassDef) else None
        if isinstance(node, ast.ClassDef) and not doc.strip() and init is not None:
            doc = ast.get_docstring(init) or ""
        parsed = _docstring(doc)
        if init is not None and ast.get_docstring(init) and doc != ast.get_docstring(init):
            extra = _docstring(ast.get_docstring(init) or "")
            parsed.params.update({k: v for k, v in extra.params.items() if k not in parsed.params})
        if not isinstance(node, ast.Module):
            out += ["```python", *_signature(node, init, is_method), "```", ""]
            bases = [ast.unparse(b) for b in node.bases] if isinstance(node, ast.ClassDef) else []
            if bases and bases != ["object"]:
                out += ["Bases: " + ", ".join(f"`{b}`" for b in bases), ""]
        out += parsed.lead
        func = init if isinstance(node, ast.ClassDef) else node
        if isinstance(func, _FUNC):
            out += _params(func, parsed, anchor, is_method or func is init)
        if isinstance(node, _FUNC):
            ann = _ann(node.returns)
            returns = parsed.returns or ([("", ann, "")] if ann and ann != "None" else [])
            if returns:
                out += _list("Yields" if parsed.yields_only else "Returns", returns, ann)
        if parsed.raises:
            out += _list("Raises", parsed.raises, "")
        members, attrs = self._members(obj, opts, root) if not isinstance(node, _FUNC) else ([], [])
        if not isinstance(node, _FUNC):
            out += _attribute_rows(attrs, parsed, anchor, node)
        out += parsed.tail
        if opts.get("show_source") and not isinstance(node, ast.Module):
            start = min([d.lineno for d in getattr(node, "decorator_list", [])] + [node.lineno])
            source = textwrap.dedent("\n".join(obj.lines[start - 1: node.end_lineno]))
            out += ['<Accordion title="Source code">', "", "```python", source, "```", "", "</Accordion>", ""]
        for member in members:
            out += self._render(member, level + 1, opts)
        return out


def _property(node: ast.AST) -> str | None:
    """``"property"`` for a getter, ``"setter"`` for ``@x.setter``/``deleter``, else None."""
    for d in getattr(node, "decorator_list", []):
        text = ast.unparse(d)
        if text.endswith(("property", "cached_property")):
            return "property"
        if text.endswith((".setter", ".deleter")):
            return "setter"
    return None


def _dunder_all(tree: ast.Module) -> list[str] | None:
    for node in tree.body:
        target = node.targets[0] if isinstance(node, ast.Assign) and len(node.targets) == 1 else getattr(node, "target", None)
        if isinstance(target, ast.Name) and target.id == "__all__" and isinstance(node.value, (ast.List, ast.Tuple)):
            return [e.value for e in node.value.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return None


def _attributes(node: Node) -> list[tuple[str, ast.stmt, str | None]]:
    """Annotated or documented names (a string right after the assignment), and properties."""
    out, body = [], getattr(node, "body", [])
    for i, stmt in enumerate(body):
        nxt = body[i + 1] if i + 1 < len(body) else None
        doc = nxt.value.value if isinstance(nxt, ast.Expr) and isinstance(nxt.value, ast.Constant) \
            and isinstance(nxt.value.value, str) else None
        if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name):
            out.append((stmt.target.id, stmt, doc))
        elif isinstance(stmt, ast.Assign) and len(stmt.targets) == 1 and isinstance(stmt.targets[0], ast.Name):
            if doc is not None or isinstance(node, ast.Module):
                out.append((stmt.targets[0].id, stmt, doc))
        elif isinstance(stmt, _FUNC) and _property(stmt) == "property":
            out.append((stmt.name, stmt, ast.get_docstring(stmt)))
    if isinstance(node, ast.Module):  # a module's undocumented names only when __all__ lists them
        listed = set(_dunder_all(node) or [])
        out = [a for a in out if a[2] is not None or a[0] in listed]
    return [a for a in out if a[0] != "__all__"]


def _signature(node: Node, init: ast.FunctionDef | None, method: bool) -> list[str]:
    decorators = [f"@{ast.unparse(d)}" for d in getattr(node, "decorator_list", [])]
    if isinstance(node, ast.ClassDef):
        if init is None:
            bases = ", ".join(ast.unparse(b) for b in node.bases)
            return [*decorators, f"class {node.name}" + (f"({bases})" if bases else "")]
        args, ret, prefix = _args(init, True), "", ""
    else:
        static = any(ast.unparse(d).endswith("staticmethod") for d in node.decorator_list)
        args = _args(node, method and not static)
        ret = f" -> {_ann(node.returns)}" if node.returns else ""
        prefix = "async def " if isinstance(node, ast.AsyncFunctionDef) else "def "
    one = f"{prefix}{node.name}({', '.join(args)}){ret}"
    if len(one) <= 88:
        return [*decorators, one]
    return [*decorators, f"{prefix}{node.name}(", *(f"    {a}," for a in args), f"){ret}"]


def _params_of(func: ast.FunctionDef | ast.AsyncFunctionDef, drop_first: bool) -> list[tuple[str, str, str | None, bool]]:
    """``(shown name, annotation, default, required)`` per parameter; ``/`` and ``*`` markers too."""
    a = func.args
    positional = [*a.posonlyargs, *a.args]
    defaults = [None] * (len(positional) - len(a.defaults)) + list(a.defaults)
    out = []
    for i, (arg, default) in enumerate(zip(positional, defaults)):
        if i == 0 and drop_first:
            continue
        out.append((arg.arg, _ann(arg.annotation),
                    ast.unparse(default) if default is not None else None, default is None))
        if a.posonlyargs and arg is a.posonlyargs[-1]:
            out.append(("/", "", None, False))
    if a.vararg:
        out.append((f"*{a.vararg.arg}", _ann(a.vararg.annotation), None, False))
    elif a.kwonlyargs:
        out.append(("*", "", None, False))
    for arg, default in zip(a.kwonlyargs, a.kw_defaults):
        out.append((arg.arg, _ann(arg.annotation),
                    ast.unparse(default) if default is not None else None, default is None))
    if a.kwarg:
        out.append((f"**{a.kwarg.arg}", _ann(a.kwarg.annotation), None, False))
    return out


def _args(func: ast.FunctionDef | ast.AsyncFunctionDef, drop_first: bool) -> list[str]:
    return [name + (f": {ann}" if ann else "") + (f" = {d}" if d is not None and ann else f"={d}" if d is not None else "")
            for name, ann, d, _ in _params_of(func, drop_first)]


def _ann(node: ast.expr | None) -> str:
    """An annotation as written; a string annotation (``"Client"``) without its quotes."""
    if node is None:
        return ""
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else ast.unparse(node)


def _field(tag: str, name: str, anchor: str, type_: str, default: str | None, required: bool, desc: str) -> list[str]:
    def _attr(text: str) -> str:
        return text.replace('"', "'").replace("\n", " ")

    attrs = f'name="{_attr(name)}"' + (f' type="{_attr(type_)}"' if type_ else "") + " required" * required
    attrs += (f' default="{_attr(default)}"' if default is not None else "") + f' id="{anchor}-{name.strip("*")}"'
    body = [f"  {line}".rstrip() for line in _prose(desc).splitlines()]
    return [f"<{tag} {attrs}>", *body, f"</{tag}>", ""]


def _params(func: ast.FunctionDef | ast.AsyncFunctionDef, doc: _Doc, anchor: str, drop_first: bool) -> list[str]:
    rows: list[str] = []
    seen = set()
    for name, ann, default, required in _params_of(func, drop_first):
        if name in ("/", "*"):
            continue
        key = name.lstrip("*")
        seen.add(key)
        dtype, desc = doc.params.get(key, doc.params.get(name, ("", "")))
        rows += _field("ParamField", name, anchor, ann or dtype, default, required, desc)
    for key, (dtype, desc) in doc.params.items():  # documented keyword arguments taken by **kwargs
        if key.lstrip("*") not in seen:
            rows += _field("ParamField", key, anchor, dtype, None, False, desc)
    return ["**Parameters**", "", *rows] if rows else []


def _attribute_rows(attrs: list, doc: _Doc, anchor: str, node: Node) -> list[str]:
    rows: list[str] = []
    for name, stmt, text in attrs:
        if isinstance(stmt, _FUNC):
            ann, default = _ann(stmt.returns), None
        else:
            ann = _ann(stmt.annotation) if isinstance(stmt, ast.AnnAssign) else ""
            default, described = _default(stmt.value)
            text = text or described
        dtype, ddesc = doc.attributes.get(name, ("", ""))
        rows += _field("ResponseField", name, anchor, ann or dtype, default, False, text or ddesc)
    for name, (dtype, desc) in doc.attributes.items():
        if name not in {a[0] for a in attrs}:
            rows += _field("ResponseField", name, anchor, dtype, None, False, desc)
    return ["**Attributes**", "", *rows] if rows else []


def _default(value: ast.expr | None) -> tuple[str | None, str | None]:
    """A field's shown default and description; ``Field(...)`` / ``field(...)`` calls are read."""
    if isinstance(value, ast.Call) and ast.unparse(value.func).rpartition(".")[2] in ("Field", "field"):
        kw = {k.arg: k.value for k in value.keywords if k.arg}
        found = kw.get("default", value.args[0] if value.args else None)
        made = kw.get("default_factory")
        factory = ast.unparse(made.body if isinstance(made, ast.Lambda) else made) if made else ""
        desc = kw.get("description")
        text = desc.value if isinstance(desc, ast.Constant) and isinstance(desc.value, str) else None
        shown = {"list": "[]", "dict": "{}", "set": "set()"}.get(factory) or (
            factory if isinstance(made, ast.Lambda) else f"{factory}()" if factory else None)
        if found is not None and not (isinstance(found, ast.Constant) and found.value is Ellipsis):
            shown = ast.unparse(found)
        return shown, text
    shown = ast.unparse(value) if value is not None else None
    return (shown[:57] + "..." if shown and len(shown) > 60 else shown), None


def _list(title: str, items: list[tuple[str, str, str]], fallback_type: str) -> list[str]:
    out = [f"**{title}**", ""]
    for name, type_, desc in items:
        head = " ".join(f"`{x}`" for x in (name, type_ or fallback_type) if x)
        text = _prose(desc).replace("\n", "\n  ")
        out.append(f"- {head}: {text}" if head and text else f"- {head or text}")
    return [*out, ""]


# -- docstrings -----------------------------------------------------------


@dataclass
class _Doc:
    lead: list[str] = field(default_factory=list)  # Markdown before the first structured section
    tail: list[str] = field(default_factory=list)  # Markdown after it (examples, notes)
    params: dict[str, tuple[str, str]] = field(default_factory=dict)
    attributes: dict[str, tuple[str, str]] = field(default_factory=dict)
    returns: list[tuple[str, str, str]] = field(default_factory=list)
    raises: list[tuple[str, str, str]] = field(default_factory=list)
    yields_only: bool = False


def _docstring(text: str) -> _Doc:
    """Google, NumPy or reST sections of a cleaned docstring."""
    doc, lines = _Doc(), text.splitlines()
    lines = _rest_fields(lines, doc)
    chunks: list[tuple[str | None, str, bool, list[str]]] = [(None, "", False, [])]  # (kind, title, numpy, lines)
    i = 0
    while i < len(lines):
        line = lines[i]
        under = lines[i + 1].strip() if i + 1 < len(lines) else ""
        numpy = bool(re.fullmatch(r"-{3,}", under)) and line.strip().lower() in _SECTION
        google = _GOOGLE.match(line)
        if numpy or google:
            title = line.strip().rstrip(":").strip()
            chunks.append((_SECTION[title.lower()], title, numpy, []))
            i += 2 if numpy else 1
            continue
        kind, title, was_numpy, body = chunks[-1]
        if kind and not was_numpy and line.strip() and not line[0].isspace():
            chunks.append((None, "", False, []))  # Google section ends at unindented text
        chunks[-1][3].append(line)
        i += 1
    structured = False
    for kind, title, numpy, body in chunks:
        block = textwrap.dedent("\n".join(body)).strip("\n")
        if kind in ("params", "attributes"):
            target = doc.params if kind == "params" else doc.attributes
            for name, type_, desc in _items(block, numpy):
                target[name] = (type_, desc)
        elif kind in ("returns", "yields"):
            doc.yields_only = kind == "yields"
            if numpy:
                doc.returns += [(n, t, d) if t else ("", n, d) for n, t, d in _items(block, True)]
            elif block:
                m = _TYPE_FIRST.match(block)
                doc.returns.append(("", m.group(1), textwrap.dedent(m.group(2))) if m else ("", "", block))
        elif kind == "raises":
            doc.raises += [(n, "", f"{t}: {d}".strip(": ") if t and not numpy else d) for n, t, d in _items(block, numpy)]
        elif kind is None:
            if block:
                (doc.tail if structured else doc.lead).extend([_prose(block), ""])
            continue
        else:
            text = _prose(block)
            if kind in ("Note", "Warning"):
                doc.tail += [f"<{kind}>", text, f"</{kind}>", ""]
            else:
                doc.tail += [f"**{title}**", "", text, ""]
        structured = True
    return doc


def _items(block: str, numpy: bool) -> list[tuple[str, str, str]]:
    """``name (type): text`` (Google) or ``name : type`` + indented text (NumPy) entries."""
    items: list[list] = []
    for line in block.splitlines():
        m = None if not line or line[0].isspace() else (_ITEM_NUMPY if numpy else _ITEM_GOOGLE).match(line)
        if m:
            items.append([m.group(1), (m.group(2) or "").strip(), [m.group(3)] if not numpy else [""]])
        elif items:
            items[-1][2].append(line)
    out = []
    for name, type_, desc in items:
        first, rest = desc[0], textwrap.dedent("\n".join(desc[1:]))
        type_ = re.sub(r",?\s*optional$", "", type_).strip()
        out.append((name, type_, f"{first}\n{rest}".strip()))
    return out


def _rest_fields(lines: list[str], doc: _Doc) -> list[str]:
    """Take ``:param x:`` / ``:type x:`` / ``:returns:`` / ``:raises E:`` fields out of ``lines``."""
    kept, fields = [], []
    for line in lines:
        m = _REST_FIELD.match(line)
        if m:
            fields.append([m.group(1), (m.group(2) or "").strip(), m.group(3)])
        elif fields and line[:1].isspace() and kept[-1:] == ["\0"]:
            fields[-1][2] += "\n" + line.strip()
            continue
        else:
            kept.append(line)
            continue
        kept.append("\0")
    types = {f[1]: f[2] for f in fields if f[0] in ("type", "vartype")}
    rtype = next((f[2] for f in fields if f[0] in ("rtype", "ytype")), "")
    for kind, arg, text in fields:
        name = arg.split()[-1] if arg else ""
        if kind in ("param", "parameter", "arg", "argument", "key", "keyword"):
            doc.params[name] = (" ".join(arg.split()[:-1]) or types.get(name, ""), text)
        elif kind in ("var", "ivar", "cvar"):
            doc.attributes[name] = (types.get(name, ""), text)
        elif kind in ("returns", "return", "yields", "yield"):
            doc.returns.append(("", rtype, text))
            doc.yields_only = kind.startswith("yield")
        elif kind in ("raises", "raise", "except", "exception"):
            doc.raises.append((arg, "", text))
    if rtype and not doc.returns:
        doc.returns.append(("", rtype, ""))
    return [line for line in kept if line != "\0"]


def _prose(text: str) -> str:
    """Docstring text as Markdown: ``>>>`` runs, ``::`` and ``.. code-block::`` blocks become
    fences, ``.. note::`` a callout, reST roles code spans; ``<`` outside code is escaped."""
    lines, out, i, fence = text.splitlines(), [], 0, False
    while i < len(lines):
        line, stripped = lines[i], lines[i].strip()
        if stripped.startswith(("```", "~~~")) or fence:
            fence ^= stripped.startswith(("```", "~~~"))
            out.append(line)
            i += 1
            continue
        if stripped.startswith(">>>"):
            j = i
            while j < len(lines) and lines[j].strip():
                j += 1
            out += ["```python", textwrap.dedent("\n".join(lines[i:j])), "```"]
            i = j
            continue
        directive = _REST_BLOCK.match(stripped)
        if directive or (stripped.endswith("::") and not stripped.startswith("..")):
            indent = len(line) - len(line.lstrip())
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or len(lines[j]) - len(lines[j].lstrip()) > indent):
                j += 1
            body = textwrap.dedent("\n".join(lines[i + 1:j])).strip("\n")
            if directive and directive.group(1) in _CALLOUT:
                tag, arg = _CALLOUT[directive.group(1)], directive.group(2).strip()
                head = f"Deprecated since {arg}." if directive.group(1) == "deprecated" and arg else arg
                out += [f"<{tag}>", _prose("\n\n".join(x for x in (head, body) if x)), f"</{tag}>"]
            elif body:
                lead = "" if directive else stripped[:-2].rstrip()
                lead = lead + ":" if lead and not lead.endswith(":") and stripped.endswith("::") and not stripped.endswith(" ::") else lead
                out += ([_inline(lead), ""] if lead else []) + [f"```{directive.group(2).strip() if directive else 'python'}", body, "```"]
            else:
                out.append(_inline(line))
                j = i + 1
            if j < len(lines):
                out.append("")
            i = j
            continue
        if line.strip() or (out and out[-1].strip()):  # one blank line between blocks
            out.append(_inline(line))
        i += 1
    return "\n".join(out).strip("\n")


def _inline(line: str) -> str:
    """reST roles as code spans; ``<`` escaped outside code spans so text never becomes a tag."""
    line = _ROLE.sub(lambda m: f"`{m.group(1)}`", line)
    parts, last = [], 0
    for m in _CODE_SPAN.finditer(line):
        parts += [line[last:m.start()].replace("<", "&lt;"), m.group(0)]
        last = m.end()
    return "".join([*parts, line[last:].replace("<", "&lt;")])
