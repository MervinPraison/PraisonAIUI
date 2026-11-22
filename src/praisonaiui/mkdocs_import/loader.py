"""Read ``mkdocs.yml`` without executing its YAML tags.

MkDocs files often contain ``!ENV`` and ``!!python/name`` tags. Those are
recorded and replaced with plain values so conversion never imports MkDocs
or runs hook code.
"""

from __future__ import annotations

import contextvars
from typing import Any, Optional

import yaml

from praisonaiui.mkdocs_import.model import ConversionError

_notes: contextvars.ContextVar[list[str]] = contextvars.ContextVar("mkdocs_import_loader_notes")


class _MkDocsLoader(yaml.SafeLoader):
    """Safe loader plus the two tags that show up in PraisonAI MkDocs files."""


def _remember(message: str) -> None:
    try:
        _notes.get().append(message)
    except LookupError:
        pass


def _construct_env(loader: _MkDocsLoader, node: yaml.Node) -> Any:
    if isinstance(node, yaml.SequenceNode):
        values = loader.construct_sequence(node)
        fallback = values[-1] if values else None
        _remember(f"!ENV {values!r} resolved to fallback {fallback!r}")
        return fallback
    if isinstance(node, yaml.ScalarNode):
        value = loader.construct_scalar(node)
        _remember(f"!ENV {value} ignored")
        return None
    _remember("!ENV value ignored")
    return None


def _construct_python(loader: _MkDocsLoader, suffix: str, node: yaml.Node) -> None:
    del loader, node
    _remember(f"ignored YAML tag !!python/{suffix}")
    return None


_MkDocsLoader.add_constructor("!ENV", _construct_env)
_MkDocsLoader.add_multi_constructor("tag:yaml.org,2002:python/", _construct_python)


def load_mkdocs_text(text: str) -> tuple[dict[str, Any], list[str]]:
    """Parse MkDocs YAML. Returns ``(mapping, loader notes)``."""
    notes: list[str] = []
    token = _notes.set(notes)
    try:
        data = yaml.load(text, Loader=_MkDocsLoader)  # noqa: S506 - tags are neutralised above
    except yaml.YAMLError as exc:
        raise ConversionError(f"Could not parse MkDocs YAML: {exc}") from exc
    finally:
        _notes.reset(token)

    if data is None:
        return {}, notes
    if not isinstance(data, dict):
        raise ConversionError("MkDocs config must be a mapping")
    return data, notes


def named_entries(value: Any) -> list[tuple[str, Optional[Any]]]:
    """Normalise a MkDocs plugins or extensions list to ``(name, options)`` pairs."""
    if not value:
        return []
    if isinstance(value, dict):
        return [(str(key), item) for key, item in value.items()]
    if not isinstance(value, list):
        return []

    entries: list[tuple[str, Optional[Any]]] = []
    for item in value:
        if isinstance(item, str):
            entries.append((item, None))
        elif isinstance(item, dict):
            for key, options in item.items():
                entries.append((str(key), options))
    return entries
