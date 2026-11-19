"""Reusable snippets and ``{{variables}}`` in docs pages, expanded at build time.

One pass over a page's source before anything reads it (the browser's ``.source.md``,
the agent ``.md``, ``llms-full.txt``, the search index, titles and descriptions), so
there is no second Markdown pipeline and crawlers and assistants see the expanded text.
See docs/features/writing-docs.md#reusable-snippets-and-variables.

- ``<Snippet file="install.md" pkg="aiui" />`` puts the file's text in place;
  ``{pkg}`` inside it becomes ``aiui``. The MDX import form works too:
  ``import Install from '/snippets/install.mdx'`` then ``<Install pkg="aiui" />``.
- ``--8<-- "install.md"`` on its own line (MkDocs ``pymdownx.snippets``) does the same.
- ``{{name}}`` becomes the top-level ``variables:`` value from aiui.yaml;
  ``\\{{name}}`` stays a literal ``{{name}}``. An unknown name outside code is 7007.

Snippets nest. A path is looked up next to the including file, then in the docs
folder's ``snippets/``, the docs folder and the project folder; ``/x.md`` is
from the docs folder. It must stay inside the project (or docs) folder. A missing
file, a path outside, and a snippet that includes itself are 7008, and fail the
build. References in fenced code are left alone. ``<docs>/snippets/`` is never
published as pages (``docs_scanner.SNIPPETS_EXCLUDE``).

A ``::: package.module`` line becomes that module's API reference from its
docstrings (compiler/python_api.py); one that names nothing is 7016 and fails the build.
"""

from __future__ import annotations

import re
from pathlib import Path

from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.compiler.docs_tags import _prose_segments
from praisonaiui.compiler.python_api import DIRECTIVE, ApiReferenceError, PythonApi, options

_IMPORT = re.compile(r"""^[ \t]*import[ \t]+([A-Z]\w*)[ \t]+from[ \t]+(["'])([^"'\n]+\.mdx?)\2[ \t]*;?[ \t]*(?:\n|$)""", re.M)
_VALUE = r"""(?:"[^"]*"|'[^']*'|\{[^{}]*\})"""
_TAG = re.compile(rf"<([A-Z]\w*)((?:\s+[\w-]+(?:\s*=\s*{_VALUE})?)*)\s*/>")
_ATTR = re.compile(r"""([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*["'`]?(.*?)["'`]?\s*\}))?""", re.S)
_MKDOCS = re.compile(r"""^([ \t]*)(-{2,}8<-{2,}[ \t]+(["']?)([^"'\n]+?)\3)[ \t]*$""", re.M)
_VAR = re.compile(r"(\\?)\{\{([A-Za-z_][\w.-]*)\}\}")
_CODE_SPAN = re.compile(r"(`+).+?\1")
_HINT_PATH = "Paths are looked up next to the page, in the docs snippets/ folder, then the docs folder; /x.md is from the docs folder"


def _text(value: object) -> str:
    return ("true" if value else "false") if isinstance(value, bool) else str(value)


