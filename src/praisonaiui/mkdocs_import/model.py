"""Data the MkDocs importer passes between handlers.

Handlers only see these types. They do not touch the compiler, the CLI, or
the docs renderer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Optional

FindingLevel = Literal["transferred", "dropped", "note"]


@dataclass(frozen=True)
class Finding:
    """One thing the conversion kept, dropped, or wants a person to notice."""

    level: FindingLevel
    code: str
    message: str


@dataclass
class NavEntry:
    """One MkDocs nav node. A leaf has ``slug``; a section has ``children``."""

    title: str
    slug: Optional[str] = None
    children: list["NavEntry"] = field(default_factory=list)


@dataclass
class GroupDraft:
    """One sidebar group inside a docs tab."""

    group: str
    pages: list[str] = field(default_factory=list)
    prefix: Optional[str] = None


@dataclass
class TabDraft:
    """One top-level docs tab."""

    tab: str
    groups: list[GroupDraft] = field(default_factory=list)


@dataclass
class AiuiDraft:
    """Mutable PraisonAI UI config the handlers fill in.

    ``overlay`` is merged on top of the generated document. Use it from an
    extra handler when you need a key this module does not know about.
    Unknown keys are left in the file; ``aiui build`` ignores them.
    """

    site_title: str = "Docs"
    site_description: Optional[str] = None
    site_url: Optional[str] = None
    repo_url: Optional[str] = None
    copyright: Optional[str] = None
    docs_dir: str = "docs"
    exclude: list[str] = field(default_factory=list)
    preset: str = "paper"
    mode: Optional[str] = "system"
    dark_mode: bool = True
    tabs: list[TabDraft] = field(default_factory=list)
    search_enabled: bool = True
    socials: dict[str, str] = field(default_factory=dict)
    overlay: dict[str, Any] = field(default_factory=dict)


@dataclass
class MkDocsDocument:
    """A parsed ``mkdocs.yml``. ``raw`` is plain data; tags have already been resolved."""

    raw: dict[str, Any]
    source: Optional[Path] = None
    loader_notes: list[str] = field(default_factory=list)


@dataclass
class ConversionResult:
    """Output of one conversion. ``ok`` is false when the result is not a valid AIUI config."""

    ok: bool
    yaml_text: str
    data: dict[str, Any]
    draft: AiuiDraft
    findings: list[Finding]
    error: Optional[str] = None

    @property
    def page_count(self) -> int:
        return sum(len(group.pages) for tab in self.draft.tabs for group in tab.groups)

    def dropped(self) -> list[Finding]:
        return [item for item in self.findings if item.level == "dropped"]


class ConversionError(Exception):
    """The MkDocs file could not be read as a config mapping."""
