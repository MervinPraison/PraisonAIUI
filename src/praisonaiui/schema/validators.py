"""Schema validators for configuration validation."""

from __future__ import annotations

import re
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config

# shadcn variables that used to take bare HSL triples ("221 83% 53%") and were
# wrapped in hsl() by the stylesheet. Since the token layer (ADR-0001 §7) they
# hold full colours and are consumed as var(--x), so a bare triple is an
# invalid colour.
LEGACY_HSL_VARS: tuple[str, ...] = (
    "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
    "primary", "primary-foreground", "secondary", "secondary-foreground", "muted",
    "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground",
    "border", "input", "ring", "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
    "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
    "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
)

_LEGACY_HSL_DECL = re.compile(
    r"(?:^|[;{\s])--(" + "|".join(re.escape(n) for n in LEGACY_HSL_VARS) + r")\s*:\s*"
    r"-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%(?:\s*/\s*[\d.]+%?)?\s*(?:!important)?\s*(?=;|}|$)",
    re.MULTILINE,
)


def find_legacy_hsl_vars(css: str | None) -> list[str]:
    """Return the shadcn variables that ``css`` sets to a bare HSL triple.

    ``--primary: 221 83% 53%`` was the pre-token-layer format. It is no longer
    a valid colour; write ``--primary: hsl(221 83% 53%)`` (or any CSS colour),
    or better, set the seed (``--seed-accent: #2563eb``) so derived tokens
    follow. The React UI rewrites such CSS at runtime where it can.
    """
    if not css:
        return []
    seen: list[str] = []
    for match in _LEGACY_HSL_DECL.finditer(css):
        name = f"--{match.group(1)}"
        if name not in seen:
            seen.append(name)
    return seen


def legacy_hsl_warning(css: str | None, source: str = "custom_css") -> str | None:
    """A human-readable warning for :func:`find_legacy_hsl_vars`, or ``None``."""
    names = find_legacy_hsl_vars(css)
    if not names:
        return None
    return (
        f"{source} sets {', '.join(names)} to a bare HSL triple (e.g. '221 83% 53%'). "
        "Theme variables are full colours now: wrap the value as hsl(221 83% 53%), "
        "or set a seed such as --seed-accent instead. "
        "See docs/features/react-shell.md#breaking-change-bare-hsl-triples."
    )


def find_unknown_keys(model: type, data: Any, loc: tuple = ()) -> list[tuple]:
    """Key paths in *data* that no field of *model* (or its nested models) takes.

    Loading stays lenient (unknown keys are ignored, so a misspelling such
    as ``stlye:`` silently does nothing); this reports them. A model that
    declares ``extra="allow"`` accepts any key at its level. Works on every
    pydantic 2 release (``model_validate(extra=...)`` is 2.12+ and would
    also override ``extra="allow"``).
    """
    from pydantic import BaseModel

    if not (isinstance(model, type) and issubclass(model, BaseModel)) or not isinstance(data, dict):
        return []
    fields = model.model_fields
    by_key: dict[str, Any] = {}
    for name, info in fields.items():
        by_key[name] = info.annotation
        if info.alias:
            by_key[info.alias] = info.annotation
    allows_extra = model.model_config.get("extra") == "allow"
    found: list[tuple] = []
    for key, value in data.items():
        if key not in by_key:
            if not allows_extra:
                found.append((*loc, key))
            continue
        found.extend(_unknown_in_annotation(by_key[key], value, (*loc, key)))
    return found


def _unknown_in_annotation(annotation: Any, value: Any, loc: tuple) -> list[tuple]:
    import typing

    from pydantic import BaseModel

    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return find_unknown_keys(annotation, value, loc)
    origin = typing.get_origin(annotation)
    args = typing.get_args(annotation)
    if origin in (list, tuple, set, frozenset) and args and isinstance(value, (list, tuple)):
        out: list[tuple] = []
        for i, item in enumerate(value):
            out.extend(_unknown_in_annotation(args[0], item, (*loc, i)))
        return out
    if origin is dict and len(args) == 2 and isinstance(value, dict):
        out = []
        for k, item in value.items():
            out.extend(_unknown_in_annotation(args[1], item, (*loc, k)))
        return out
    if args and origin not in (dict, list, tuple, set, frozenset):
        # Optional[X] / Union[A, B]: the model member that fits the value best.
        candidates = [
            a for a in args if isinstance(a, type) and issubclass(a, BaseModel)
        ]
        if candidates and isinstance(value, dict):
            return min(
                (find_unknown_keys(c, value, loc) for c in candidates), key=len
            )
        for a in args:
            if typing.get_origin(a) in (list, dict, tuple, set, frozenset):
                return _unknown_in_annotation(a, value, loc)
    return []


