"""Fonts and the author's own CSS and JS files in a docs build.

``site.theme.fonts`` picks the body, heading and code fonts. A family name loads
from Google Fonts (one stylesheet request with ``display=swap``); a ``source``
file beside aiui.yaml is published with the site (:func:`branding.asset_url`)
and declared with ``@font-face``. Either way the font sets the docs theme's own
variables (``--aiui-font-sans``, ``--aiui-font-display``, ``--aiui-font-mono``)
in assets/theme.css.

``site.customCss`` and ``site.customJs`` add the author's stylesheets and
scripts to every built page, at the end of ``<body>``. The stylesheets come
after every built-in one (the docs styles load later and go into ``<head>``),
so a rule as specific as a built-in one wins; the parser waits for them before
it runs the app, so there is no flash. The scripts are ``defer``: they run
once, after the app's entry module, in the order listed.
"""

from __future__ import annotations

import hashlib
import html
import re
from dataclasses import dataclass, field
from pathlib import Path

from praisonaiui.compiler import branding
from praisonaiui.compiler.content_lint import ContentIssue
from praisonaiui.schema.models import FontFace, FontsConfig

GOOGLE_CSS = "https://fonts.googleapis.com"
GOOGLE_FILES = "https://fonts.gstatic.com"
GOOGLE_WEIGHTS = (400, 500, 600, 700)
FONT_FORMATS = {".woff2": "woff2", ".woff": "woff", ".ttf": "truetype", ".otf": "opentype"}
CUSTOM_CSS = "assets/custom.css"  # inline customCss entries
_SANS = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif'
_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace'
#: role -> (the theme variable it sets, the fallback stack)
ROLES = {
    "body": ("--aiui-font-sans", _SANS),
    "heading": ("--aiui-font-display", _SANS),
    "code": ("--aiui-font-mono", _MONO),
}
# Where styles/theme.css, pro.css and paper.css declare the font variables:
# unlayered, these beat the layered defaults on each of those elements.
_VARS_AT = ":root, :root [data-aiui-scope], :root .dark"
# Docs titles (docs.css draws the Paper look's serif titles on the same ones).
_HEADINGS = (
    ".aiui-docs :is(article.aiui-doc :is(h1, h2, h3, h4, h5, h6), .aiui-docs-hero-text, "
    ".aiui-docs-empty h1, .aiui-docs-feature-title)"
)
_CSS_URL_UNSAFE = re.compile(r'["\\\x00-\x1f]')


@dataclass
class SiteAssets:
    """What a build adds for fonts and custom CSS/JS."""

    head: str = ""  # before </head>: font preconnects, stylesheet, preload
    body: str = ""  # before </body>: custom stylesheets and scripts
    css: str = ""  # appended to assets/theme.css: @font-face and the font variables
    inline_css: str = ""  # written to CUSTOM_CSS
    issues: list[ContentIssue] = field(default_factory=list)  # 7014
    origins: dict[str, list[str]] = field(default_factory=dict)  # CSP directive -> origins


def is_url(value: str) -> bool:
    return value.startswith(("http://", "https://", "//"))


def origin(url: str) -> str:
    """``https://cdn.example.com`` for any URL on that host (protocol-relative: https)."""
    rest = url.split("//", 1)[1]
    scheme = url.split(":", 1)[0] if not url.startswith("//") else "https"
    return f"{scheme}://{re.split(r'[/?#]', rest, maxsplit=1)[0]}"


def entries(value) -> list[str]:
    """``customCss`` / ``customJs`` as a list (one string or a list of them)."""
    items = value if isinstance(value, list) else [value] if value else []
    return [v.strip() for v in items if isinstance(v, str) and v.strip()]


def is_inline_css(value: str) -> bool:
    """CSS text rather than a file: a rule always has a brace, a path never."""
    return "{" in value


def roles(fonts) -> dict[str, list[FontFace]]:
    """``site.theme.fonts`` per role; one family name is the body and headings."""
    if fonts is None:
        return {}
    if isinstance(fonts, str):
        fonts = FontsConfig(body=fonts, heading=fonts)
    out: dict[str, list[FontFace]] = {}
    for role in ROLES:
        value = getattr(fonts, role)
        faces = [FontFace(family=value)] if isinstance(value, str) else value if isinstance(value, list) else [value]
        if value is not None and faces:
            out[role] = faces
    return out


def google_url(families: dict[str, list[FontFace]]) -> str:
    """One css2 request for every Google family (weights merged per family)."""
    parts = []
    for family, faces in families.items():
        ranges = [f.weight for f in faces if isinstance(f.weight, str) and " " in f.weight]
        weights: set[int] = set()
        for f in faces:
            if f.weight is None:
                weights.update(GOOGLE_WEIGHTS)
            elif isinstance(f.weight, list):
                weights.update(f.weight)
            elif not (isinstance(f.weight, str) and " " in f.weight):
                weights.add(int(f.weight))
        spec = ranges[0].replace(" ", "..") if ranges else ";".join(str(w) for w in sorted(weights))
        parts.append(f"family={family.replace(' ', '+')}:wght@{spec}")
    return f"{GOOGLE_CSS}/css2?{'&'.join(parts)}&display=swap"


def _weight(face: FontFace) -> str | None:
    if isinstance(face.weight, list):
        return f"{min(face.weight)} {max(face.weight)}" if len(set(face.weight)) > 1 else str(face.weight[0])
    return str(face.weight) if face.weight is not None else None


