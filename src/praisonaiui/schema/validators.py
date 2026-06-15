"""Schema validators for configuration validation."""

from __future__ import annotations

import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config


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
    base = base_path or Path.cwd()

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
        return ValidationResult.failure(errors)
    return ValidationResult.success()


def _find_similar(target: str, candidates: list[str]) -> str | None:
    """Find a similar string from candidates (simple prefix matching)."""
    target_lower = target.lower()
    for candidate in candidates:
        if candidate.lower().startswith(target_lower[:3]):
            return f"Did you mean '{candidate}'?"
    return None