@dataclass
class ValidationError:
    """A single validation error."""

    code: int
    category: str
    message: str
    file: str | None = None
    line: int | None = None
    column: int | None = None
    suggestion: str | None = None


@dataclass
class ValidationResult:
    """Result of configuration validation."""

    valid: bool
    errors: list[ValidationError]
    # Non-fatal findings (they never make ``valid`` False).
    warnings: list[ValidationError] = field(default_factory=list)
    # {source: ApiSpec} (praisonaiui.compiler.openapi), loaded once; the compiler reuses them.
    api_specs: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def success(cls) -> "ValidationResult":
        """Create a successful validation result."""
        return cls(valid=True, errors=[])

    @classmethod
    def failure(cls, errors: list[ValidationError]) -> "ValidationResult":
        """Create a failed validation result."""
        return cls(valid=False, errors=errors)


def validate_config(config: Config, base_path: Path | None = None, strict: bool = False) -> ValidationResult:
    """
    Validate a configuration object.

    Checks:
    - All component refs exist
    - All template refs are valid
    - Content directories exist
    - Route patterns are valid globs
    - Detect orphaned components (defined but not referenced)
    - Feature implementation status (if strict=True)

    Args:
        config: The configuration to validate
        base_path: Base path for resolving relative paths
        strict: If True, warns about unimplemented/experimental features

    Returns:
        ValidationResult with any errors found
    """
    errors: list[ValidationError] = []
    found_warnings: list[ValidationError] = []
    base = base_path or Path.cwd()

    # Legacy HSL-triple theme variables in site.custom_css (warning only)
    custom_css = getattr(getattr(config, "site", None), "custom_css", None)
    css_warning = legacy_hsl_warning(custom_css, "site.custom_css")
    if css_warning:
        found_warnings.append(
            ValidationError(
                code=5001,
                category="theme",
                message=css_warning,
                suggestion="Replace '--primary: 221 83% 53%' with '--seed-accent: hsl(221 83% 53%)'",
            )
        )
        warnings.warn(css_warning, UserWarning, stacklevel=2)

    found_warnings.extend(layout_warnings(config))
    search = getattr(config, "search", None)
    if search is not None and "provider" in search.model_fields_set:
        found_warnings.append(
            ValidationError(
                code=5201,
                category="search",
                message=f"search.provider '{search.provider}' is ignored: the built-in search index is always used",
                suggestion="Remove search.provider; tune search with search.prompt and search.maxResults",
            )
        )
    api_specs = _check_api_specs(config, base, errors, found_warnings)
    nav_issues = nav_warnings(config, base)
    (errors if strict else found_warnings).extend(i for i in nav_issues if i.code == 2101)
    found_warnings.extend(i for i in nav_issues if i.code != 2101)

    # Track component usage
    used_components = set()

    # Validate component references in templates
    for template_name, template in config.templates.items():
        for slot_name, slot in template.slots.items():
            if slot is None:
                continue
            if slot.ref and slot.ref not in config.components:
                errors.append(
                    ValidationError(
                        code=2001,
                        category="validation",
                        message=f"Component reference '{slot.ref}' not found",
                        suggestion=_find_similar(slot.ref, list(config.components.keys())),
                    )
                )
            elif slot.ref:
                used_components.add(slot.ref)

        # Check zone widget references to components
        if template.zones:
            zones_data = template.zones.model_dump(by_alias=True, exclude_none=True)
            for zone_name, widgets in zones_data.items():
                if widgets:
                    for widget in widgets:
                        widget_type = widget.get("type")
                        # Check if widget type matches a component type
                        if widget_type:
                            for comp_name, comp in config.components.items():
                                if comp.type == widget_type:
                                    used_components.add(comp_name)

    # Validate route template references
    for route in config.routes:
        if route.template not in config.templates:
            errors.append(
                ValidationError(
                    code=2002,
                    category="validation",
                    message=f"Template '{route.template}' not found in route '{route.match}'",
                    suggestion=_find_similar(route.template, list(config.templates.keys())),
                )
            )

    # Validate content directories exist
    if config.content:
        if config.content.docs and not (base / config.content.docs.dir).exists():
            errors.append(
                ValidationError(
                    code=3001,
                    category="scanner",
                    message=f"Docs directory '{config.content.docs.dir}' not found",
                )
            )
        if config.content.blog and not (base / config.content.blog.dir).exists():
            errors.append(
                ValidationError(
                    code=3002,
                    category="scanner",
                    message=f"Blog directory '{config.content.blog.dir}' not found",
                )
            )

    # Check for orphaned components (defined but never referenced)
    # Components that can be auto-wired by CompositionResolver for FlexibleLayout
    auto_wireable_components = {"sidebar", "header", "footer"}

    for component_name in config.components:
        if component_name not in used_components:
            # Check if component can be auto-wired to FlexibleLayout zones
            can_be_auto_wired = False
            if component_name in auto_wireable_components:
                for template in config.templates.values():
                    if template.layout == "FlexibleLayout":
                        can_be_auto_wired = True
                        break

            if not can_be_auto_wired:
                errors.append(
                    ValidationError(
                        code=2003,
                        category="validation",
                        message=f"Component '{component_name}' is defined but never referenced in templates",
                        suggestion="Either remove the component or add it to a template slot/zone",
                    )
                )

    # Validate feature implementation status
    if strict:
        from praisonaiui.schema.features import get_feature_registry

        registry = get_feature_registry()
        experimental_fields = registry.get_experimental_fields(config)

        for field in experimental_fields:
            feature = registry.get_feature(field)
            if feature:
                errors.append(
                    ValidationError(
                        code=4001,
                        category="features",
                        message=f"Field '{field}' is experimental and not fully implemented: {feature.description}",
                        suggestion="Remove this field or run validation without the --strict flag",
                    )
                )
                # Also emit runtime warning
                warnings.warn(
                    f"Config field '{field}' is experimental: {feature.description}",
                    UserWarning,
                    stacklevel=2
                )

    if errors:
        result = ValidationResult.failure(errors)
    else:
        result = ValidationResult.success()
    result.warnings = found_warnings
    result.api_specs = api_specs
    return result


