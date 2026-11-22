"""Convert one MkDocs config into a PraisonAI UI docs config.

Nothing in this module is imported by the compiler or the main CLI. Call
``convert_mkdocs`` yourself, or run ``python -m praisonaiui.mkdocs_import``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Union

from praisonaiui.mkdocs_import.emit import render_yaml
from praisonaiui.mkdocs_import.loader import load_mkdocs_text
from praisonaiui.mkdocs_import.model import (
    AiuiDraft,
    ConversionError,
    ConversionResult,
    Finding,
    MkDocsDocument,
)
from praisonaiui.mkdocs_import.registry import HandlerRegistry, get_registry

PathLike = Union[str, Path]


def convert_mkdocs(
    source: PathLike,
    *,
    registry: Optional[HandlerRegistry] = None,
) -> ConversionResult:
    """Read ``source`` and return the AIUI config. Does not write a file."""
    path = Path(source)
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ConversionError(f"Could not read {path}: {exc}") from exc
    return convert_mkdocs_text(text, source=path, registry=registry)


def convert_mkdocs_text(
    text: str,
    *,
    source: Optional[Path] = None,
    registry: Optional[HandlerRegistry] = None,
) -> ConversionResult:
    """Convert MkDocs YAML text. ``source`` is only used to name the file in comments."""
    raw, notes = load_mkdocs_text(text)
    document = MkDocsDocument(raw=raw, source=source, loader_notes=list(notes))
    draft = AiuiDraft()
    findings: list[Finding] = []

    active = registry if registry is not None else get_registry()
    for handler in active.handlers():
        handler.apply(document, draft, findings)

    source_name = source.name if source else "mkdocs.yml"
    yaml_text, data = render_yaml(draft, findings, source_name=source_name)
    error = _validate(data)
    return ConversionResult(
        ok=error is None,
        yaml_text=yaml_text,
        data=data,
        draft=draft,
        findings=findings,
        error=error,
    )


def _validate(data: dict) -> Optional[str]:
    """Confirm the document matches the existing config schema. Does not compile it."""
    from praisonaiui.schema.models import Config

    try:
        Config.model_validate(data)
    except Exception as exc:  # noqa: BLE001 - return the schema error to the caller
        return str(exc)
    return None