def _version(src: Path) -> str:
    return hashlib.sha256(src.read_bytes()).hexdigest()[:10]


def collect(site, base: Path, files: dict[str, Path], url_base: str = "") -> SiteAssets:
    """Fonts and custom CSS/JS of ``site`` (a SiteConfig). Local files are recorded in
    ``files`` for :func:`branding.publish`; one that cannot be published is a 7014 issue."""
    out = SiteAssets()
    origins: dict[str, set[str]] = {"font-src": set(), "style-src": set(), "script-src": set()}

    def missing(key: str, value: str, kind: str, example: str) -> None:
        out.issues.append(ContentIssue(
            7014, key, 0, f"{kind} {value!r} is not a file in the project folder",
            f"Use a path relative to the config file, a site path ({example}) or a URL"))

    def local(value: str, suffixes: set[str]) -> tuple[str | None, str]:
        """(site URL or None when it cannot be published, ``?v=`` query)."""
        if is_url(value) or value.startswith("/"):
            return value, ""
        url = branding.asset_url(value, base, files, suffixes)
        if url == value:
            return None, ""
        return url, f"?v={_version(files[url.lstrip('/')])}"

    # Fonts
    theme = site.theme
    by_role = roles(theme.fonts if theme else None)
    google: dict[str, list[FontFace]] = {}
    faces_css, preload = [], []
    for role, faces in by_role.items():
        for face in faces:
            if not face.source:
                google.setdefault(face.family, []).append(face)
                continue
            url, _ = local(face.source, set(FONT_FORMATS))
            if url is None:
                missing(f"site.theme.fonts.{role}", face.source, "font", "/fonts/brand.woff2")
                continue
            if is_url(url):
                origins["font-src"].add(origin(url))
            path = url.split("?", 1)[0].split("#", 1)[0]
            fmt = face.format or FONT_FORMATS.get(Path(path).suffix.lower())
            css_url = f"{url_base}{url}" if url.startswith("/") and not url.startswith("//") else url
            src = f'url("{_CSS_URL_UNSAFE.sub("", css_url)}")' + (f' format("{fmt}")' if fmt else "")
            weight = _weight(face)
            faces_css.append(
                f'@font-face {{ font-family: "{face.family}"; src: {src};'
                + (f" font-weight: {weight};" if weight else "")
                + " font-style: normal; font-display: swap; }"
            )
            if role == "body" and fmt == "woff2" and url.startswith("/") and not url.startswith("//"):
                preload.append(url)
    if by_role:
        decls = " ".join(
            f'{ROLES[role][0]}: "{faces[0].family}", {ROLES[role][1]};' for role, faces in by_role.items()
        )
        rules = [*faces_css, f"{_VARS_AT} {{ {decls} }}"]
        if "heading" in by_role:
            rules.append(f"{_HEADINGS} {{ font-family: var(--aiui-font-display); }}")
        out.css = "\n".join(rules) + "\n"
    head = []
    if google:
        origins["style-src"].add(GOOGLE_CSS)
        origins["font-src"].add(GOOGLE_FILES)
        head += [
            f'<link rel="preconnect" href="{GOOGLE_CSS}" />',
            f'<link rel="preconnect" href="{GOOGLE_FILES}" crossorigin />',
            f'<link rel="stylesheet" href="{html.escape(google_url(google))}" />',
        ]
    head += [
        f'<link rel="preload" href="{html.escape(u)}" as="font" type="font/woff2" crossorigin />' for u in preload
    ]

    # Custom CSS, then custom JS, in the order listed
    body = []
    inline = []
    for value in entries(site.custom_css):
        if is_inline_css(value):
            if not inline:
                body.append(None)  # where assets/custom.css goes
            inline.append(value)
            continue
        url, query = local(value, {".css"})
        if url is None:
            missing("site.customCss", value, "stylesheet", "/brand.css")
            continue
        if is_url(url):
            origins["style-src"].add(origin(url))
        body.append(f'<link rel="stylesheet" href="{html.escape(url + query)}" />')
    if inline:
        out.inline_css = "\n\n".join(inline) + "\n"
        version = hashlib.sha256(out.inline_css.encode("utf-8")).hexdigest()[:10]
        link = f'<link rel="stylesheet" href="/{CUSTOM_CSS}?v={version}" />'
        body = [link if b is None else b for b in body]
    for value in entries(site.custom_js):
        url, query = local(value, {".js", ".mjs"})
        if url is None:
            missing("site.customJs", value, "script", "/analytics.js")
            continue
        if is_url(url):
            origins["script-src"].add(origin(url))
        kind = ' type="module"' if url.split("?", 1)[0].endswith(".mjs") else " defer"
        body.append(f'<script{kind} src="{html.escape(url + query)}"></script>')

    out.head = "\n  ".join(head)
    out.body = "\n  ".join(body)
    out.origins = {k: sorted(v) for k, v in origins.items() if v}
    return out


def patch_page(page: str, assets: SiteAssets) -> str:
    """Add the font tags to ``<head>`` and the custom CSS/JS to the end of ``<body>``."""
    if assets.head:
        page = page.replace("</head>", f"  {assets.head}\n</head>", 1)
    if assets.body:
        page = page.replace("</body>", f"  {assets.body}\n</body>", 1)
    return page