def _check_api_specs(config: Any, base: Path, errors: list, found: list) -> dict[str, Any]:
    """Load every OpenAPI spec the config names; report its issues as file:line."""
    from praisonaiui.compiler.openapi import load_config_specs

    specs = load_config_specs(config, base) if hasattr(config, "api") else {}
    for issue in (i for spec in specs.values() for i in spec.issues):
        error = issue.severity == "error"
        (errors if error else found).append(ValidationError(
            code=6001 if error else 6002, category="openapi", file=issue.file, line=issue.line,
            message=str(issue).replace(f"{base.resolve()}/", "")))
    return specs


def builtin_layout_ids() -> list[str]:
    """Ids of the layouts that ship with PraisonAIUI (catalog records)."""
    from praisonaiui.builtin.catalog import BUILTIN_PLUGINS

    return [spec.id for plugin in BUILTIN_PLUGINS for spec in plugin.layouts()]


def layout_warnings(config: Any) -> list[ValidationError]:
    """Warnings for YAML ``layout:`` selection (ADR 0003).

    5101: an id that is not a built-in layout (a plugin may still provide
    it; plugin layouts are only known once the server runs).
    5102: a layout chosen while the style is not ``app`` (it is ignored).
    5103: a malformed entry (a bad id, a string where a list goes); the
    server ignores it.
    """
    layout = getattr(config, "layout", None)
    if layout is None:
        return []
    out: list[ValidationError] = [
        ValidationError(
            code=5103,
            category="layout",
            message=f"layout.{key} ignored: {reason}",
            suggestion="Layout ids use a-z, 0-9 and -, start with a letter; lists are YAML lists",
        )
        for key, reason in layout.rejected.items()
    ]
    chosen = [layout.default] if layout.default else []
    chosen += list(layout.available or [])
    if not chosen:
        return out
    known = builtin_layout_ids()
    for lid in dict.fromkeys(chosen):
        if lid != "classic" and lid not in known:
            out.append(
                ValidationError(
                    code=5101,
                    category="layout",
                    message=f"Layout '{lid}' is not a built-in layout; it must come from an installed plugin",
                    suggestion=_find_similar(lid, known) or f"Built-in layouts: {', '.join(known)}",
                )
            )
    style = getattr(config, "style", None)
    if style != "app":
        out.append(
            ValidationError(
                code=5102,
                category="layout",
                message=f"layout ignored: style is '{style}'; layouts need style: app",
                suggestion="Set 'style: app', or remove layout.default and layout.available",
            )
        )
    return out


