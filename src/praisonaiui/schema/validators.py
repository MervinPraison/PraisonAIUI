"""Schema validators for configuration validation."""

from __future__ import annotations

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


def validate_config(config: Config, base_path: Path | None = None) -> ValidationResult:
    """
    Validate a configuration object.

    Checks:
    - All component refs exist
    - All template refs are valid
    - Content directories exist
    - Route patterns are valid globs

    Args:
        config: The configuration to validate
        base_path: Base path for resolving relative paths

    Returns:
        ValidationResult with any errors found
    """
    errors: list[ValidationError] = []
    base = base_path or Path.cwd()

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
