"""Docs chrome config: navbar links with icons, footer socials and columns, the banner."""

from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from praisonaiui.compiler.compiler import Compiler
from praisonaiui.schema.models import Config


def _ui_config(tmp_path: Path, **extra) -> dict:
    config = Config.model_validate({"site": {"title": "Site"}, **extra})
    return Compiler(config, base_path=tmp_path)._generate_ui_config()


def test_navbar_links_carry_icon_and_type(tmp_path: Path):
    ui = _ui_config(
        tmp_path,
        navbar={
            "links": [
                {"label": "Blog", "href": "/blog", "icon": "newspaper"},
                {"type": "github", "href": "https://github.com/acme/repo"},
            ],
            "primary": {"type": "github", "href": "https://github.com/acme/repo"},
        },
    )
    assert ui["navbar"]["links"] == [
        {"label": "Blog", "href": "/blog", "icon": "newspaper"},
        {"href": "https://github.com/acme/repo", "type": "github"},
    ]
    assert ui["navbar"]["primary"] == {"type": "github", "href": "https://github.com/acme/repo"}
    plain = _ui_config(tmp_path, navbar={"primary": {"label": "Sign up", "href": "/signup"}})
    assert plain["navbar"]["primary"] == {"type": "button", "label": "Sign up", "href": "/signup"}


def test_invalid_chrome_config_is_refused():
    with pytest.raises(ValidationError, match="needs a label"):
        Config.model_validate({"site": {"title": "S"}, "navbar": {"links": [{"href": "/x"}]}})
    with pytest.raises(ValidationError):
        Config.model_validate({"site": {"title": "S"}, "banner": {"content": "x", "type": "loud"}})


def test_footer_socials_and_headerless_column(tmp_path: Path):
    ui = _ui_config(
        tmp_path,
        footer={
            "socials": {"bluesky": "https://bsky.app/profile/acme", "community": "https://discord.gg/acme"},
            "links": [{"items": [{"label": "Status", "href": "https://status.acme.dev"}]}],
        },
    )
    assert ui["footer"]["socials"]["bluesky"] == "https://bsky.app/profile/acme"
    assert ui["footer"]["links"] == [{"items": [{"label": "Status", "href": "https://status.acme.dev"}]}]


def test_banner_short_form_and_defaults(tmp_path: Path):
    ui = _ui_config(tmp_path, banner="Version 2 is out. [Read more](/changelog)")
    banner = ui["banner"]
    assert banner == {"content": "Version 2 is out. [Read more](/changelog)", "dismissible": False, "type": "info", "id": banner["id"]}
    assert len(banner["id"]) == 12
    assert not {"navbar", "footer", "banner"} & _ui_config(tmp_path).keys()


def test_banner_id_follows_its_content(tmp_path: Path):
    def banner(content: str) -> dict:
        return _ui_config(tmp_path, banner={"content": content, "dismissible": True, "type": "warning"})["banner"]

    first = banner("Maintenance tonight")
    assert first["id"] == banner("Maintenance tonight")["id"] != banner("Maintenance tomorrow")["id"]
    assert first["dismissible"] is True and first["type"] == "warning"