# Keys the schema accepts that nothing reads yet: validate says so rather than
# silently ignoring them. {(section, field): why}
_IGNORED_KEYS = {
    ("content.docs.nav", "max_depth"): "the generated sidebar nests one folder level; "
    "list deeper trees with nested groups in navigation.groups",
    ("i18n", "fallback_locale"): "no translated pages are built yet",
    ("i18n", "translations_dir"): "no translated pages are built yet",
}


def nav_warnings(config: Any, base: Path) -> list[ValidationError]:
    """Sidebar config problems: a listed page that matches no docs page (2101,
    an error under --strict) and accepted keys that have no effect (1004)."""
    import difflib

    from praisonaiui.compiler.docs_scanner import DocsScanner
    from praisonaiui.compiler.nav_builder import NavBuilder

    out: list[ValidationError] = []
    docs = config.content.docs if getattr(config, "content", None) else None
    sections = {"content.docs.nav": docs.nav if docs else None, "i18n": getattr(config, "i18n", None)}
    for (section, name), why in _IGNORED_KEYS.items():
        model = sections[section]
        if model is not None and name in model.model_fields_set:
            alias = type(model).model_fields[name].alias or name
            out.append(ValidationError(1004, "navigation" if section.endswith("nav") else "i18n",
                                       f"{section}.{alias} is accepted but has no effect: {why}"))
    nav = getattr(config, "navigation", None)
    for d, _ in nav.divisions() if nav else []:
        if not (d.href or getattr(d, "url", None) or d.pages or d.groups or d.children()):
            kind = type(d).__name__.removeprefix("Nav").removesuffix("Config").removesuffix("Item").lower()
            out.append(ValidationError(2102, "navigation", f"navigation {kind} '{d.label}' has no pages, groups or href",
                                       suggestion="Give it groups or pages to open, or an href to link to"))
    docs_dir = base / docs.dir if docs else None
    if not nav or docs_dir is None or not docs_dir.is_dir():
        return out
    entries = [*nav.pages, *nav.groups, *(g for d, _ in nav.divisions() for g in d.sidebar_groups())]
    if not entries:
        return out
    scanner = DocsScanner(docs_dir, include=docs.include, exclude=docs.exclude, index_files=docs.index_files)
    builder = NavBuilder(scanner.scan(), base_path=config.site.route_base_docs)
    builder.to_dict_grouped(entries, docs_dir=docs_dir)
    slugs = [p.slug for p in builder.pages]
    from praisonaiui.compiler.openapi import endpoint_ref

    for name in (n for n in dict.fromkeys(builder.unresolved) if not endpoint_ref(n)):  # endpoints: 7012
        close = difflib.get_close_matches(name.strip("/").removesuffix(".md"), slugs, n=1)
        out.append(ValidationError(
            2101, "navigation", f"navigation lists '{name}', but no docs page has that name (left out of the sidebar)",
            suggestion=f"Did you mean '{close[0]}'?" if close else "Name a page by its URL path under the docs base"))
    return out


def _find_similar(target: str, candidates: list[str]) -> str | None:
    """Find a similar string from candidates (simple prefix matching)."""
    target_lower = target.lower()
    for candidate in candidates:
        if candidate.lower().startswith(target_lower[:3]):
            return f"Did you mean '{candidate}'?"
    return None
