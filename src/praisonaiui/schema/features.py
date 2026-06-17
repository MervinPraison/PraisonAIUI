"""Feature registry for config validation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from praisonaiui.schema.models import Config


class FeatureStatus(Enum):
    """Status of a configuration feature."""

    IMPLEMENTED = "implemented"
    EXPERIMENTAL = "experimental"
    DEPRECATED = "deprecated"


@dataclass
class FeatureInfo:
    """Information about a configuration feature."""

    name: str
    status: FeatureStatus
    since: str | None = None
    description: str | None = None


class ConfigFeatureRegistry:
    """Registry of configuration features and their implementation status."""

    def __init__(self):
        self._features = {
            # Core features - fully implemented
            "site": FeatureInfo("site", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "components": FeatureInfo("components", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "templates": FeatureInfo("templates", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "routes": FeatureInfo("routes", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "content": FeatureInfo("content", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "style": FeatureInfo("style", FeatureStatus.IMPLEMENTED, "0.1.0"),
            "layout": FeatureInfo("layout", FeatureStatus.IMPLEMENTED, "0.2.0"),
            "chat": FeatureInfo("chat", FeatureStatus.IMPLEMENTED, "0.2.0"),
            "auth": FeatureInfo("auth", FeatureStatus.IMPLEMENTED, "0.3.0"),
            "widgets": FeatureInfo("widgets", FeatureStatus.IMPLEMENTED, "0.3.0"),
            "dependencies": FeatureInfo("dependencies", FeatureStatus.IMPLEMENTED, "0.3.0"),

            # Mintlify-parity features - implemented
            "logo": FeatureInfo("logo", FeatureStatus.IMPLEMENTED, "0.4.0"),
            "navigation": FeatureInfo("navigation", FeatureStatus.IMPLEMENTED, "0.4.0"),
            "navbar": FeatureInfo("navbar", FeatureStatus.IMPLEMENTED, "0.4.0"),
            "footer": FeatureInfo("footer", FeatureStatus.IMPLEMENTED, "0.4.0"),
            "search": FeatureInfo("search", FeatureStatus.IMPLEMENTED, "0.4.0"),
            "dashboard": FeatureInfo("dashboard", FeatureStatus.IMPLEMENTED, "0.4.0"),

            # Enterprise features - partial implementation
            "seo": FeatureInfo("seo", FeatureStatus.IMPLEMENTED, "0.5.0",
                             "SEO configuration with title templates, OG tags, Twitter meta - basic implementation"),
            "a11y": FeatureInfo("a11y", FeatureStatus.IMPLEMENTED, "0.5.0",
                               "Accessibility configuration - basic implementation for skip links and ARIA labels"),
            "i18n": FeatureInfo("i18n", FeatureStatus.IMPLEMENTED, "0.5.0",
                               "Internationalization configuration with multi-language support"),
        }

    def get_feature(self, name: str) -> FeatureInfo | None:
        """Get information about a feature."""
        return self._features.get(name)

    def is_implemented(self, name: str) -> bool:
        """Check if a feature is fully implemented."""
        feature = self._features.get(name)
        return feature is not None and feature.status == FeatureStatus.IMPLEMENTED

    def is_experimental(self, name: str) -> bool:
        """Check if a feature is experimental."""
        feature = self._features.get(name)
        return feature is not None and feature.status == FeatureStatus.EXPERIMENTAL

    def get_unimplemented_fields(self, config: Config) -> list[str]:
        """Get list of config fields that are not fully implemented."""
        unimplemented = []

        # Check top-level config fields
        config_dict = config.model_dump(exclude_none=True)
        for field_name in config_dict:
            if field_name in ("schema_version", "schemaVersion"):
                continue
            if not self.is_implemented(field_name):
                unimplemented.append(field_name)

        return unimplemented

    def get_experimental_fields(self, config: Config) -> list[str]:
        """Get list of config fields that are experimental."""
        experimental = []

        config_dict = config.model_dump(exclude_none=True)
        for field_name in config_dict:
            if self.is_experimental(field_name):
                experimental.append(field_name)

        return experimental


# Global registry instance
_registry = ConfigFeatureRegistry()


def get_feature_registry() -> ConfigFeatureRegistry:
    """Get the global feature registry."""
    return _registry
