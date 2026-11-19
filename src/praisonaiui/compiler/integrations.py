"""Analytics, support chat widgets and cookie consent in a docs build (``integrations:``).

Each page gets the settings as a JSON data block (never executed) and :data:`SCRIPT`,
one loader file at the site root (``integrations.js`` beside this module): no inline
script, so a Content-Security-Policy needs only the provider origins, which
:func:`collect` lists per directive for ``Compiler.external_origins()``.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from praisonaiui.compiler.site_assets import origin
from praisonaiui.utils import json_for_html

SCRIPT = "aiui-integrations.js"
CONFIG_ID = "aiui-integrations-config"
SUPPORT = ("intercom", "crisp", "front")  # chat widgets: idle-loaded, kept under Do Not Track

_GOOGLE = {
    "script-src": ["https://*.googletagmanager.com"],
    "connect-src": ["https://*.google-analytics.com", "https://*.analytics.google.com",
                    "https://*.googletagmanager.com"],
    "img-src": ["https://*.google-analytics.com", "https://*.googletagmanager.com"],
}
_MIXPANEL_API = {"us": "https://api-js.mixpanel.com", "eu": "https://api-eu.mixpanel.com",
                 "in": "https://api-in.mixpanel.com"}


def _same(src: str, *directives: str) -> dict[str, list[str]]:
    """``src``'s origin for each directive (script-src and connect-src by default)."""
    return {d: [origin(src)] for d in directives or ("script-src", "connect-src")}


def _posthog(o):
    api = o.api_host.rstrip("/")
    assets = api.replace(".i.posthog.com", "-assets.i.posthog.com")
    return ({"src": f"{assets}/static/array.js", "key": o.api_key, "host": api, "replay": o.session_recording},
            {"script-src": [assets], "connect-src": sorted({api, assets})})


def _mixpanel(o):
    api = _MIXPANEL_API[o.region]
    return ({"src": "https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js", "token": o.project_token, "host": api},
            {"script-src": ["https://cdn.mxpnl.com"], "connect-src": [api]})


_INTERCOM = {
    "script-src": ["https://widget.intercom.io", "https://js.intercomcdn.com"],
    "connect-src": ["https://*.intercom.io", "wss://*.intercom.io", "https://*.intercomcdn.com"],
    "img-src": ["https://*.intercom.io", "https://*.intercomcdn.com"],
    "font-src": ["https://js.intercomcdn.com", "https://fonts.intercomcdn.com"],
    "media-src": ["https://js.intercomcdn.com"], "frame-src": ["https://intercom-sheets.com", "https://*.intercom.io"],
}
_CRISP = {
    **_same("https://client.crisp.chat", "script-src", "style-src", "font-src", "media-src"),
    "connect-src": ["https://client.crisp.chat", "https://storage.crisp.chat", "wss://client.relay.crisp.chat",
                    "wss://stream.relay.crisp.chat"],
    "img-src": ["https://client.crisp.chat", "https://image.crisp.chat", "https://storage.crisp.chat"],
    "frame-src": ["https://game.crisp.chat"],
}
_FRONT = {"script-src": ["https://chat-assets.frontapp.com"],
          "connect-src": ["https://*.frontapp.com", "wss://*.frontapp.com"],
          "img-src": ["https://*.frontapp.com"], "frame-src": ["https://chat.frontapp.com"]}
_FATHOM = "https://cdn.usefathom.com/script.js"
_SEGMENT = "https://cdn.segment.com/analytics.js/v1/{}/analytics.min.js"