class Snippets:
    """Expands one build's docs pages; ``issues`` holds what it found (7007, 7008)."""

    def __init__(self, root: Path, docs_dir: Path | None, variables: dict | None = None,
                 python: PythonApi | None = None):
        self.root = root.resolve()
        self.python = python or PythonApi(self.root)
        self.docs_dir = docs_dir.resolve() if docs_dir else None
        self.variables = {str(k): _text(v) for k, v in (variables or {}).items()}
        self._pages: dict[Path, str] = {}
        self._issues: dict[tuple, ContentIssue] = {}

    @property
    def issues(self) -> list[ContentIssue]:
        return list(self._issues.values())

    def errors(self) -> list[str]:
        """The 7008 and 7016 findings as ``file:line: message`` (they fail ``aiui build``)."""
        return [f"{i.file}:{i.line}: {i.message}" for i in self.issues if i.code in (7008, 7016)]

    def read(self, path: Path) -> str:
        """``path``'s text; a page in the docs folder comes back expanded (cached per build)."""
        resolved = path.resolve()
        if self.docs_dir is None or not resolved.is_relative_to(self.docs_dir):
            return path.read_text(encoding="utf-8")
        if resolved not in self._pages:
            self._pages[resolved] = self._expand(path.read_text(encoding="utf-8"), resolved, (resolved,))
        return self._pages[resolved]

    def _issue(self, code: int, file: Path, line: int, message: str, hint: str) -> None:
        try:
            shown = file.relative_to(self.root).as_posix()
        except ValueError:
            shown = file.as_posix()
        issue = ContentIssue(code, shown, line, message, hint)
        self._issues.setdefault((code, shown, line, message), issue)

    def _expand(self, text: str, file: Path, stack: tuple[Path, ...]) -> str:
        """``text`` (the file ``file``) with variables substituted, then snippets put in place."""
        segments = list(_prose_segments(text))
        imports = {m.group(1): m.group(3) for code, chunk in segments if not code for m in _IMPORT.finditer(chunk)}
        out, line = [], 1
        for code, chunk in segments:
            expanded = self._substitute(chunk, file, line, code)
            out.append(expanded if code else self._includes(expanded, file, line, stack, imports))
            line += chunk.count("\n")
        return "".join(out)

    def _substitute(self, chunk: str, file: Path, first_line: int, code: bool) -> str:
        spans = [] if code else [m.span() for m in _CODE_SPAN.finditer(chunk)]

        def value(m: re.Match[str]) -> str:
            if m.group(1):  # \{{name}}: literal
                return m.group(0)[1:]
            found = self.variables.get(m.group(2))
            if found is not None:
                return found
            if not code and not any(a <= m.start() < b for a, b in spans):
                known = ", ".join(sorted(self.variables)) or "none yet"
                self._issue(7007, file, first_line + chunk.count("\n", 0, m.start()),
                            f"unknown variable {{{{{m.group(2)}}}}} is shown as written",
                            f"Add it under variables: in aiui.yaml (defined: {known}), or write \\{{{{{m.group(2)}}}}}")
            return m.group(0)

        return _VAR.sub(value, chunk)

    def _includes(self, chunk: str, file: Path, first_line: int, stack: tuple[Path, ...], imports: dict) -> str:
        def at(m: re.Match[str]) -> tuple[int, str]:
            start = chunk.rfind("\n", 0, m.start()) + 1
            prefix = chunk[start:m.start()]
            return first_line + chunk.count("\n", 0, m.start()), prefix if not prefix.strip() else ""

        def tag(m: re.Match[str]) -> str:
            name, props = m.group(1), {a.group(1): next((g for g in a.groups()[1:] if g is not None), "true")
                                       for a in _ATTR.finditer(m.group(2))}
            target = props.pop("file", None) if name == "Snippet" else imports.get(name)
            if target is None:
                return m.group(0)
            return self._include(m.group(0), target, props, file, *at(m), stack)

        def mkdocs(m: re.Match[str]) -> str:
            indent = m.group(1)
            return indent + self._include(m.group(2), m.group(4), {}, file, at(m)[0], indent, stack)

        refs: list[str] = []  # API references go in last, so their text is never read as snippet tags

        def reference(m: re.Match[str]) -> str:
            refs.append(self._reference(m, file, at(m)[0]))
            return f"\0{len(refs) - 1}\0"

        chunk = DIRECTIVE.sub(reference, chunk)
        chunk = _IMPORT.sub(lambda m: "\n" if m.group(0).endswith("\n") else "", chunk) if imports else chunk
        chunk = _MKDOCS.sub(mkdocs, _TAG.sub(tag, chunk))
        return re.sub(r"\0(\d+)\0", lambda m: refs[int(m.group(1))], chunk) if refs else chunk

    def _reference(self, m: re.Match[str], file: Path, line: int) -> str:
        """The Markdown for one ``::: target`` block, or the block as written (and 7016)."""
        try:
            return self.python.markdown(m.group(1), options(m.group(2)))
        except (ApiReferenceError, OSError) as e:
            self._issue(7016, file, line, f"'::: {m.group(1)}': {e}",
                        "Name a module below content.docs.reference.paths (default src, then the project folder), "
                        "then a class or function in it")
            return m.group(0)

    def _include(self, written: str, target: str, props: dict, file: Path, line: int, indent: str,
                 stack: tuple[Path, ...]) -> str:
        path, outside = self._resolve(target.strip(), file)
        if path is None:
            message = (f"snippet '{target}' is outside the project folder" if outside
                       else f"snippet '{target}' not found")
            self._issue(7008, file, line, message, _HINT_PATH)
            return written
        if path in stack:
            chain = " -> ".join(p.name for p in (*stack[stack.index(path):], path))
            self._issue(7008, file, line, f"snippet '{target}' includes itself ({chain})",
                        "Remove the reference that closes the loop")
            return written
        body = path.read_text(encoding="utf-8")
        for name, value in props.items():  # MDX props: {name} in the snippet (not {{name}})
            body = re.sub(rf"(?<![{{\\]){{{re.escape(name)}}}(?!}})", lambda _m, v=value: v, body)
        body = self._expand(body, path, (*stack, path)).strip("\n")
        return "\n".join(s if i == 0 or not s else indent + s for i, s in enumerate(body.split("\n")))

    def _resolve(self, target: str, file: Path) -> tuple[Path | None, bool]:
        """The snippet file and whether a candidate was refused for being outside the project."""
        docs = self.docs_dir or self.root
        if target.startswith("/"):
            bases, target = [docs], target.lstrip("/")
        else:
            bases = [file.parent, docs / "snippets", docs, self.root]
        outside = False
        for base in bases:
            path = (base / target).resolve()
            if not (path.is_relative_to(self.root) or path.is_relative_to(docs)):
                outside = True
            elif path.is_file():
                return path, False
        return None, outside
