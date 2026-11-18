"""Read ``aiui.yaml``: ``$ref`` includes, and the JSON Schema for editors.

Config splitting: any mapping with a ``$ref`` key is replaced by the YAML (or
JSON) file it names, relative to the file that names it::

    navigation:
      $ref: ./nav.yaml

Keys next to ``$ref`` are merged over the included mapping. Included files may
include others. A path must stay inside the folder of the root config, and a
file that includes itself (directly or through others) is an error. Errors
name the file and line of the ``$ref``; YAML syntax errors in an included file
name that file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

REF = "$ref"
SCHEMA_URL = "https://ui.praison.ai/aiui.schema.json"
_LINE = object()  # hidden key on a $ref mapping: its line in the file


class ConfigLoadError(ValueError):
    """A ``$ref`` that cannot be followed, located at ``file:line``."""

    def __init__(self, message: str, file: str, line: int | None = None):
        super().__init__(f"{file}:{line}: {message}" if line else f"{file}: {message}")
        self.file, self.line = file, line


class _Loader(yaml.SafeLoader):
    def construct_mapping(self, node: yaml.MappingNode, deep: bool = False) -> dict:
        mapping = super().construct_mapping(node, deep=deep)
        if REF in mapping:
            mapping[_LINE] = node.start_mark.line + 1
        return mapping


def load_config_file(path: Path | str, sources: dict[tuple, str] | None = None) -> Any:
    """The parsed config at ``path`` with every ``$ref`` resolved.

    ``sources``, when given, is filled with ``{key path: included file}`` (the
    file relative to the config folder), so a problem found later can name the
    file it came from (:func:`source_of`).
    """
    path = Path(path).resolve()
    return _load(path, path.parent, (), (), {} if sources is None else sources)


def source_of(loc: tuple, sources: dict[tuple, str]) -> str | None:
    """The included file that ``loc`` (a key path) comes from, or ``None`` (the root file)."""
    for n in range(len(loc), -1, -1):
        if loc[:n] in sources:
            return sources[loc[:n]]
    return None


def _load(path: Path, root: Path, chain: tuple, loc: tuple, sources: dict) -> Any:
    with open(path, encoding="utf-8") as fh:
        data = yaml.load(fh, Loader=_Loader)  # noqa: S506 - a SafeLoader subclass
    return _resolve(data, path, root, (*chain, path), loc, sources)


def _shown(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def _resolve(value: Any, path: Path, root: Path, chain: tuple, loc: tuple, sources: dict) -> Any:
    if isinstance(value, list):
        return [_resolve(v, path, root, chain, (*loc, i), sources) for i, v in enumerate(value)]
    if not isinstance(value, dict):
        return value
    line = value.pop(_LINE, None)
    out = {k: _resolve(v, path, root, chain, (*loc, k), sources) for k, v in value.items() if k != REF}
    if REF not in value:
        return out
    ref, here = value[REF], _shown(path, root)
    if not isinstance(ref, str) or not ref.strip():
        raise ConfigLoadError("$ref must be a file path, such as ./nav.yaml", here, line)
    target = (path.parent / ref.strip()).resolve()
    if not target.is_relative_to(root):
        raise ConfigLoadError(f"$ref '{ref}' points outside the project folder", here, line)
    if target in chain:
        cycle = " -> ".join(_shown(p, root) for p in (*chain[chain.index(target):], target))
        raise ConfigLoadError(f"$ref cycle: {cycle}", here, line)
    if not target.is_file():
        raise ConfigLoadError(f"$ref '{ref}' not found (looked for {_shown(target, root)})", here, line)
    sources[loc] = _shown(target, root)
    loaded = _load(target, root, chain, loc, sources)
    if not out:
        return loaded
    if not isinstance(loaded, dict):
        raise ConfigLoadError(f"$ref '{ref}' has keys next to it, so {ref} must hold a mapping", here, line)
    return {**loaded, **out}


def config_json_schema() -> dict[str, Any]:
    """JSON Schema of ``aiui.yaml`` (``aiui schema``), generated from ``Config``."""
    from praisonaiui.schema.models import Config

    schema = Config.model_json_schema(by_alias=True)
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": SCHEMA_URL, **schema}