#: config key -> (provider settings) -> (what the loader gets, the origins it needs per CSP directive)
PROVIDERS: dict[str, Callable] = {
    "ga4": lambda o: ({"src": f"https://www.googletagmanager.com/gtag/js?id={o.measurement_id}",
                       "id": o.measurement_id}, _GOOGLE),
    "gtm": lambda o: ({"src": f"https://www.googletagmanager.com/gtm.js?id={o.tag_id}"}, _GOOGLE),
    "posthog": _posthog,
    "plausible": lambda o: ({"src": f"{o.server.rstrip('/')}/js/script.js", "domain": o.domain}, _same(o.server)),
    "fathom": lambda o: ({"src": _FATHOM, "site": o.site_id}, _same(_FATHOM, "script-src", "connect-src", "img-src")),
    "umami": lambda o: ({"src": o.src, "website": o.website_id}, _same(o.src)),
    "segment": lambda o: ({"src": _SEGMENT.format(o.key), "key": o.key},
                          {"script-src": ["https://cdn.segment.com"],
                           "connect-src": ["https://api.segment.io", "https://cdn.segment.com"]}),
    "mixpanel": _mixpanel,
    "intercom": lambda o: ({"src": f"https://widget.intercom.io/widget/{o.app_id}", "app": o.app_id}, _INTERCOM),
    "crisp": lambda o: ({"src": "https://client.crisp.chat/l.js", "website": o.website_id}, _CRISP),
    "front": lambda o: ({"src": "https://chat-assets.frontapp.com/v1/chat.bundle.js", "chat": o.chat_id}, _FRONT),
}

# The consent banner: theme tokens only; Decline and Accept look the same.
BANNER_CSS = """
.aiui-consent { position: fixed; z-index: 60; inset-inline: 1rem; bottom: 1rem; margin-inline: auto;
  max-width: 34rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1rem;
  padding: 0.875rem 1rem; border: 1px solid var(--border); border-radius: var(--radius);
  background: var(--card); color: var(--foreground); font-size: 0.875rem; line-height: 1.45;
  box-shadow: 0 8px 24px color-mix(in oklab, var(--foreground) 14%, transparent); }
.aiui-consent p { margin: 0; flex: 1 1 16rem; }
.aiui-consent a { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.aiui-consent-actions { display: flex; gap: 0.5rem; margin-inline-start: auto; }
.aiui-consent button { min-height: 2.25rem; min-width: 5.5rem; padding: 0 1rem; border: 1px solid var(--border);
  border-radius: var(--radius); background: var(--background); color: var(--foreground);
  font: inherit; font-weight: 500; cursor: pointer; }
.aiui-consent button:hover { background: var(--muted); }
.aiui-consent :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
@media print { .aiui-consent { display: none; } }
"""


@dataclass
class Integrations:
    head: str = ""  # before </head>: the settings block and the loader
    css: str = ""  # appended to assets/theme.css: the consent banner
    script: str = ""  # the contents of SCRIPT
    origins: dict[str, list[str]] = field(default_factory=dict)  # CSP directive -> origins


def loader() -> str:
    return Path(__file__).with_name("integrations.js").read_text(encoding="utf-8")


def collect(cfg, url_base: str = "") -> Integrations | None:
    """The tags, CSS and loader for ``cfg`` (an IntegrationsConfig); None when nothing loads."""
    providers: dict[str, dict] = {}
    origins: dict[str, set[str]] = {}
    for name, build in PROVIDERS.items():
        if getattr(cfg, name) is not None:
            providers[name], needs = build(getattr(cfg, name))
            for directive, hosts in needs.items():
                origins.setdefault(directive, set()).update(hosts)
    if cfg.scripts:
        providers["scripts"] = {"urls": cfg.scripts}
        origins.setdefault("script-src", set()).update(origin(u) for u in cfg.scripts)
    if not providers:
        return None
    data: dict = {"providers": providers, "support": [n for n in SUPPORT if n in providers],
                  "respectDoNotTrack": cfg.respect_do_not_track}
    consent = cfg.consent
    if consent and consent.required:
        policy = consent.policy
        if policy and policy.startswith("/") and not policy.startswith("//"):
            policy = f"{url_base}{policy}"
        data["consent"] = {"banner": consent.banner, "text": consent.text, "accept": consent.accept,
                           "decline": consent.decline, "policy": policy, "policyLabel": consent.policy_label}
    script = loader()
    version = hashlib.sha256(script.encode("utf-8")).hexdigest()[:10]
    head = (f'<script type="application/json" id="{CONFIG_ID}">{json_for_html(data)}</script>\n'
            f'  <script async src="/{SCRIPT}?v={version}"></script>')
    css = BANNER_CSS if data.get("consent", {}).get("banner") else ""
    return Integrations(head, css, script, {k: sorted(v) for k, v in sorted(origins.items())})


def patch_page(page: str, found: Integrations | None) -> str:
    """Add the settings block and the loader before ``</head>``."""
    return page.replace("</head>", f"  {found.head}\n</head>", 1) if found else page
