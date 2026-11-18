"""CLI module - Typer-based command line interface."""

import asyncio
import re
import sys
from pathlib import Path
from typing import Any, Optional

import typer
from rich.console import Console
from rich.markup import escape
from rich.panel import Panel

from praisonaiui.__version__ import __version__

# Configure UTF-8 on Windows to handle Unicode output
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass


def _supports_unicode() -> bool:
    """Return True if stdout can encode non-ASCII (UTF-aware) output.

    Legacy Windows consoles (cp1252/cp437) cannot encode emoji/box-drawing
    characters and raise UnicodeEncodeError. When reconfigure() above succeeds
    the encoding becomes utf-8 and rich symbols are kept; otherwise we fall
    back to ASCII so output never crashes.
    """
    try:
        encoding = sys.stdout.encoding or ""
    except Exception:
        return False
    return "utf" in encoding.lower()


def _icon(symbol: str, fallback: str) -> str:
    """Return ``symbol`` on UTF-aware terminals, else ``fallback`` (ASCII).

    Preserves the rich emoji UI on macOS/Linux and modern Windows terminals
    while degrading gracefully on legacy code pages instead of crashing.
    """
    return symbol if _supports_unicode() else fallback


def _can_bind(host: str, port: int) -> bool:
    """True when uvicorn could listen on ``host:port``.

    Probes the way uvicorn binds (the requested host, and SO_REUSEADDR on
    POSIX, which asyncio sets by default), so connections a previous run left
    in TIME_WAIT do not make a free port look taken. Windows keeps the plain
    bind: there SO_REUSEADDR would let a second listener steal the port.
    """
    import os
    import socket

    try:
        infos = socket.getaddrinfo(
            host or None, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
        )
    except socket.gaierror:
        return False
    family, socktype, proto, _canon, addr = infos[0]
    try:
        with socket.socket(family, socktype, proto) as sock:
            if os.name != "nt":
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.bind(addr)
    except OSError:
        return False
    return True


def _find_available_port(host: str, start_port: int, max_attempts: int = 10) -> int:
    """The first port from ``start_port`` that :func:`_can_bind` accepts."""
    for port in range(start_port, start_port + max_attempts):
        if _can_bind(host, port):
            return port
    raise OSError(f"No available port found in range {start_port}-{start_port + max_attempts - 1}")


def _port_moved_message(host: str, port: int, actual_port: int) -> str:
    return (
        f"[yellow]{_icon('⚠️', '[WARNING]')}[/yellow] Port {port} is already in use on "
        f"{host}; serving on port {actual_port} instead"
    )


def _load_env_files() -> int:
    """Load environment variables from the standard PraisonAI ``.env`` files.

    Mirrors the PraisonAI CLI convention so ``env:VAR`` references (e.g. in
    Channels config) resolve when the server was started without the shell
    exporting the tokens. Reads ``~/.praisonai/.env`` first, then a ``.env`` in
    the current working directory. Existing process env vars are never
    overridden, and parsing is intentionally dependency-free (no python-dotenv).

    Returns the number of variables newly set into ``os.environ``.
    """
    import os

    loaded = 0
    for env_path in (Path.home() / ".praisonai" / ".env", Path.cwd() / ".env"):
        try:
            if not env_path.is_file():
                continue
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.startswith("export "):
                    line = line[len("export "):]
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
                    loaded += 1
        except Exception:
            # Never let env loading break startup — resolution falls back to
            # the existing process environment.
            continue
    return loaded


# UI styles accepted by ``aiui run --style`` (and a YAML ``style:``).
# ``app`` is the opt-in React shell (ADR-0001); ``dashboard`` stays the default.
UI_STYLES = ("chat", "docs", "agents", "playground", "dashboard", "custom", "app")

# Entry-point group of UI plugins (see praisonaiui.plugin_registry).
PLUGIN_ENTRY_POINT_GROUP = "praisonaiui.plugins"
PLUGIN_AUTOLOAD_ENV = "AIUI_DISABLE_PLUGIN_AUTOLOAD"


def _plugin_autoload_disabled() -> bool:
    import os

    return os.environ.get(PLUGIN_AUTOLOAD_ENV, "").strip().lower() in ("1", "true", "yes")


def _plugin_cli_command(name: str):
    """Return the click command a plugin contributes as ``aiui <name>``.

    Plugin discovery (importing every ``praisonaiui.plugins`` entry point) runs
    only here, i.e. when a command name is not a built-in one, never for
    ``aiui --help`` or a built-in command. ``AIUI_DISABLE_PLUGIN_AUTOLOAD=1``
    disables it.
    """
    if _plugin_autoload_disabled():
        return None
    try:
        from praisonaiui.plugin_registry import get_plugin_registry
    except ImportError:  # pragma: no cover - registry ships with the package
        return None
    try:
        records = get_plugin_registry().discover()
    except Exception as exc:  # noqa: BLE001 - never break the CLI on a plugin
        Console(stderr=True).print(f"[yellow]Plugin discovery failed:[/yellow] {exc}")
        return None
    for rec in records:
        if rec.name != name or rec.status != "ok" or rec.plugin is None:
            continue
        hook = getattr(rec.plugin, "cli_commands", None)
        if not callable(hook):
            return None
        try:
            return _as_click_command(hook(), name)
        except Exception as exc:  # noqa: BLE001
            Console(stderr=True).print(f"[red]Plugin {name!r} cli_commands() failed:[/red] {exc}")
            return None
    return None


def _as_click_command(obj, name: str):
    """A plugin's ``cli_commands()`` result (Typer app or click command) → click command."""
    import click

    if obj is None:
        return None
    if isinstance(obj, typer.Typer):
        cmd = typer.main.get_command(obj)
    elif isinstance(obj, click.Command):
        cmd = obj
    else:
        raise TypeError(f"cli_commands() must return a typer.Typer or click.Command, got {type(obj).__name__}")
    cmd.name = name
    return cmd


class _PluginAwareGroup(typer.core.TyperGroup):
    """Click group that falls back to plugin CLIs for unknown sub-commands.

    ``list_commands`` (used by ``--help``) is untouched, so listing the CLI
    never imports a plugin.
    """

    def get_command(self, ctx, cmd_name):  # type: ignore[override]
        cmd = super().get_command(ctx, cmd_name)
        if cmd is None:
            cmd = _plugin_cli_command(cmd_name)
        return cmd


app = typer.Typer(
    name="aiui",
    help="PraisonAIUI - YAML-driven website generator",
    add_completion=False,
    cls=_PluginAwareGroup,
)
console = Console()

CONFIG_NAME = "aiui.yaml"
LEGACY_CONFIG_NAME = "aiui.template.yaml"  # the old default name; still read


def _find_config(directory: Path) -> Optional[Path]:
    """The site config in *directory*: ``aiui.yaml``, else ``aiui.template.yaml``."""
    for name in (CONFIG_NAME, LEGACY_CONFIG_NAME):
        candidate = directory / name
        if candidate.is_file():
            return candidate
    return None


def _resolve_config(config: Optional[Path]) -> Path:
    """The config a command reads: ``--config`` when given, else the lookup.

    Without ``--config`` it is ``./aiui.yaml``, else ``./aiui.template.yaml``
    (with a one-line rename hint on stderr). With neither the result is
    ``aiui.yaml``, so the command's "not found" error names the new file.
    """
    if config is not None:
        return config
    found = _find_config(Path("."))
    if found is None:
        return Path(CONFIG_NAME)
    notice = None
    if found.name == LEGACY_CONFIG_NAME:
        notice = f"Using {LEGACY_CONFIG_NAME}; rename it to {CONFIG_NAME} (the old name keeps working)."
    elif Path(LEGACY_CONFIG_NAME).is_file():
        notice = f"Using {CONFIG_NAME}; {LEGACY_CONFIG_NAME} is also here and is ignored."
    if notice:
        Console(stderr=True).print(f"[dim]{notice}[/dim]", highlight=False, soft_wrap=True)
    return Path(found.name)


_CONFIG_HELP = f"Path to configuration file (default: {CONFIG_NAME}, else {LEGACY_CONFIG_NAME})"


def version_callback(value: bool) -> None:
    """Print version and exit."""
    if value:
        console.print(f"[bold]praisonaiui[/bold] version {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Optional[bool] = typer.Option(
        None,
        "--version",
        "-v",
        help="Show version and exit",
        callback=version_callback,
        is_eager=True,
    ),
) -> None:
    """PraisonAIUI - YAML-driven website generator."""
    pass


@app.command()
def init(
    template: str = typer.Option(
        "minimal",
        "--template",
        "-t",
        help="Template to use: minimal, docs, marketing",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Overwrite existing files",
    ),
    frontend: bool = typer.Option(
        False,
        "--frontend",
        help="Scaffold a Vite + React + shadcn frontend project for customization",
    ),
) -> None:
    """Initialize a new PraisonAIUI project."""
    from praisonaiui.schema.loader import SCHEMA_URL

    config_path = Path.cwd() / CONFIG_NAME

    # If --frontend flag, scaffold a frontend project
    if frontend:
        _scaffold_frontend(force)
        return

    existing = _find_config(Path.cwd())
    if existing is not None and not force:
        if existing.name == LEGACY_CONFIG_NAME:
            message = (
                f"{LEGACY_CONFIG_NAME} already exists (the old name for {CONFIG_NAME}). "
                f"Rename it to {CONFIG_NAME}, or use --force to write a new {CONFIG_NAME}."
            )
        else:
            message = f"{CONFIG_NAME} already exists. Use --force to overwrite."
        console.print(f"[red]Error:[/red] {message}", highlight=False)
        raise typer.Exit(code=1)

    # Create minimal config
    minimal_config = f"# yaml-language-server: $schema={SCHEMA_URL}\n" + """# aiui.yaml: autocomplete and hover docs in VS Code (YAML extension), JetBrains and Neovim
schemaVersion: 1

site:
  title: "My Documentation"
  description: "Built with PraisonAIUI"
  theme:
    preset: "zinc"
    radius: "md"
    darkMode: true

content:
  docs:
    dir: "./docs"
    include:
      - "**/*.md"
      - "**/*.mdx"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header_main" }
      left: { ref: "sidebar_docs" }
      main: { type: "DocContent" }
      footer: { ref: "footer_main" }

components:
  header_main:
    type: "Header"
    props:
      logoText: "My Docs"

  footer_main:
    type: "Footer"
    props:
      text: "© 2024"

  sidebar_docs:
    type: "DocsSidebar"
    props:
      source: "docs-nav"

routes:
  - match: "/docs/**"
    template: "docs"
"""

    config_path.write_text(minimal_config, encoding="utf-8")
    console.print(Panel(f"[green]✓[/green] Created {config_path}", title="Success"))


def _scaffold_frontend(force: bool) -> None:
    """Scaffold a Vite + React + shadcn frontend project."""
    import shutil
    import subprocess

    frontend_dir = Path.cwd() / "frontend"

    if frontend_dir.exists() and not force:
        console.print(
            "[red]Error:[/red] frontend/ directory already exists. Use --force to overwrite."
        )
        raise typer.Exit(code=1)

    console.print("[blue]Scaffolding Vite + React + shadcn frontend...[/blue]")

    # Copy the src/frontend template
    template_dir = Path(__file__).parent.parent / "frontend"
    if template_dir.exists():
        if frontend_dir.exists():
            shutil.rmtree(frontend_dir)
        shutil.copytree(
            template_dir,
            frontend_dir,
            ignore=shutil.ignore_patterns("node_modules", "dist", ".git", "*.log"),
        )
        console.print("[green]✓[/green] Copied frontend template")
    else:
        # Create minimal Vite project with npx
        console.print("[yellow]Creating new Vite project...[/yellow]")
        try:
            subprocess.run(
                ["npx", "-y", "create-vite@latest", "frontend", "--template", "react-ts"],
                check=True,
                cwd=Path.cwd(),
            )
            console.print("[green]✓[/green] Created Vite + React project")

            # Install shadcn
            subprocess.run(
                ["npx", "-y", "shadcn@latest", "init", "-d", "-y"],
                check=True,
                cwd=frontend_dir,
            )
            console.print("[green]✓[/green] Initialized shadcn/ui")

        except subprocess.CalledProcessError as e:
            console.print(f"[red]Error:[/red] Failed to scaffold frontend: {e}")
            raise typer.Exit(code=1)

    console.print(
        Panel(
            "[green]✓[/green] Frontend scaffolded!\n\n"
            "Next steps:\n"
            "  cd frontend\n"
            "  pnpm install\n"
            "  pnpm dev",
            title="Success",
        )
    )


@app.command()
def validate(
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help=_CONFIG_HELP,
    ),
    strict: bool = typer.Option(
        False,
        "--strict",
        help="Fail on warnings: unknown keys, broken links, missing nav pages and content issues",
    ),
    output_format: str = typer.Option("text", "--format", help="text, or json for CI"),
) -> None:
    """Validate the configuration and the docs content (front matter, alt text, headings, links)."""
    import json
    import warnings

    from praisonaiui.schema.loader import source_of
    from praisonaiui.schema.models import Config
    from praisonaiui.schema.validators import (
        ValidationError,
        find_unknown_keys,
        validate_config,
    )

    config = _resolve_config(config)
    sources: dict = {}
    data, cfg = _load_site_config(config, sources)

    # The library also emits these as UserWarning; here they are printed.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        result = validate_config(cfg, config.parent, strict=strict)

    # Loading ignores keys no field takes, so a misspelling (stlye:, themee:)
    # silently does nothing. Report them, broken docs links (aiui docs
    # check-links) and the content checks (content_lint.py); --strict makes
    # them errors.
    from praisonaiui.compiler import Compiler
    from praisonaiui.compiler.links import check_site_links, format_broken

    compiler = Compiler(cfg, base_path=config.parent)
    issues = [
        ValidationError(
            code=1003,
            category="config",
            message=f"Unknown key '{_format_loc(loc)}' (ignored)",
            file=source_of(loc, sources),
            suggestion=(
                "Check the spelling; see "
                "https://ui.praison.ai/concepts/configuration for the supported keys."
            ),
        )
        for loc in find_unknown_keys(Config, data)
    ]
    issues += [
        ValidationError(code=6001, category="links", message=format_broken(link))
        for link in check_site_links(cfg, config).broken
    ]
    issues += [
        ValidationError(code=i.code, category="content", message=i.message, file=i.file,
                        line=i.line or None, suggestion=i.hint)
        for i in compiler.lint_content(config.name, result.api_specs)
    ]
    for issue in issues:
        if strict:
            result.errors.append(issue)
            result.valid = False
        else:
            result.warnings.append(issue)

    # Docs pages that use component tags the renderer does not know.
    for docs_warning in compiler.lint_docs():
        result.warnings.append(ValidationError(code=1004, category="docs", message=docs_warning))

    if output_format == "json":
        from dataclasses import asdict

        typer.echo(json.dumps({
            "valid": result.valid,
            "errors": [asdict(e) for e in result.errors],
            "warnings": [asdict(w) for w in result.warnings],
        }, indent=2))
        if not result.valid:
            raise typer.Exit(code=1)
        return

    def where(issue: ValidationError) -> str:
        if not issue.file:
            return ""
        return f"{issue.file}:{issue.line}: " if issue.line else f"{issue.file}: "

    for warning in result.warnings:
        console.print(
            f"  [yellow]\\[{warning.category}] {warning.code} "
            f"{escape(where(warning) + warning.message)}[/yellow]"
        )
        if warning.suggestion:
            console.print(f"    💡 {escape(warning.suggestion)}")

    if result.valid:
        console.print("[green]✓[/green] Configuration is valid")
    else:
        console.print("[red]✗[/red] Configuration has errors:")
        for error in result.errors:
            console.print(f"  \\[{error.category}] {error.code} {escape(where(error) + error.message)}")
            if error.suggestion:
                console.print(f"    💡 {escape(error.suggestion)}")
        raise typer.Exit(code=1)


def _load_site_config(config: Path, sources: Optional[dict] = None) -> tuple:
    """``(data, Config)`` for a site config, with ``$ref`` includes resolved.

    Exits 2 when the file is missing and 1 when it cannot be read or does
    not fit the schema (a key in an included file names that file).
    """
    from pydantic import ValidationError as PydanticError

    from praisonaiui.schema.loader import ConfigLoadError, load_config_file, source_of
    from praisonaiui.schema.models import Config

    if not config.exists():
        console.print(f"[red]Error:[/red] Configuration file not found: {config}")
        raise typer.Exit(code=2)
    sources = {} if sources is None else sources
    try:
        data = load_config_file(config, sources)
        return data, Config.model_validate(data)
    except ConfigLoadError as e:
        console.print(f"[red]Error:[/red] {escape(str(e))}")
    except PydanticError as e:
        console.print(f"[red]Error:[/red] Failed to parse configuration: {escape(str(e))}")
        for err in e.errors():
            src = source_of(tuple(err["loc"]), sources)
            if src:
                console.print(f"  {escape(_format_loc(tuple(err['loc'])))} is set in {escape(src)}")
    except Exception as e:
        console.print(f"[red]Error:[/red] Failed to parse configuration: {escape(str(e))}")
    raise typer.Exit(code=1)


@app.command()
def schema(
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write to this file instead of stdout"),
) -> None:
    """Print the JSON Schema of aiui.yaml, for editor autocomplete and hover docs."""
    import json

    from praisonaiui.schema.loader import config_json_schema

    text = json.dumps(config_json_schema(), indent=2) + "\n"
    if output is None:
        typer.echo(text, nl=False)
        return
    output.write_text(text, encoding="utf-8")
    console.print(f"[green]✓[/green] Wrote {output}", highlight=False)


def _format_loc(loc: tuple) -> str:
    """('site', 'theme', 0, 'x') -> 'site.theme[0].x'."""
    out = ""
    for part in loc:
        if isinstance(part, int):
            out += f"[{part}]"
        else:
            out += ("." if out else "") + str(part)
    return out


@app.command()
def build(
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help=_CONFIG_HELP,
    ),
    output: Path = typer.Option(
        Path("aiui"),
        "--output",
        "-o",
        help="Output directory for manifests",
    ),
    minify: bool = typer.Option(
        False,
        "--minify",
        help="Minify JSON output",
    ),
    base_path: Optional[str] = typer.Option(
        None,
        "--base-path",
        help="URL path the site is published under (/docs, /my-repo), 'auto' for a "
        "GitHub Pages project site, '/' for the root. Default: site.basePath, else "
        "the path of seo.siteUrl",
    ),
    strict: bool = typer.Option(False, "--strict", help="Fail (exit 1) on broken links in the docs"),
) -> None:
    """Build manifests from configuration."""
    from praisonaiui.compiler import Compiler

    config = _resolve_config(config)
    _data, cfg = _load_site_config(config)

    from praisonaiui.cli_docs import print_broken_links
    from praisonaiui.compiler.links import check_site_links

    links = check_site_links(cfg, config)
    if not links.ok:
        print_broken_links(links, console, style="red" if strict else "yellow")
        if strict:
            console.print(f"[red]Error:[/red] {len(links.broken)} broken link(s); build stopped (--strict)")
            raise typer.Exit(code=1)
        console.print(f"[yellow]Warning:[/yellow] {len(links.broken)} broken link(s) (--strict fails the build)")

    compiler = Compiler(cfg, base_path=config.parent, url_base=base_path)
    result = compiler.compile(output_dir=output, minify=minify)

    if result.success:
        msg = f"[green]✓[/green] Built {len(result.files)} files to {output}/"
        if compiler.url_base:
            msg += f"\n  for {compiler.url_base}/ (base path; '--base-path /' builds for the root)"
        console.print(Panel(msg, title="Success"))
        for file in result.files:
            console.print(f"  • {file}")
        if result.excluded:
            console.print(
                f"Not published ({len(result.excluded)}, content.docs.exclude / .aiuiignore):"
            )
            for path in result.excluded:
                console.print(f"  - {path}", markup=False)
        for warning in result.warnings:
            console.print(f"[yellow]Warning:[/yellow] {escape(warning)}")
    else:
        console.print(f"[red]Error:[/red] Build failed: {result.error}")
        raise typer.Exit(code=3)


def _is_safe_path(requested: Path, root: Path) -> bool:
    """Guard against path traversal: is *requested* inside *root*?"""
    try:
        requested.resolve().relative_to(root.resolve())
        return True
    except (ValueError, OSError, RuntimeError):
        return False


_BASE_META_RE = re.compile(r'<meta name="aiui-base" content="(/[^"]*)"')


def _built_base_path(output: Path) -> str:
    """The base path a build was made for (its ``<meta name="aiui-base">``), or ``""``."""
    try:
        match = _BASE_META_RE.search((output / "index.html").read_text(encoding="utf-8"))
    except OSError:
        return ""
    return match.group(1).rstrip("/") if match else ""


def _under_base(app, base: str):
    """Serve ``app`` under ``base`` the way the host will: ``/`` redirects to
    ``<base>/``, anything else outside it is a 404."""
    from starlette.responses import PlainTextResponse, RedirectResponse

    async def mounted(scope, receive, send):
        path = scope.get("path", "/")
        if scope["type"] != "http" or path == base or path.startswith(base + "/"):
            if scope["type"] == "http":
                scope = dict(scope, path=path[len(base) :] or "/")
                scope.pop("raw_path", None)
            await app(scope, receive, send)
            return
        response = (
            RedirectResponse(base + "/") if path == "/" else PlainTextResponse("Not Found", 404)
        )
        await response(scope, receive, send)

    return mounted


def _built_redirects(root: Path) -> list[dict]:
    """The ``redirects`` a build wrote to its ui-config.json."""
    import json

    try:
        rules = json.loads((root / "ui-config.json").read_text(encoding="utf-8")).get("redirects")
    except (OSError, ValueError, AttributeError):
        return []
    return [r for r in rules or [] if isinstance(r, dict) and "source" in r and "destination" in r]


def _static_site_app(output: Path, cors_origins: Optional[list[str]] = None):
    """The ASGI app ``aiui serve`` runs for a built site.

    * Files come from Starlette's ``StaticFiles`` (contained lookup, ETag and
      Last-Modified, 304s), gzip-compressed.
    * ``/assets``: content-hashed chunks are ``immutable``; ``index.js`` /
      ``index.css`` and unknown names are ``no-cache`` (same rules as the
      ``aiui run`` server). A missing asset is a 404, never the HTML page.
    * A path whose last segment has no extension is served from
      ``<path>.html`` when it exists (the canonical URL, so no 307 to
      ``<path>/``), and falls back to ``index.html`` (client-side routes);
      any other missing file is a 404.
    * A build made with ``--base-path /x`` is served under ``/x`` (``/``
      redirects there), so the preview matches the host.
    * The build's ``redirects`` answer with 301 (302 when not permanent).
    """
    from starlette.applications import Starlette
    from starlette.exceptions import HTTPException
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import FileResponse, PlainTextResponse, RedirectResponse
    from starlette.routing import Mount

    from praisonaiui.compiler import redirects as rd
    from praisonaiui.server import _AssetStaticFiles, gzip_static
    from praisonaiui.static_gzip import NoCacheStaticFiles, gzip_file_response

    root = output.resolve()
    base = _built_base_path(root)

    # Fixed names (index.html, ui-config.json …) change on every build.
    site = NoCacheStaticFiles(directory=str(root), html=True)

    async def _html_file(scope, candidate: Path):
        response = FileResponse(
            str(candidate),
            media_type="text/html",
            stat_result=candidate.stat(),
            headers={"Cache-Control": "no-cache"},
        )
        return await gzip_file_response(response, scope)

    def markdown_file(scope, rel: str) -> Optional[Path]:
        """A page's agent-ready Markdown when the request's ``Accept`` prefers it."""
        from starlette.datastructures import Headers

        from praisonaiui.compiler.agent_markdown import markdown_twin, prefers_markdown

        if "." in rel.rsplit("/", 1)[-1] or not prefers_markdown(Headers(scope=scope).get("accept", "")):
            return None
        page = root / (f"{rel}.html" if rel else "index.html")
        if not (_is_safe_path(page, root) and page.is_file()):
            return None
        twin = markdown_twin(page.read_text(encoding="utf-8"), base)
        md = root / twin.lstrip("/") if twin else None
        return md if md and _is_safe_path(md, root) and md.is_file() else None

    redirects = _built_redirects(root)

    def has_file(rel: str) -> bool:
        names = [rel, f"{rel}.html", f"{rel}/index.html"] if rel else ["index.html"]
        return any(_is_safe_path(root / n, root) and (root / n).is_file() for n in names)

    async def site_app(scope, receive, send):
        if scope["type"] != "http":
            return
        path = scope.get("path", "/")
        rel = path.strip("/")
        # redirects: (compiler/redirects.py). An exact rule's file is its stub;
        # a wildcard rule gives way to a file at the path.
        hit = rd.match(redirects, path) if redirects else None
        if hit and (rd.is_exact(hit[0]["source"]) or not has_file(rel)):
            dest = base + hit[1] if rd.is_internal(hit[1]) else hit[1]
            query = scope.get("query_string", b"").decode("latin-1")
            if query and "?" not in dest:
                dest += "?" + query
            code = 301 if hit[0].get("permanent", True) else 302
            await RedirectResponse(dest, status_code=code)(scope, receive, send)
            return
        # `Accept: text/markdown` on a page URL: the page as Markdown (agents).
        md = markdown_file(scope, rel)
        if md:
            headers = {"Cache-Control": "no-cache", "Vary": "Accept"}
            response = FileResponse(str(md), media_type="text/markdown; charset=utf-8", headers=headers)
            await (await gzip_file_response(response, scope))(scope, receive, send)
            return
        # /docs/x is the canonical URL and the build writes docs/x.html beside
        # docs/x/index.html: answer it directly instead of StaticFiles' 307.
        if rel and not path.endswith("/") and "." not in rel.rsplit("/", 1)[-1]:
            page = root / f"{rel}.html"
            if _is_safe_path(page, root) and page.is_file():
                await (await _html_file(scope, page))(scope, receive, send)
                return
        try:
            await site(scope, receive, send)
            return
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        path = scope.get("path", "/")
        last = path.rstrip("/").rsplit("/", 1)[-1]
        response = PlainTextResponse("Not Found", status_code=404)
        if "." not in last:
            rel = path.strip("/")
            candidates = [root / f"{rel}.html"] if rel else []
            candidates.append(root / "index.html")
            for candidate in candidates:
                if _is_safe_path(candidate, root) and candidate.is_file():
                    response = await _html_file(scope, candidate)
                    break
        await response(scope, receive, send)

    routes = []
    if (root / "assets").is_dir():
        routes.append(
            Mount(
                "/assets",
                app=gzip_static(_AssetStaticFiles(directory=str(root / "assets"), frontend_dir=root)),
            )
        )
    routes.append(Mount("/", app=gzip_static(site_app)))

    middleware = []
    if cors_origins:
        middleware.append(
            Middleware(CORSMiddleware, allow_origins=list(cors_origins), allow_methods=["GET"])
        )
    app = Starlette(routes=routes, middleware=middleware)
    return _under_base(app, base) if base else app


@app.command()
def serve(
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help=_CONFIG_HELP,
    ),
    port: int = typer.Option(
        8000,
        "--port",
        "-p",
        help="Port for HTTP server",
    ),
    output: Path = typer.Option(
        Path("aiui"),
        "--output",
        "-o",
        help="Output directory to serve",
    ),
    no_build: bool = typer.Option(
        False,
        "--no-build",
        help="Skip build step, serve existing files",
    ),
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        help="Host to bind to",
    ),
    cors_origins: str = typer.Option(
        "",
        "--cors-origins",
        help="Comma-separated list of allowed CORS origins (empty = same-origin only)",
    ),
    watch: bool = typer.Option(
        False,
        "--watch",
        "-w",
        help="Watch for config changes and auto-rebuild",
    ),
    ssl_certfile: Optional[Path] = typer.Option(
        None,
        "--ssl-certfile",
        help="Path to SSL certificate file for HTTPS",
    ),
    ssl_keyfile: Optional[Path] = typer.Option(
        None,
        "--ssl-keyfile",
        help="Path to SSL private key file for HTTPS",
    ),
    base_path: Optional[str] = typer.Option(
        None,
        "--base-path",
        help="URL path the site is published under (/docs, /my-repo), 'auto' for a "
        "GitHub Pages project site, '/' for the root. Default: site.basePath, else "
        "the path of seo.siteUrl",
    ),
) -> None:
    """Serve the site locally with a production-ready HTTP server."""
    if not no_build or watch:
        config = _resolve_config(config)
    # Build first unless --no-build
    if not no_build:
        console.print(f"[yellow]{_icon('⏳', '...')}[/yellow] Building manifests...")
        build(config=config, output=output, minify=False, base_path=base_path)

    # Check if output directory exists
    if not output.exists():
        console.print(f"[red]Error:[/red] Output directory not found: {output}")
        console.print("Run 'aiui build' first or remove --no-build flag.")
        raise typer.Exit(code=2)

    # Find available port
    try:
        actual_port = _find_available_port(host, port)
    except OSError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=4)

    if actual_port != port:
        console.print(_port_moved_message(host, port, actual_port))

    origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
    starlette_app = _static_site_app(output, origins)

    protocol = "https" if ssl_certfile else "http"
    site_url = f"{protocol}://{host}:{actual_port}{_built_base_path(output)}"
    console.print(f"\n[green]🚀[/green] Serving at [link]{site_url}[/link]")
    if ssl_certfile:
        console.print(f"[green]🔒[/green] TLS enabled with {ssl_certfile}")
    console.print("[dim]Press Ctrl+C to stop[/dim]\n")

    # Open browser
    import webbrowser

    webbrowser.open(site_url)

    # Start file watcher in background thread if --watch
    if watch and config is not None and config.exists():
        import threading

        def _watch_and_rebuild() -> None:
            try:
                from watchfiles import watch as wf_watch

                for _changes in wf_watch(config.parent):
                    console.print("[blue]↻[/blue] Detected changes, rebuilding...")
                    try:
                        build(config=config, output=output, minify=False, base_path=base_path)
                        console.print("[green]✓[/green] Rebuild complete")
                    except Exception as e:
                        console.print(f"[red]✗[/red] Rebuild failed: {e}")
            except Exception:
                pass

        watcher = threading.Thread(target=_watch_and_rebuild, daemon=True)
        watcher.start()

    # Run Uvicorn
    import uvicorn

    uvicorn_kwargs: dict = {"host": host, "port": actual_port, "log_level": "info"}
    if ssl_certfile:
        uvicorn_kwargs["ssl_certfile"] = str(ssl_certfile)
    if ssl_keyfile:
        uvicorn_kwargs["ssl_keyfile"] = str(ssl_keyfile)
    uvicorn.run(starlette_app, **uvicorn_kwargs)


@app.command()
def dev(
    config: Optional[Path] = typer.Option(None, "--config", "-c", help=_CONFIG_HELP),
    port: Optional[int] = typer.Option(
        None, "--port", "-p", help="Port (next free port if taken; default 8000, 9000 with --examples)"
    ),
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        help="Host to bind to (default: this machine only)",
    ),
    open_browser: bool = typer.Option(True, "--open/--no-open", help="Open the preview in the browser"),
    base_path: Optional[str] = typer.Option(
        None, "--base-path", help="URL path to preview the site under (default: as `aiui build`)"
    ),
    examples_dir: Optional[Path] = typer.Option(
        None,
        "--examples",
        "-e",
        help="Run the examples dashboard for this folder of example projects instead",
    ),
) -> None:
    """Preview the docs site: build, serve, and reload the browser on every save."""
    from praisonaiui import dev_server

    docs_only = config is None and _find_config(Path(".")) is None and Path("docs").is_dir()
    has_site = config is not None or _find_config(Path(".")) is not None or docs_only
    if examples_dir is not None or (not has_site and Path("examples").is_dir()):
        _examples_dashboard(examples_dir or Path("examples"), port or 9000, host)
        return
    if not has_site:
        console.print(
            f"[red]Error:[/red] No {CONFIG_NAME} or docs/ folder here. "
            "Run 'aiui init --template docs' to start a docs site.",
            highlight=False,
        )
        raise typer.Exit(code=2)
    if docs_only:
        site_config = None
    else:
        site_config = _resolve_config(config)
        if not site_config.is_file():
            console.print(f"[red]Error:[/red] Configuration file not found: {site_config}")
            raise typer.Exit(code=2)
    project = site_config.parent if site_config else Path(".")
    dev_server.run(
        site_config, project, host=host, port=port or 8000, open_browser=open_browser, url_base=base_path
    )


def _examples_dashboard(examples_dir: Path, port: int, host: str) -> None:
    """``aiui dev --examples``: a dashboard that switches between examples live."""
    import http.server
    import json
    import socket
    import socketserver
    import subprocess
    import tempfile
    import urllib.parse
    import webbrowser

    # Find examples
    if not examples_dir.exists():
        console.print(f"[red]Error:[/red] Examples directory not found: {examples_dir}")
        raise typer.Exit(code=1)

    examples = [
        d.name for d in examples_dir.iterdir() if d.is_dir() and _find_config(d) is not None
    ]
    if not examples:
        console.print(f"[red]Error:[/red] No examples found in {examples_dir}")
        raise typer.Exit(code=1)

    console.print(f"[green]Found {len(examples)} examples:[/green] {', '.join(examples)}")

    # Create temp directory for built content
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        current_example = {"name": examples[0]}

        # Build example with optional theme override
        def build_example(
            name: str,
            theme_preset: str = None,
            radius: str = None,
            dark_mode: bool = None,
        ) -> bool:
            """Build an example, optionally overriding theme via a temp config."""
            import yaml

            example_path = examples_dir / name
            if not example_path.exists():
                return False

            try:
                config_file = _find_config(example_path) or example_path / CONFIG_NAME
                build_config = str(config_file)

                # If theme override, write a temp config (never mutate original)
                has_override = any(
                    [
                        theme_preset,
                        radius,
                        dark_mode is not None,
                    ]
                )
                tmp_cfg = None
                if has_override and config_file.exists():
                    with open(config_file, encoding="utf-8") as f:
                        config = yaml.safe_load(f.read())
                    if "site" not in config:
                        config["site"] = {}
                    if "theme" not in config["site"]:
                        config["site"]["theme"] = {}
                    if theme_preset:
                        config["site"]["theme"]["preset"] = theme_preset
                    if radius:
                        config["site"]["theme"]["radius"] = radius
                    if dark_mode is not None:
                        config["site"]["theme"]["darkMode"] = dark_mode
                    tmp_cfg = example_path / ".aiui.tmp.yaml"
                    with open(tmp_cfg, "w", encoding="utf-8") as f:
                        yaml.dump(config, f, default_flow_style=False)
                    build_config = str(tmp_cfg)

                # Run aiui build
                result = subprocess.run(
                    [
                        "aiui",
                        "build",
                        "-c",
                        build_config,
                        "-o",
                        str(temp_path / "site"),
                        # Served at the root below, whatever seo.siteUrl says.
                        "--base-path",
                        "/",
                    ],
                    cwd=example_path,
                    capture_output=True,
                    text=True,
                )

                # Clean up temp config
                if tmp_cfg and tmp_cfg.exists():
                    tmp_cfg.unlink()

                if result.returncode != 0:
                    console.print("[red]Build failed![/red]")
                    console.print(f"[dim]Return code: {result.returncode}[/dim]")
                    if result.stdout:
                        console.print(f"[dim]STDOUT: {result.stdout[:1000]}[/dim]")
                    if result.stderr:
                        console.print(f"[dim]STDERR: {result.stderr[:1000]}[/dim]")
                return result.returncode == 0
            except Exception as e:
                import traceback

                console.print(f"[red]Build error:[/red] {e}")
                console.print(f"[dim]{traceback.format_exc()}[/dim]")
                # Clean up temp config on error too
                if tmp_cfg and tmp_cfg.exists():
                    tmp_cfg.unlink()
                return False

        # Initial build
        console.print(f"[yellow]Building {current_example['name']}...[/yellow]")
        build_example(current_example["name"])

        # Official shadcn theme presets (Tailwind color names)
        themes = [
            "zinc",
            "slate",
            "stone",
            "neutral",
            "red",
            "orange",
            "amber",
            "yellow",
            "lime",
            "green",
            "emerald",
            "teal",
            "cyan",
            "sky",
            "blue",
            "indigo",
            "violet",
            "purple",
            "fuchsia",
            "pink",
            "rose",
            "paper",
        ]
        radii = ["none", "sm", "md", "lg", "xl"]

        # Dashboard HTML with YAML editor
        dashboard_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PraisonAIUI Dev Dashboard</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #fafafa; }}
        .toolbar {{
            position: fixed; top: 0; left: 0; right: 0; z-index: 100;
            display: flex; align-items: center; gap: 12px;
            padding: 10px 16px;
            background: linear-gradient(to bottom, rgba(10,10,10,0.98), rgba(10,10,10,0.95));
            border-bottom: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(12px);
        }}
        .logo {{ display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 13px; }}
        .logo-icon {{
            width: 24px; height: 24px; border-radius: 5px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            display: flex; align-items: center; justify-content: center;
            font-size: 9px; font-weight: 700;
        }}
        .divider {{ width: 1px; height: 24px; background: rgba(255,255,255,0.15); }}
        .group {{ display: flex; align-items: center; gap: 6px; }}
        .label {{ font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }}
        select, .btn {{
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15);
            color: #fafafa; padding: 6px 10px;
            border-radius: 6px; font-size: 12px; cursor: pointer;
        }}
        select {{
            padding-right: 28px; appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: right 8px center;
        }}
        select:hover, .btn:hover {{ border-color: rgba(255,255,255,0.3); }}
        select:focus, .btn:focus {{ outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.2); }}
        .btn {{ display: flex; align-items: center; gap: 6px; }}
        .btn.active {{ background: rgba(99,102,241,0.2); border-color: #6366f1; }}
        .status {{ font-size: 11px; color: #888; margin-left: auto; }}
        .status.loading {{ color: #f59e0b; }}
        .status.ready {{ color: #22c55e; }}

        .main-content {{ position: fixed; top: 45px; left: 0; right: 0; bottom: 0; display: flex; }}
        iframe {{ flex: 1; border: none; }}

        .yaml-panel {{
            width: 0; overflow: hidden; transition: width 0.2s ease;
            background: #111; border-left: 1px solid rgba(255,255,255,0.1);
            display: flex; flex-direction: column;
        }}
        .yaml-panel.open {{ width: 500px; }}
        .yaml-header {{
            padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
            display: flex; align-items: center; justify-content: space-between;
        }}
        .yaml-header h3 {{ font-size: 13px; font-weight: 600; }}
        .yaml-actions {{ display: flex; gap: 8px; }}
        .yaml-editor {{
            flex: 1; padding: 0;
        }}
        .yaml-editor textarea {{
            width: 100%; height: 100%; padding: 16px;
            background: transparent; border: none; color: #a5f3fc;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 12px; line-height: 1.6; resize: none;
        }}
        .yaml-editor textarea:focus {{ outline: none; }}
        .btn-primary {{ background: #6366f1; border-color: #6366f1; }}
        .btn-primary:hover {{ background: #4f46e5; }}
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="logo">
            <div class="logo-icon">AI</div>
            <span>Dev</span>
        </div>
        <div class="divider"></div>
        <div class="group">
            <span class="label">Example</span>
            <select id="example-select" onchange="switchExample(this.value)">
                {"".join(f'<option value="{e}">{e}</option>' for e in examples)}
            </select>
        </div>
        <div class="divider"></div>
        <div class="group">
            <label class="label" style="display: flex; align-items: center; gap: 4px; cursor: pointer;">
                <input type="checkbox" id="use-yaml-theme" checked onchange="updateTheme()" style="width: 14px; height: 14px;">
                Use YAML Theme
            </label>
        </div>
        <div class="group">
            <span class="label">Theme</span>
            <select id="theme-select" onchange="updateTheme()">
                {"".join(f'<option value="{t}">{t}</option>' for t in themes)}
            </select>
        </div>
        <div class="group">
            <span class="label">Radius</span>
            <select id="radius-select" onchange="updateTheme()">
                {"".join(f'<option value="{r}"{"selected" if r == "md" else ""}>{r}</option>' for r in radii)}
            </select>
        </div>
        <div class="group">
            <span class="label">Mode</span>
            <select id="mode-select" onchange="updateTheme()">
                <option value="true">Dark</option>
                <option value="false">Light</option>
            </select>
        </div>
        <div class="divider"></div>
        <button class="btn" id="yaml-btn" onclick="toggleYaml()">
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            YAML
        </button>
        <span id="status" class="status ready">Ready</span>
    </div>

    <div class="main-content">
        <iframe id="preview" src="/site/"></iframe>
        <div class="yaml-panel" id="yaml-panel">
            <div class="yaml-header">
                <h3 id="yaml-file">aiui.yaml</h3>
                <div class="yaml-actions">
                    <button class="btn" onclick="copyYaml()">Copy</button>
                    <button class="btn btn-primary" onclick="applyYaml()">Apply & Build</button>
                </div>
            </div>
            <div class="yaml-editor">
                <textarea id="yaml-content" spellcheck="false" placeholder="Loading YAML..."></textarea>
            </div>
        </div>
    </div>

    <script>
        let currentExample = '{examples[0]}';
        let yamlOpen = false;

        async function switchExample(name) {{
            currentExample = name;
            await rebuildWithTheme();
            if (yamlOpen) await loadYaml();
        }}

        async function updateTheme() {{
            await rebuildWithTheme();
        }}

        async function rebuildWithTheme() {{
            const status = document.getElementById('status');
            const iframe = document.getElementById('preview');
            const useYamlTheme = document.getElementById('use-yaml-theme').checked;
            const theme = document.getElementById('theme-select').value;
            const radius = document.getElementById('radius-select').value;
            const darkMode = document.getElementById('mode-select').value;

            status.textContent = 'Building...';
            status.className = 'status loading';

            try {{
                // If "Use YAML Theme" is checked, don't send theme overrides
                const params = useYamlTheme
                    ? new URLSearchParams({{ example: currentExample }})
                    : new URLSearchParams({{
                        example: currentExample,
                        theme: theme,
                        radius: radius,
                        darkMode: darkMode
                    }});
                const res = await fetch('/api/switch?' + params);
                const data = await res.json();
                if (data.success) {{
                    iframe.src = '/site/?t=' + Date.now();
                    status.textContent = 'Ready';
                    status.className = 'status ready';
                }} else {{
                    status.textContent = 'Build failed';
                    status.className = 'status';
                }}
            }} catch (e) {{
                status.textContent = 'Error';
                status.className = 'status';
            }}
        }}

        function toggleYaml() {{
            yamlOpen = !yamlOpen;
            document.getElementById('yaml-panel').classList.toggle('open', yamlOpen);
            document.getElementById('yaml-btn').classList.toggle('active', yamlOpen);
            if (yamlOpen) loadYaml();
        }}

        async function loadYaml() {{
            const res = await fetch('/api/yaml?example=' + encodeURIComponent(currentExample));
            const data = await res.json();
            document.getElementById('yaml-content').value = data.yaml || '';
            document.getElementById('yaml-file').textContent = data.file || 'aiui.yaml';
        }}

        function copyYaml() {{
            const textarea = document.getElementById('yaml-content');
            textarea.select();
            document.execCommand('copy');
            const btn = event.target;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = 'Copy', 1500);
        }}

        async function applyYaml() {{
            const yaml = document.getElementById('yaml-content').value;
            const status = document.getElementById('status');
            const iframe = document.getElementById('preview');

            status.textContent = 'Building...';
            status.className = 'status loading';

            try {{
                const res = await fetch('/api/yaml', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ example: currentExample, yaml: yaml }})
                }});
                const data = await res.json();
                if (data.success) {{
                    iframe.src = '/site/?t=' + Date.now();
                    status.textContent = 'Ready';
                    status.className = 'status ready';
                }} else {{
                    status.textContent = 'Build failed';
                    status.className = 'status';
                }}
            }} catch (e) {{
                status.textContent = 'Error';
                status.className = 'status';
            }}
        }}
    </script>
</body>
</html>"""

        # Find available port
        def find_port(start: int) -> int:
            for i in range(10):
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                    try:
                        s.bind((host, start + i))
                        return start + i
                    except OSError:
                        continue
            raise OSError("No available port")

        actual_port = find_port(port)

        # Custom handler with API
        class DevHandler(http.server.SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                # Serve from the site subdirectory
                site_dir = temp_path / "site"
                site_dir.mkdir(parents=True, exist_ok=True)
                super().__init__(*args, directory=str(site_dir), **kwargs)

            def _refuse(self) -> bool:
                """Send an error and return True unless the request may proceed."""
                refusal = _dev_request_refusal(
                    self.command,
                    self.path.split("?")[0],
                    self.headers.items(),
                    # The address this connection reached (as ASGI "server").
                    self.connection.getsockname()[:2],
                )
                if refusal is None:
                    return False
                status, message = refusal
                self.send_response(status)
                self.send_header("Content-type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": message}).encode())
                return True

            def do_GET(self):
                if self._refuse():
                    return
                path = self.path.split("?")[0]
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

                # Dashboard
                if path == "/" or path == "":
                    self.send_response(200)
                    self.send_header("Content-type", "text/html")
                    self.end_headers()
                    self.wfile.write(dashboard_html.encode())
                    return

                # API: switch example
                if path == "/api/switch":
                    example_name = query.get("example", [None])[0]
                    theme_preset = query.get("theme", [None])[0]
                    radius = query.get("radius", [None])[0]
                    dark_mode_str = query.get("darkMode", [None])[0]
                    dark_mode = dark_mode_str == "true" if dark_mode_str else None

                    if example_name and example_name in examples:
                        console.print(
                            f"[yellow]Building {example_name} (theme={theme_preset}, radius={radius}, dark={dark_mode})...[/yellow]"
                        )
                        success = build_example(example_name, theme_preset, radius, dark_mode)
                        current_example["name"] = example_name
                        self.send_response(200)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(
                            json.dumps({"success": success, "example": example_name}).encode()
                        )
                    else:
                        self.send_response(400)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": "Invalid example"}).encode())
                    return

                # API: get YAML content
                if path == "/api/yaml":
                    example_name = query.get("example", [None])[0]
                    if example_name and example_name in examples:
                        yaml_path = _find_config(examples_dir / example_name)
                        yaml_content = ""
                        if yaml_path is None:
                            yaml_path = examples_dir / example_name / CONFIG_NAME
                        if yaml_path.exists():
                            with open(yaml_path, encoding="utf-8") as f:
                                yaml_content = f.read()
                        self.send_response(200)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(
                            json.dumps(
                                {"yaml": yaml_content, "example": example_name, "file": yaml_path.name}
                            ).encode()
                        )
                    else:
                        self.send_response(400)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": "Invalid example"}).encode())
                    return

                # Serve built site from /site/ prefix
                if path.startswith("/site"):
                    # Strip /site prefix and serve file
                    self.path = path[5:] if len(path) > 5 else "/"
                    if self.path == "/" or (self.path and "." not in self.path.split("/")[-1]):
                        self.path = "/index.html"

                # Default: serve file normally (for assets like /assets/index.js)
                try:
                    super().do_GET()
                except Exception:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                if self._refuse():
                    return
                path = self.path.split("?")[0]

                # API: save YAML and rebuild
                if path == "/api/yaml":
                    content_length = int(self.headers.get("Content-Length", 0))
                    body = self.rfile.read(content_length).decode("utf-8")
                    try:
                        data = json.loads(body)
                        example_name = data.get("example")
                        yaml_content = data.get("yaml", "")

                        if example_name and example_name in examples:
                            yaml_path = _find_config(examples_dir / example_name) or (
                                examples_dir / example_name / CONFIG_NAME
                            )
                            # Write the new YAML
                            with open(yaml_path, "w", encoding="utf-8") as f:
                                f.write(yaml_content)
                            console.print(
                                f"[yellow]Rebuilding {example_name} with edited YAML...[/yellow]"
                            )
                            # Rebuild
                            success = build_example(example_name)
                            self.send_response(200)
                            self.send_header("Content-type", "application/json")
                            self.end_headers()
                            self.wfile.write(
                                json.dumps({"success": success, "example": example_name}).encode()
                            )
                        else:
                            self.send_response(400)
                            self.send_header("Content-type", "application/json")
                            self.end_headers()
                            self.wfile.write(json.dumps({"error": "Invalid example"}).encode())
                    except json.JSONDecodeError:
                        self.send_response(400)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"error": "Invalid JSON"}).encode())
                    return

                self.send_response(404)
                self.end_headers()

            def log_message(self, format, *args):
                pass  # Suppress logs

        console.print(
            f"\n[green]🚀[/green] Dev dashboard at [link]http://localhost:{actual_port}[/link]"
        )
        console.print("[dim]Switch examples with the dropdown. Press Ctrl+C to stop.[/dim]\n")
        webbrowser.open(f"http://localhost:{actual_port}")

        with socketserver.TCPServer((host, actual_port), DevHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                console.print("\n[green]Dev server stopped.[/green]")


def _dev_request_refusal(
    method: str, path: str, headers, server_address
) -> Optional[tuple[int, str]]:
    """Why the ``aiui dev`` server must refuse this request, or None.

    The dev server writes example YAML files, so it applies the same guards
    as the app server (:mod:`praisonaiui.http_guard`): an unknown ``Host``
    (DNS rebinding) is refused; ``/api/*`` calls must come from the
    dashboard's own origin (a cross-site page, including a ``text/plain``
    POST that skips the CORS preflight, is refused); and a POST must be
    ``application/json``.
    """
    from praisonaiui.http_guard import (
        configured_hosts,
        configured_origins,
        host_allowed,
        origin_allowed,
    )

    scope = {
        "type": "http",
        "scheme": "http",
        "method": method,
        "path": path,
        "server": (str(server_address[0]), int(server_address[1])) if server_address else None,
        "headers": [(str(k).lower().encode("latin-1"), str(v).encode("latin-1")) for k, v in headers],
    }
    if not host_allowed(scope, configured_hosts()):
        return 400, "Host not allowed"
    if path.startswith("/api/") and not origin_allowed(scope, configured_origins()):
        return 403, "Cross-site request refused"
    if method == "POST":
        content_type = ""
        for k, v in headers:
            if str(k).lower() == "content-type":
                content_type = str(v).split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            return 415, "Content-Type must be application/json"
    return None


#: The top-level keys ``aiui run chat.yaml`` reads. Anything else is reported.
CHAT_YAML_KEYS = frozenset(
    {
        # _apply_chat_yaml
        "style", "dashboard", "theme", "branding", "pages", "layout", "extensions",
        # _register_yaml_chat
        "name", "instructions", "model", "welcome", "goodbye", "starters",
        "profiles", "tools", "features",
        # aiui run (--datastore wins)
        "datastore",
    }
)


def chat_yaml_unknown_keys(chat_yaml: dict) -> list:
    """Top-level keys of a chat YAML that ``aiui run`` does not use."""
    return sorted(str(k) for k in chat_yaml if k not in CHAT_YAML_KEYS)


def _apply_chat_yaml_layout(layout: Any) -> None:
    """``layout:`` in a chat YAML: an id, or the ``aiui.yaml`` layout block."""
    from praisonaiui.layouts import set_layout

    if isinstance(layout, str):
        set_layout(layout)
        return
    if not isinstance(layout, dict):
        raise ValueError("expected a layout id or a mapping")
    user_choice = layout.get("user_choice", layout.get("userChoice"))
    set_layout(
        layout.get("default"),
        available=layout.get("available"),
        user_choice=user_choice,
        primary=layout.get("primary"),
        options=layout.get("options"),
    )


def _apply_chat_yaml(chat_yaml: dict) -> Optional[str]:
    """Apply a YAML chat config (style, dashboard, theme, branding, pages,
    layout, extensions) through the public APIs and register its callbacks.

    Returns the YAML's style, if it names one.
    """
    import praisonaiui as _aiui

    style = None
    if "style" in chat_yaml:
        _aiui.set_style(chat_yaml["style"])
        style = chat_yaml["style"]
    if "dashboard" in chat_yaml and isinstance(chat_yaml["dashboard"], dict):
        _aiui.set_dashboard(
            **{
                k.replace("pageHeader", "page_header"): v
                for k, v in chat_yaml["dashboard"].items()
                if k.replace("pageHeader", "page_header") in ("sidebar", "page_header")
            }
        )
    if "theme" in chat_yaml and isinstance(chat_yaml["theme"], dict):
        _aiui.set_theme(
            **{k.replace("darkMode", "dark_mode"): v for k, v in chat_yaml["theme"].items()}
        )
    if "branding" in chat_yaml and isinstance(chat_yaml["branding"], dict):
        _aiui.set_branding(**chat_yaml["branding"])
    if "pages" in chat_yaml and isinstance(chat_yaml["pages"], list):
        _aiui.set_pages(chat_yaml["pages"])
    if "layout" in chat_yaml:
        # The same block as aiui.yaml's layout: (or just the default's id).
        try:
            _apply_chat_yaml_layout(chat_yaml["layout"])
        except (TypeError, ValueError) as exc:
            console.print(f"[yellow]Warning:[/yellow] chat YAML layout: ignored ({exc})")
    if "extensions" in chat_yaml:
        ext = chat_yaml["extensions"]
        if isinstance(ext, dict):
            _aiui.set_extensions(enabled=ext.get("enabled"), disabled=ext.get("disabled"))
        else:
            console.print(
                "[yellow]Warning:[/yellow] chat YAML extensions: ignored "
                "(expected a mapping with enabled: / disabled:)"
            )

    # Auto-register callbacks from YAML
    _register_yaml_chat(chat_yaml)
    return style


def _load_user_module(app_file: Path):
    """Execute *app_file* as module ``user_app`` (registers its callbacks)."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("user_app", app_file)
    if spec is None or spec.loader is None:
        return None
    user_module = importlib.util.module_from_spec(spec)
    sys.modules["user_app"] = user_module
    spec.loader.exec_module(user_module)
    return user_module


def _make_datastore(name: str):
    """``(store, label)`` for an ``aiui run --datastore`` value.

    Raises ``ValueError`` for an unknown name.
    """
    if name == "memory":
        from praisonaiui.datastore import MemoryDataStore

        return MemoryDataStore(), name
    if name == "sdk":
        try:
            from praisonaiui.datastore_sdk import SDKFileDataStore

            return SDKFileDataStore(), name
        except (ImportError, Exception):
            from praisonaiui.datastore import JSONFileDataStore

            return JSONFileDataStore(), "json (sdk fallback)"
    if name.startswith("sdk:"):
        from praisonaiui.datastore_sdk import SDKFileDataStore

        return SDKFileDataStore(session_dir=name[4:]), name
    if name == "json":
        from praisonaiui.datastore import JSONFileDataStore

        return JSONFileDataStore(), name
    if name.startswith("json:"):
        from praisonaiui.datastore import JSONFileDataStore

        return JSONFileDataStore(data_dir=name[5:]), name
    raise ValueError(f"Unknown datastore: {name}")


def _register_yaml_chat(chat_yaml: dict) -> None:
    """Register chat callbacks from a YAML configuration.

    Supports YAML like::

        name: My Assistant
        instructions: You are a helpful assistant.
        model: gpt-4o-mini
        welcome: "Hi! How can I help?"
        goodbye: "See you later!"
        starters:
          - label: Hello
            message: Hello!
            icon: 👋
        profiles:
          - name: Coder
            description: Code expert
            icon: 💻
        tools:
          - web_search
          - calculate
        features: true
        datastore: json
    """
    import praisonaiui as aiui
    from praisonaiui.server import register_callback

    agent_name = chat_yaml.get("name", "Assistant")
    instructions = chat_yaml.get("instructions", "You are a helpful assistant.")
    model = chat_yaml.get("model", None)
    welcome_msg = chat_yaml.get("welcome", f"👋 Hi! I'm {agent_name}. How can I help?")
    goodbye_msg = chat_yaml.get("goodbye", None)
    starters = chat_yaml.get("starters", [])
    profiles = chat_yaml.get("profiles", [])
    tool_names = chat_yaml.get("tools", [])
    features_flag = chat_yaml.get("features", False)

    # ── Features auto-registration ──────────────────────────────────
    if features_flag:
        from praisonaiui.features import auto_register_defaults

        auto_register_defaults()

    # ── Resolve tool functions from names ────────────────────────────
    _resolved_tools = []
    for tname in tool_names:
        if tname == "web_search":

            def web_search(query: str) -> str:
                """Search the web for a query."""
                return f"Results for '{query}': [simulated web results]"

            _resolved_tools.append(web_search)
        elif tname == "calculate":
            from praisonaiui.math_eval import eval_math_expression

            def calculate(expression: str) -> str:
                """Evaluate a math expression safely."""
                try:
                    result = eval_math_expression(expression)
                    return f"Result: {result}"
                except Exception as e:
                    return f"Error: {e}"

            _resolved_tools.append(calculate)

    # ── Lazy agent creation ──────────────────────────────────────────
    _agent_cache = {}

    def _get_agent():
        from praisonaiui.server import get_selected_profile

        # Use selected profile for agent resolution
        selected_profile_id = get_selected_profile()
        cache_key = f"agent:{selected_profile_id}" if selected_profile_id else "agent:default"

        if cache_key not in _agent_cache:
            try:
                from praisonaiagents import Agent
            except ImportError:
                raise ImportError(
                    "praisonaiagents package required for YAML chat. "
                    "Install with: pip install praisonai"
                )

            # Get profile-specific configuration
            profile_config = None
            if selected_profile_id and profiles:
                for profile in profiles:
                    if isinstance(profile, dict) and (profile.get("name") == selected_profile_id or profile.get("id") == selected_profile_id):
                        profile_config = profile
                        break

            # Use profile-specific instructions if available, otherwise use default
            effective_instructions = instructions
            effective_name = agent_name
            effective_model = model

            if profile_config:
                effective_instructions = profile_config.get("instructions") or instructions
                effective_name = profile_config.get("name") or agent_name
                effective_model = profile_config.get("model") or model

            agent_kwargs = {
                "name": effective_name,
                "instructions": effective_instructions,
            }
            if effective_model:
                agent_kwargs["model"] = effective_model
            if _resolved_tools:
                agent_kwargs["tools"] = _resolved_tools

            _agent_cache[cache_key] = Agent(**agent_kwargs)

            # Disable the Responses API on the OpenAI client so the Chat
            # Completions streaming path is used instead.  The Responses API
            # returns the full text at once and only emits FIRST_TOKEN[:50],
            # preventing real token-by-token streaming in the UI.
            _client = getattr(_agent_cache[cache_key], "_openai_client", None)
            if _client and not _client.base_url:
                _client.base_url = "https://api.openai.com/v1"
        return _agent_cache[cache_key]

    async def on_reply(msg):
        from praisonaiui.callbacks import _set_context

        _set_context(msg)
        try:
            agent = _get_agent()

            # Stream tokens via stream_emitter → aiui.stream_token()
            token_queue = asyncio.Queue()
            _has_streaming = False

            try:
                from praisonaiagents.streaming.events import StreamEventType

                _loop = asyncio.get_running_loop()

                def _on_stream_event(event):
                    if event.type == StreamEventType.DELTA_TEXT and event.content:
                        _loop.call_soon_threadsafe(token_queue.put_nowait, event.content)
                    elif event.type == StreamEventType.FIRST_TOKEN and event.content:
                        _loop.call_soon_threadsafe(token_queue.put_nowait, event.content)
                    elif event.type == StreamEventType.STREAM_END:
                        _loop.call_soon_threadsafe(token_queue.put_nowait, None)

                agent.stream_emitter.add_callback(_on_stream_event)
                _has_streaming = True
            except (ImportError, AttributeError):
                pass

            if _has_streaming:
                # Run chat in thread, drain tokens concurrently
                full_response = ""
                _chat_error = None
                _streamed_content = ""  # Track what was actually streamed

                async def _run_chat():
                    nonlocal full_response, _chat_error
                    try:
                        response = await asyncio.to_thread(agent.chat, str(msg), stream=True)
                        full_response = str(response)
                    except Exception as exc:
                        _chat_error = exc
                    finally:
                        await token_queue.put(None)

                chat_task = asyncio.create_task(_run_chat())

                while True:
                    try:
                        token = await asyncio.wait_for(token_queue.get(), timeout=120.0)
                    except asyncio.TimeoutError:
                        break
                    if token is None:
                        break
                    _streamed_content += token
                    await aiui.stream_token(token)

                await chat_task

                if _chat_error:
                    await aiui.say(f"Error: {_chat_error}")
                elif (
                    full_response
                    and len(_streamed_content.strip()) < len(full_response.strip()) * 0.8
                ):
                    # SDK stream_emitter only fired first_token (~50 chars)
                    # but agent.chat() returned the complete response.
                    # Send the full response as a message so the UI gets it.
                    await aiui.say(full_response)

                # Clean up callback
                try:
                    agent.stream_emitter.remove_callback(_on_stream_event)
                except Exception:
                    pass
            else:
                # Fallback: non-streaming
                response = await asyncio.to_thread(agent.chat, str(msg))
                await aiui.say(str(response))
        finally:
            _set_context(None)

    register_callback("reply", on_reply)

    # ── Starters ─────────────────────────────────────────────────────
    if starters:

        async def on_starters():
            return starters

        register_callback("starters", on_starters)

    # ── Profiles ─────────────────────────────────────────────────────
    if profiles:

        def on_profiles():
            return profiles

        register_callback("profiles", on_profiles)

    # ── Welcome ──────────────────────────────────────────────────────
    async def on_welcome():
        await aiui.say(welcome_msg)

    register_callback("welcome", on_welcome)

    # ── Goodbye ──────────────────────────────────────────────────────
    if goodbye_msg:

        async def on_goodbye():
            await aiui.say(goodbye_msg)

        register_callback("goodbye", on_goodbye)


@app.command()
def run(
    app_file: Path = typer.Argument(
        ...,
        help="Path to Python app file (e.g., app.py) or YAML chat config (e.g., chat.yaml)",
    ),
    config: Optional[Path] = typer.Option(
        None,
        "--config",
        "-c",
        help="Path to YAML configuration file (optional for chat mode)",
    ),
    port: int = typer.Option(
        8000,
        "--port",
        "-p",
        help="Port for server",
    ),
    host: str = typer.Option(
        "127.0.0.1",
        "--host",
        help="Host to bind to",
    ),
    reload: bool = typer.Option(
        False,
        "--reload",
        "-r",
        help="Enable auto-reload on file changes",
    ),
    output: Path = typer.Option(
        Path("aiui"),
        "--output",
        "-o",
        help="Output directory for built static files",
    ),
    backend: str = typer.Option(
        "standalone",
        "--backend",
        "-b",
        help="Backend mode: 'standalone' (default) or 'praisonai' (uses WebSocketGateway)",
    ),
    datastore: Optional[str] = typer.Option(
        None,
        "--datastore",
        "-d",
        help="Data persistence: 'sdk' (unified with praisonai-agents, default), 'json', 'memory', 'json:/path', or 'sdk:/path'. Overrides a chat YAML's datastore: key",
    ),
    style: Optional[str] = typer.Option(
        None,
        "--style",
        "-s",
        help="UI style: 'app' (default: the React app shell, Chat layout), 'chat' (classic chat), 'docs', 'agents' (tabbed multi-agent), 'playground' (input/output panels), 'dashboard', 'custom'",
    ),
) -> None:
    """Run the AI chat server with your app.py or config.yaml file.

    Example:
        aiui run app.py
        aiui run app.py --port 3000 --reload
        aiui run app.py --backend praisonai  # Use praisonai WebSocketGateway
        aiui run app.py --datastore json     # Persist sessions to ~/.praisonaiui/sessions/
        aiui run app.py --datastore json:/tmp/my-sessions  # Custom persistence path
        aiui run config.yaml                 # YAML-defined chat agent
    """
    import os

    if style is not None and style not in UI_STYLES:
        console.print(f"[red]Error:[/red] Unknown --style {style!r}. Choose one of: {', '.join(UI_STYLES)}")
        raise typer.Exit(code=2)

    # Validate app file exists
    if not app_file.exists():
        console.print(f"[red]Error:[/red] App file not found: {app_file}")
        raise typer.Exit(code=1)

    # Auto-load standard PraisonAI env files so `env:VAR` references (e.g. in
    # Channels config) resolve even when the shell did not export the tokens.
    # This matches the PraisonAI CLI convention and fixes the "Connected but
    # bot never replies" class of issues caused by empty env-resolved tokens.
    _loaded = _load_env_files()
    if _loaded:
        console.print(
            f"[green]{_icon('✓', 'OK')}[/green] Loaded {_loaded} environment "
            f"variable(s) from PraisonAI config"
        )

    is_yaml = app_file.suffix in (".yaml", ".yml")

    if is_yaml:
        # Load YAML chat configuration
        console.print(f"[yellow]{_icon('⏳', '...')}[/yellow] Loading {app_file}...")
        import yaml as _yaml

        with open(app_file, encoding="utf-8") as f:
            chat_yaml = _yaml.safe_load(f) or {}

        # Apply config from YAML; a --datastore flag wins over it.
        if datastore is None and chat_yaml.get("datastore"):
            datastore = str(chat_yaml["datastore"])

        if "style" in chat_yaml and chat_yaml["style"] not in UI_STYLES:
            # A warning, not an error: configs that ran before keep running.
            console.print(
                f"[yellow]Warning:[/yellow] Unknown style {chat_yaml['style']!r} in {app_file}. "
                f"Known styles: {', '.join(UI_STYLES)}"
            )
        for key in chat_yaml_unknown_keys(chat_yaml):
            console.print(
                f"[yellow]Warning:[/yellow] {app_file.name}: key {key!r} is not used by "
                "aiui run (ignored)"
            )
        style = _apply_chat_yaml(chat_yaml) or style
        is_chat_mode = True
    else:
        # Load the user's app module FIRST to register callbacks
        console.print(f"[yellow]{_icon('⏳', '...')}[/yellow] Loading {app_file}...")
        user_module = _load_user_module(app_file)
        if user_module is None:
            console.print(f"[red]Error:[/red] Could not load {app_file}")
            raise typer.Exit(code=1)

        # Check if app.py registered a @reply callback (chat mode)
        from praisonaiui.server import _callbacks

        is_chat_mode = "reply" in _callbacks or "on:reply" in _callbacks

        # ── Bootstrap Detection ───────────────────────────────────────
        # Auto-detect app type to determine optimal backend
        if backend == "standalone":  # Only auto-detect if not explicitly set
            if hasattr(user_module, 'main') and callable(getattr(user_module, 'main')):
                # Check if main function has async signature (gateway pattern)
                import inspect
                main_func = getattr(user_module, 'main')
                if inspect.iscoroutinefunction(main_func):
                    # Likely an AIUIGateway app - check for gateway imports
                    import ast
                    import inspect as _inspect
                    try:
                        source = _inspect.getsource(user_module)
                        tree = ast.parse(source)
                        for node in ast.walk(tree):
                            if isinstance(node, ast.ImportFrom) and node.module:
                                if any(alias.name == 'AIUIGateway' for alias in node.names) and 'integration' in node.module:
                                    console.print("[cyan]ℹ️[/cyan] Auto-detected gateway app, using praisonai backend")
                                    backend = "praisonai"
                                    break
                    except (OSError, TypeError, SyntaxError):
                        # If source inspection fails, continue with standalone
                        pass

    # ── Resolve final style ──────────────────────────────────────
    # Priority: CLI --style > YAML style > aiui.set_style() > auto-detect >
    # the app shell. Auto-detect only picks a style an app clearly asks for
    # (agents, dashboard pages); a plain chat app gets the app shell.
    from praisonaiui.server import detect_style, get_style

    if style is None:
        explicit = get_style()
        if explicit:
            style = explicit
        else:
            detected = detect_style()
            if detected != "chat":
                console.print(f"[cyan]ℹ️[/cyan] Auto-detected style: [bold]{detected}[/bold]")
                style = detected
            else:
                style = "app"
    if style == "app":
        # `aiui run` opens the chat without a canvas unless the app, its YAML
        # or AIUI_LAYOUT picks a layout.
        from praisonaiui.builtin.catalog import RUN_DEFAULT_LAYOUT
        from praisonaiui.layouts import set_run_default

        set_run_default(RUN_DEFAULT_LAYOUT)

    if os.environ.get("AIUI_SHELL", "").strip().lower() in ("app", "react") and style not in (
        "app",
        "dashboard",
    ):
        console.print(
            f"[yellow]Note:[/yellow] AIUI_SHELL=app is ignored for the {style!r} style "
            "(it only switches 'dashboard'); use --style app for the app shell."
        )

    # ── Resolve output directory relative to app file ──────────────
    # When using the default output ("aiui"), resolve it relative to the
    # app file's directory so `aiui run examples/foo/app.py` won't pick
    # up a stale build in CWD's ./aiui/ (which may be a docs site).
    if output == Path("aiui") and not is_yaml:
        app_parent = app_file.resolve().parent
        cwd = Path.cwd().resolve()
        if app_parent != cwd:
            output = app_parent / "aiui"

    # Build static files only if --config was explicitly provided
    if config is not None and config.exists():
        console.print(f"[yellow]{_icon('⏳', '...')}[/yellow] Building static files...")
        # The server serves the build at its root (no base path).
        build(config=config, output=output, minify=False, base_path="/")

    # Chat mode needs nothing on disk: the server serves the bundle from the
    # package and ui-config.json / route-manifest.json / docs-nav.json from
    # its own routes. (It used to recopy the whole bundle into ./aiui on every
    # start, 0.2-1 s and ~11 MB that were never served.)

    # Find available port
    try:
        actual_port = _find_available_port(host, port)
    except OSError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=4)

    if actual_port != port:
        console.print(_port_moved_message(host, port, actual_port))

    # Without --config a chat app has no built site; a ./aiui left by an older
    # version (a full bundle copy) must not shadow the package's files.
    has_site = config is not None and config.exists()
    static_dir = output if output.exists() and (has_site or not is_chat_mode) else None

    # Check backend mode
    if backend == "praisonai":
        # Use praisonai WebSocketGateway backend
        from praisonaiui.integration import AIUIGateway, check_praisonai_available

        if not check_praisonai_available():
            console.print(
                "[red]Error:[/red] praisonai package not installed. "
                "Install with: pip install praisonai"
            )
            raise typer.Exit(code=1)

        # Create gateway
        gateway = AIUIGateway(
            host=host,
            port=actual_port,
            static_dir=str(static_dir) if static_dir else None,
        )

        # Register agents from user module
        if hasattr(user_module, "agent"):
            gateway.register_agent(user_module.agent)
        elif hasattr(user_module, "agents"):
            for agent in user_module.agents:
                gateway.register_agent(agent)

        # Print startup info
        console.print(
            Panel(
                f"[bold green]AI Chat Server Running (praisonai backend)[/bold green]\n\n"
                f"🌐 HTTP: [link]http://{host}:{actual_port}[/link]\n"
                f"🔌 WebSocket: ws://{host}:{actual_port}/ws\n"
                f"📁 App: {app_file}\n"
                f"⚙️  Config: {config if config is not None and config.exists() else 'None'}",
                title="PraisonAIUI + PraisonAI",
                border_style="cyan",
            )
        )

        # Run gateway - check if user module defines its own main function
        import asyncio
        import inspect
        import os

        if hasattr(user_module, 'main') and callable(getattr(user_module, 'main')):
            # Call user's main function directly (gateway pattern)
            main_func = getattr(user_module, 'main')
            # Propagate CLI --port/--host to gateway examples that read the
            # PORT/HOST environment variables. Explicit env set by the user
            # takes precedence over the CLI flag.
            if "PORT" not in os.environ:
                os.environ["PORT"] = str(actual_port)
            if "HOST" not in os.environ:
                os.environ["HOST"] = host
            if inspect.iscoroutinefunction(main_func):
                console.print("[yellow]ℹ️[/yellow] Delegating to user-defined async main()")
                asyncio.run(main_func())
            else:
                console.print("[yellow]ℹ️[/yellow] Delegating to user-defined main()")
                main_func()
        else:
            asyncio.run(gateway.start())
    else:
        # Set up datastore (--datastore, else the YAML's, else the SDK store)
        datastore = datastore or "sdk"
        from praisonaiui.server import set_datastore

        try:
            store, datastore_label = _make_datastore(datastore)
        except ValueError:
            console.print(f"[red]Error:[/red] Unknown datastore: {datastore}")
            raise typer.Exit(code=1)
        datastore_requested = datastore
        datastore = datastore_label

        set_datastore(store)

        # Use standalone server (default)
        from praisonaiui.server import create_app
        from praisonaiui.server import set_style as _set_style

        # Pass the resolved style to the server module so the dynamic
        # /ui-config.json endpoint returns the correct style instead of
        # defaulting to "dashboard".
        _set_style(style)

        config_path = config if config is not None and config.exists() else None
        server_app = create_app(static_dir=static_dir, config_path=config_path)

        # Print startup info
        mode_label = style
        if config_path:
            config_label = f"{config} (build + server)"
        elif is_chat_mode:
            config_label = "None (chat mode from app.py)"
        else:
            config_label = "None"
        console.print(
            Panel(
                f"[bold green]AI Chat Server Running[/bold green]\n\n"
                f"🌐 URL: [link]http://{host}:{actual_port}[/link]\n"
                f"📁 App: {app_file}\n"
                f"🎨 Mode: {mode_label}\n"
                f"💾 DataStore: {datastore}\n"
                f"⚙️  Config: {config_label}\n"
                f"🔄 Reload: {'Enabled' if reload else 'Disabled'}",
                title="PraisonAIUI",
                border_style="green",
            )
        )

        import uvicorn

        if reload:
            # uvicorn can only reload an app it imports itself: hand it the
            # factory, which rebuilds this app (module, style, datastore,
            # static dir) in each worker from AIUI_RUN_SPEC.
            from praisonaiui._run_factory import SPEC_ENV, encode_spec

            os.environ[SPEC_ENV] = encode_spec(
                app_file=app_file,
                is_yaml=is_yaml,
                style=style,
                datastore=datastore_requested,
                static_dir=static_dir,
                config_path=config_path,
            )
            uvicorn.run(
                "praisonaiui._run_factory:create",
                factory=True,
                host=host,
                port=actual_port,
                log_level="info",
                reload=True,
                reload_dirs=[str(app_file.resolve().parent)],
            )
        else:
            uvicorn.run(
                server_app,
                host=host,
                port=actual_port,
                log_level="info",
            )


# ---------------------------------------------------------------------------
# Subcommands: sessions
# ---------------------------------------------------------------------------
sessions_app = typer.Typer(
    name="sessions",
    help="Manage chat sessions (list, create, get, delete, messages)",
    add_completion=False,
)
app.add_typer(sessions_app, name="sessions")


@sessions_app.command("list")
def sessions_list(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """List all sessions."""
    import json as _json
    from urllib.request import urlopen

    try:
        with urlopen(f"{server}/sessions") as resp:
            data = _json.loads(resp.read())
            sessions = data.get("sessions", [])
            if not sessions:
                console.print("[dim]No sessions found.[/dim]")
                return
            console.print(f"[bold]Sessions ({len(sessions)}):[/bold]")
            for s in sessions:
                console.print(
                    f"  • {s['id']}  "
                    f"[dim]{s.get('message_count', 0)} messages  "
                    f"{s.get('created_at', '?')}[/dim]"
                )
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)


@sessions_app.command("create")
def sessions_create(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Create a new session."""
    import json as _json
    from urllib.request import Request, urlopen

    try:
        req = Request(f"{server}/sessions", method="POST", data=b"")
        req.add_header("Content-Type", "application/json")
        with urlopen(req) as resp:
            data = _json.loads(resp.read())
            console.print(f"[green]✓[/green] Session created: {data.get('session_id')}")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)


@sessions_app.command("get")
def sessions_get(
    session_id: str = typer.Argument(..., help="Session ID"),
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Get session details."""
    import json as _json
    from urllib.request import urlopen

    try:
        with urlopen(f"{server}/sessions/{session_id}") as resp:
            data = _json.loads(resp.read())
            console.print_json(_json.dumps(data, indent=2))
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)


@sessions_app.command("delete")
def sessions_delete(
    session_id: str = typer.Argument(..., help="Session ID"),
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Delete a session."""
    import json as _json
    from urllib.request import Request, urlopen

    try:
        req = Request(f"{server}/sessions/{session_id}", method="DELETE")
        with urlopen(req) as resp:
            data = _json.loads(resp.read())
            console.print(f"[green]✓[/green] Session {session_id}: {data.get('status')}")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)


@sessions_app.command("messages")
def sessions_messages(
    session_id: str = typer.Argument(..., help="Session ID"),
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Get message history for a session."""
    import json as _json
    from urllib.request import urlopen

    try:
        with urlopen(f"{server}/sessions/{session_id}/runs") as resp:
            data = _json.loads(resp.read())
            runs = data.get("runs", [])
            if not runs:
                console.print("[dim]No messages in this session.[/dim]")
                return
            for msg in runs:
                role = msg.get("role", "?")
                content = msg.get("content", "")
                ts = msg.get("timestamp", "")
                color = "cyan" if role == "user" else "green"
                console.print(f"  [{color}]{role}[/{color}] {content}  [dim]{ts}[/dim]")
    except Exception as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Subcommand: health
# ---------------------------------------------------------------------------
@app.command("health-check")
def health_check(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
    detailed: bool = typer.Option(
        False,
        "--detailed",
        "-d",
        help="Show per-feature health",
    ),
) -> None:
    """Check server health."""
    import json as _json
    from urllib.request import urlopen

    from praisonaiui.health_utils import is_success_status

    try:
        with urlopen(f"{server}/health/live") as resp:
            data = _json.loads(resp.read())
            status = data.get("status", "unknown")
            ts = data.get("timestamp", "")
            if is_success_status(status):
                console.print(
                    Panel.fit(
                        f"Server: [green]{status}[/green] ({ts})",
                        title="Health Check",
                        border_style="green",
                    )
                )
            else:
                console.print(
                    Panel.fit(
                        f"Server: [yellow]{status}[/yellow] ({ts})",
                        title="Health Check",
                        border_style="yellow",
                    )
                )
    except Exception as e:
        console.print(f"[red]✗[/red] Server unreachable: {e}")
        raise typer.Exit(code=1)

    if detailed:
        try:
            features_data = _api_get(server, "/api/features")
            if features_data and "features" in features_data:
                console.print("\n[bold]Feature Health:[/bold]")
                for feat in features_data["features"]:
                    name = feat.get("name", "unknown")
                    health = feat.get("health", {})
                    healthy = health.get("healthy", True)
                    detail = health.get("detail", "ok")
                    icon = (
                        f"[green]{_icon('✅', '[OK]')}[/green]"
                        if healthy
                        else f"[yellow]{_icon('⚠️', '[WARNING]')}[/yellow]"
                    )
                    console.print(f"  {icon} {name}: {detail}")
        except Exception as e:
            console.print(
                f"[yellow]{_icon('⚠️', '[WARNING]')}[/yellow] Could not fetch feature health: {e}"
            )


# Register "health" as an alias for health-check (backward compatibility)
@app.command("health")
def health(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
    detailed: bool = typer.Option(
        False,
        "--detailed",
        "-d",
        help="Show per-feature health",
    ),
) -> None:
    """Check server health (alias for health-check)."""
    health_check(server=server, detailed=detailed)


# ---------------------------------------------------------------------------
# Subcommands: provider
# ---------------------------------------------------------------------------
provider_app = typer.Typer(
    name="provider",
    help="Inspect the active AI provider (status, health, agents)",
    add_completion=False,
)
app.add_typer(provider_app, name="provider")


@provider_app.command("status")
def provider_status(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Show active provider info and health."""
    import json as _json
    from urllib.request import urlopen

    from praisonaiui.health_utils import is_success_status

    try:
        with urlopen(f"{server}/api/provider") as resp:
            data = _json.loads(resp.read())
            console.print(f"[bold]Provider:[/bold] {data.get('name', 'unknown')}")
            console.print(f"[bold]Module:[/bold]   {data.get('module', 'unknown')}")
            status = data.get("status", "unknown")
            color = "green" if is_success_status(status) else "red"
            console.print(f"[bold]Status:[/bold]   [{color}]{status}[/{color}]")
            agents = data.get("agents", [])
            if agents:
                console.print(f"[bold]Agents:[/bold]   {len(agents)}")
                for a in agents:
                    console.print(f"  • {a.get('name', 'unnamed')}: {a.get('description', '')}")
            extra_keys = {
                k for k in data if k not in {"name", "module", "status", "agents", "provider"}
            }
            for k in sorted(extra_keys):
                console.print(f"[bold]{k}:[/bold] {data[k]}")
    except Exception as e:
        console.print(f"[red]✗[/red] Server unreachable: {e}")
        raise typer.Exit(code=1)


@provider_app.command("health")
def provider_health(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """Check provider health."""
    import json as _json
    from urllib.request import urlopen

    try:
        with urlopen(f"{server}/health/ready?deep=false") as resp:
            data = _json.loads(resp.read())
            provider = data.get("provider", {})
            console.print(f"[green]✓[/green] Provider: {provider.get('name', 'unknown')}")
            console.print(f"  Status: {provider.get('status', 'ok')}")
            if "praisonai_version" in provider:
                console.print(f"  PraisonAI: v{provider['praisonai_version']}")
    except Exception as e:
        console.print(f"[red]✗[/red] Server unreachable: {e}")
        raise typer.Exit(code=1)


@provider_app.command("agents")
def provider_agents(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL",
    ),
) -> None:
    """List agents from the active provider."""
    import json as _json
    from urllib.request import urlopen

    try:
        with urlopen(f"{server}/agents") as resp:
            data = _json.loads(resp.read())
            agents = data.get("agents", [])
            if not agents:
                console.print("[yellow]No agents registered[/yellow]")
            else:
                for a in agents:
                    console.print(f"  • {a.get('name', 'unnamed')}")
    except Exception as e:
        console.print(f"[red]✗[/red] Server unreachable: {e}")
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Feature CLI subcommands — protocol-driven, one group per feature
# ---------------------------------------------------------------------------
_SERVER_OPT = typer.Option("http://127.0.0.1:8000", "--server", "-s", help="Server URL")


def _api_get(server: str, path: str):
    """Helper: GET from server API."""
    import json as _json
    from urllib.request import urlopen

    with urlopen(f"{server}{path}") as resp:
        return _json.loads(resp.read())


def _api_post(server: str, path: str, body: dict = None):
    """Helper: POST to server API."""
    import json as _json
    from urllib.request import Request as UrlRequest
    from urllib.request import urlopen

    data = _json.dumps(body or {}).encode()
    req = UrlRequest(f"{server}{path}", data=data, headers={"Content-Type": "application/json"})
    with urlopen(req) as resp:
        return _json.loads(resp.read())


def _api_delete(server: str, path: str):
    """Helper: DELETE on server API."""
    import json as _json
    from urllib.request import Request as UrlRequest
    from urllib.request import urlopen

    req = UrlRequest(f"{server}{path}", method="DELETE")
    with urlopen(req) as resp:
        return _json.loads(resp.read())


def _api_patch(server: str, path: str, body: dict = None):
    """Helper: PATCH on server API."""
    import json as _json
    from urllib.request import Request as UrlRequest
    from urllib.request import urlopen

    data = _json.dumps(body or {}).encode()
    req = UrlRequest(
        f"{server}{path}", data=data, method="PATCH", headers={"Content-Type": "application/json"}
    )
    with urlopen(req) as resp:
        return _json.loads(resp.read())


# ── Features listing ─────────────────────────────────────────────────
features_app = typer.Typer(
    name="features", help="List all registered features", add_completion=False
)
app.add_typer(features_app, name="features")


@features_app.command("list")
def features_list(server: str = _SERVER_OPT) -> None:
    """List all registered protocol features."""
    from praisonaiui.health_utils import is_success_status

    try:
        data = _api_get(server, "/api/features")
        for f in data.get("features", []):
            h = f.get("health", {})
            status = h.get("status", "?")
            color = "green" if is_success_status(status) else "red"
            console.print(f"  [{color}]●[/{color}] {f['name']} — {f.get('description', '')}")
            if f.get("routes"):
                console.print(f"    routes: {', '.join(f['routes'])}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@features_app.command("status")
def features_status(server: str = _SERVER_OPT) -> None:
    """Show feature health summary."""
    from praisonaiui.health_utils import is_success_status

    try:
        data = _api_get(server, "/api/features")
        features = data.get("features", [])
        ok = sum(1 for f in features if is_success_status(f.get("health", {}).get("status")))
        console.print(f"Features: {ok}/{len(features)} healthy")
        for f in features:
            h = f.get("health", {})
            status = h.get("status", "?")
            color = "green" if is_success_status(status) else "red"
            console.print(f"  [{color}]●[/{color}] {f['name']}: {status}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Approvals ────────────────────────────────────────────────────────
approval_app = typer.Typer(
    name="approval", help="Manage tool-execution approvals", add_completion=False
)
app.add_typer(approval_app, name="approval")


@approval_app.command("list")
def approval_list(
    server: str = _SERVER_OPT,
    status: str = typer.Option("all", "--status", help="Filter: all, pending, resolved"),
) -> None:
    """List approvals."""
    try:
        data = _api_get(server, f"/api/approvals?status={status}")
        for a in data.get("approvals", []):
            console.print(f"  [{a['status']}] {a['id']} — {a.get('tool_name', '?')}")
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@approval_app.command("pending")
def approval_pending(server: str = _SERVER_OPT) -> None:
    """Show pending approval count."""
    try:
        data = _api_get(server, "/api/approvals?status=pending")
        console.print(f"Pending approvals: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@approval_app.command("resolve")
def approval_resolve(
    approval_id: str = typer.Argument(help="Approval ID to resolve"),
    approved: bool = typer.Option(True, "--approved/--denied", help="Approve or deny"),
    reason: str = typer.Option("", "--reason", help="Reason for decision"),
    server: str = _SERVER_OPT,
) -> None:
    """Resolve a pending approval."""
    try:
        data = _api_post(
            server,
            f"/api/approvals/{approval_id}/resolve",
            {"approved": approved, "reason": reason},
        )
        color = "green" if data.get("status") == "approved" else "red"
        console.print(f"[{color}]{data.get('status', '?')}[/{color}] — {approval_id}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Schedules ────────────────────────────────────────────────────────
schedule_app = typer.Typer(name="schedule", help="Manage scheduled jobs", add_completion=False)
app.add_typer(schedule_app, name="schedule")


@schedule_app.command("list")
def schedule_list(server: str = _SERVER_OPT) -> None:
    """List all scheduled jobs."""
    try:
        data = _api_get(server, "/api/schedules")
        for j in data.get("schedules", []):
            s = "✓" if j.get("enabled", True) else "✗"
            console.print(
                f"  [{s}] {j['id']} — {j.get('name', '?')} ({j.get('schedule', {}).get('kind', '?')})"
            )
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@schedule_app.command("add")
def schedule_add(
    name: str = typer.Argument(help="Job name"),
    message: str = typer.Argument(help="Message/payload"),
    every: int = typer.Option(60, "--every", help="Interval in seconds"),
    server: str = _SERVER_OPT,
) -> None:
    """Add a new scheduled job."""
    try:
        data = _api_post(
            server,
            "/api/schedules",
            {
                "name": name,
                "message": message,
                "schedule": {"kind": "every", "every_seconds": every},
            },
        )
        console.print(f"[green]✓[/green] Added job: {data.get('id')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@schedule_app.command("remove")
def schedule_remove(
    job_id: str = typer.Argument(help="Job ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Remove a scheduled job."""
    try:
        data = _api_delete(server, f"/api/schedules/{job_id}")
        console.print(f"[green]✓[/green] Deleted: {data.get('deleted')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@schedule_app.command("status")
def schedule_status(server: str = _SERVER_OPT) -> None:
    """Show scheduler status."""
    try:
        data = _api_get(server, "/api/schedules")
        total = data.get("count", 0)
        enabled = sum(1 for j in data.get("schedules", []) if j.get("enabled", True))
        console.print(f"Jobs: {total} total, {enabled} enabled")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Memory ───────────────────────────────────────────────────────────
memory_app = typer.Typer(name="memory", help="Manage agent memory", add_completion=False)
app.add_typer(memory_app, name="memory")


@memory_app.command("list")
def memory_list(
    server: str = _SERVER_OPT,
    memory_type: str = typer.Option(
        "all", "--type", help="Filter by type: short, long, entity, all"
    ),
) -> None:
    """List all memories."""
    try:
        data = _api_get(server, f"/api/memory?type={memory_type}")
        for m in data.get("memories", []):
            text = m.get("text", "")
            preview = text[:60] + "…" if len(text) > 60 else text
            console.print(f"  [{m.get('memory_type', '?')}] {m['id']} — {preview}")
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@memory_app.command("add")
def memory_add(
    text: str = typer.Argument(help="Memory text"),
    memory_type: str = typer.Option("long", "--type", help="Memory type"),
    server: str = _SERVER_OPT,
) -> None:
    """Add a memory entry."""
    try:
        data = _api_post(server, "/api/memory", {"text": text, "memory_type": memory_type})
        console.print(f"[green]✓[/green] Added memory: {data.get('id')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@memory_app.command("search")
def memory_search(
    query: str = typer.Argument(help="Search query"),
    limit: int = typer.Option(10, "--limit", help="Max results"),
    server: str = _SERVER_OPT,
) -> None:
    """Search memories."""
    try:
        data = _api_post(server, "/api/memory/search", {"query": query, "limit": limit})
        for m in data.get("results", []):
            console.print(f"  {m['id']} — {m.get('text', '')[:60]}")
        console.print(f"Results: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@memory_app.command("clear")
def memory_clear(
    memory_type: str = typer.Option("all", "--type", help="Type to clear (or 'all')"),
    server: str = _SERVER_OPT,
) -> None:
    """Clear memories."""
    try:
        data = _api_delete(server, f"/api/memory?type={memory_type}")
        console.print(f"[green]✓[/green] Cleared: {data.get('cleared', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@memory_app.command("status")
def memory_status(server: str = _SERVER_OPT) -> None:
    """Show memory status."""
    try:
        data = _api_get(server, "/api/memory")
        console.print(f"Total memories: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@memory_app.command("context")
def memory_context(
    query: str = typer.Argument(help="Query to get context for"),
    limit: int = typer.Option(5, "--limit", help="Max memories to include"),
    server: str = _SERVER_OPT,
) -> None:
    """Get memory context for a query (for prompt injection)."""
    try:
        data = _api_post(server, "/api/memory/context", {"query": query, "limit": limit})
        ctx = data.get("context", "")
        if ctx:
            console.print(ctx)
        else:
            console.print("[dim]No relevant memories found[/dim]")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Skills ───────────────────────────────────────────────────────────
skills_app = typer.Typer(name="skills", help="Manage agent skills", add_completion=False)
app.add_typer(skills_app, name="skills")


@skills_app.command("list")
def skills_list(server: str = _SERVER_OPT) -> None:
    """List all skills."""
    try:
        data = _api_get(server, "/api/skills")
        for s in data.get("skills", []):
            console.print(f"  {s['id']} — {s.get('name', '?')} (v{s.get('version', '?')})")
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@skills_app.command("status")
def skills_status(server: str = _SERVER_OPT) -> None:
    """Show skills status."""
    try:
        data = _api_get(server, "/api/skills")
        console.print(f"Total skills: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@skills_app.command("discover")
def skills_discover(server: str = _SERVER_OPT) -> None:
    """Discover available skills."""
    try:
        data = _api_post(server, "/api/skills/discover", {})
        for s in data.get("discovered", []):
            console.print(f"  {s.get('id', '?')} — {s.get('name', '?')}")
        console.print(f"Discovered: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Hooks ────────────────────────────────────────────────────────────
hooks_app = typer.Typer(name="hooks", help="Manage operation hooks", add_completion=False)
app.add_typer(hooks_app, name="hooks")


@hooks_app.command("list")
def hooks_list(server: str = _SERVER_OPT) -> None:
    """List all hooks."""
    try:
        data = _api_get(server, "/api/hooks")
        for h in data.get("hooks", []):
            console.print(
                f"  {h['id']} — {h.get('name', '?')} ({h.get('event', '?')}, {h.get('type', '?')})"
            )
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@hooks_app.command("trigger")
def hooks_trigger(
    hook_id: str = typer.Argument(help="Hook ID to trigger"),
    server: str = _SERVER_OPT,
) -> None:
    """Trigger a hook."""
    try:
        data = _api_post(server, f"/api/hooks/{hook_id}/trigger", {})
        console.print(
            f"[green]✓[/green] Triggered: {data.get('hook_id', hook_id)} → {data.get('result', '?')}"
        )
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@hooks_app.command("log")
def hooks_log(
    limit: int = typer.Option(20, "--limit", help="Number of log entries"),
    server: str = _SERVER_OPT,
) -> None:
    """Show hook execution log."""
    try:
        data = _api_get(server, f"/api/hooks/log?limit={limit}")
        for e in data.get("log", []):
            console.print(f"  {e.get('hook_id', '?')} — {e.get('result', '?')}")
        console.print(f"Entries: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Workflows ────────────────────────────────────────────────────────
workflows_app = typer.Typer(
    name="workflows", help="Manage multi-step workflows", add_completion=False
)
app.add_typer(workflows_app, name="workflows")


@workflows_app.command("list")
def workflows_list(server: str = _SERVER_OPT) -> None:
    """List all workflows."""
    try:
        data = _api_get(server, "/api/workflows")
        for w in data.get("workflows", []):
            console.print(f"  {w['id']} — {w.get('name', '?')} ({w.get('pattern', '?')})")
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@workflows_app.command("run")
def workflows_run(
    workflow_id: str = typer.Argument(help="Workflow ID to run"),
    server: str = _SERVER_OPT,
) -> None:
    """Run a workflow."""
    try:
        data = _api_post(server, f"/api/workflows/{workflow_id}/run", {})
        console.print(f"[green]✓[/green] {data.get('status', '?')} — run {data.get('id', '?')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@workflows_app.command("status")
def workflows_status(server: str = _SERVER_OPT) -> None:
    """Show workflow status."""
    try:
        data = _api_get(server, "/api/workflows")
        console.print(f"Workflows: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@workflows_app.command("runs")
def workflows_runs(server: str = _SERVER_OPT) -> None:
    """List workflow run history."""
    try:
        data = _api_get(server, "/api/workflows/runs")
        for r in data.get("runs", []):
            console.print(
                f"  {r['id']} — {r.get('workflow_name', r.get('workflow_id', '?'))} ({r.get('status', '?')})"
            )
        console.print(f"Total runs: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Config (runtime) ────────────────────────────────────────────────
config_app = typer.Typer(name="config", help="Manage runtime configuration", add_completion=False)
app.add_typer(config_app, name="config")


@config_app.command("get")
def config_get(
    key: str = typer.Argument("", help="Config key (empty = show all)"),
    server: str = _SERVER_OPT,
) -> None:
    """Get runtime config."""
    try:
        if key:
            data = _api_get(server, f"/api/config/runtime/{key}")
            console.print(f"{data.get('key')}: {data.get('value')}")
        else:
            data = _api_get(server, "/api/config/runtime")
            cfg = data.get("config", {})
            if not cfg:
                console.print("No runtime config set")
            else:
                for k, v in cfg.items():
                    console.print(f"  {k} = {v}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@config_app.command("set")
def config_set(
    key: str = typer.Argument(help="Config key"),
    value: str = typer.Argument(help="Config value"),
    server: str = _SERVER_OPT,
) -> None:
    """Set a runtime config value."""
    try:
        _api_patch(server, "/api/config/runtime", {key: value})
        console.print(f"[green]✓[/green] {key} = {value}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@config_app.command("list")
def config_list(server: str = _SERVER_OPT) -> None:
    """List all runtime config keys."""
    try:
        data = _api_get(server, "/api/config/runtime")
        cfg = data.get("config", {})
        for k in sorted(cfg.keys()):
            console.print(f"  {k}")
        console.print(f"Keys: {len(cfg)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@config_app.command("history")
def config_history(
    limit: int = typer.Option(20, "--limit", help="Number of entries"),
    server: str = _SERVER_OPT,
) -> None:
    """Show config change history."""
    try:
        data = _api_get(server, f"/api/config/runtime/history?limit={limit}")
        for e in data.get("history", []):
            console.print(f"  {e.get('key', '?')}: {e.get('old')} → {e.get('new')}")
        console.print(f"Entries: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Sessions Ext ─────────────────────────────────────────────────────
session_ext_app = typer.Typer(
    name="session-ext",
    help="Extended session operations (state, labels, usage)",
    add_completion=False,
)
app.add_typer(session_ext_app, name="session-ext")


@session_ext_app.command("state")
def session_ext_state(
    session_id: str = typer.Argument("default", help="Session ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Get session state."""
    try:
        data = _api_get(server, f"/api/sessions/{session_id}/state")
        state = data.get("state", {})
        if not state:
            console.print(f"[dim]No state for session {session_id}[/dim]")
        else:
            console.print(f"[bold]Session {session_id} state:[/bold]")
            for k, v in state.items():
                if not k.startswith("_"):
                    console.print(f"  {k} = {v}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@session_ext_app.command("save-state")
def session_ext_save_state(
    session_id: str = typer.Argument("default", help="Session ID"),
    key: str = typer.Option(..., "--key", "-k", help="State key"),
    value: str = typer.Option(..., "--value", "-v", help="State value"),
    server: str = _SERVER_OPT,
) -> None:
    """Save key=value to session state."""
    try:
        _api_post(server, f"/api/sessions/{session_id}/state", {"state": {key: value}})
        console.print(f"[green]✓[/green] Saved {key}={value} to session {session_id}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@session_ext_app.command("labels")
def session_ext_labels(
    session_id: str = typer.Argument("default", help="Session ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Get session labels."""
    try:
        data = _api_get(server, f"/api/sessions/{session_id}/labels")
        labels = data.get("labels", [])
        if not labels:
            console.print(f"[dim]No labels for session {session_id}[/dim]")
        else:
            console.print(f"Labels: {', '.join(labels)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@session_ext_app.command("usage")
def session_ext_usage(
    session_id: str = typer.Argument("default", help="Session ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Get session usage stats."""
    try:
        data = _api_get(server, f"/api/sessions/{session_id}/usage")
        usage = data.get("usage", {})
        console.print(
            f"Session {session_id}: {usage.get('tokens', 0)} tokens, {usage.get('requests', 0)} requests"
        )
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@session_ext_app.command("compact")
def session_ext_compact(
    session_id: str = typer.Argument("default", help="Session ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Compact session context."""
    try:
        _api_post(server, f"/api/sessions/{session_id}/compact", {})
        console.print(f"[green]✓[/green] Session {session_id} compacted")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@session_ext_app.command("reset")
def session_ext_reset(
    session_id: str = typer.Argument("default", help="Session ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Reset session state."""
    try:
        _api_post(server, f"/api/sessions/{session_id}/reset", {"mode": "clear"})
        console.print(f"[green]✓[/green] Session {session_id} reset")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Eval ─────────────────────────────────────────────────────────────
eval_app = typer.Typer(
    name="eval", help="Manage agent evaluations (list, scores, judges, run)", add_completion=False
)
app.add_typer(eval_app, name="eval")


@eval_app.command("status")
def eval_status(server: str = _SERVER_OPT) -> None:
    """Show eval status and judge count."""
    try:
        data = _api_get(server, "/api/eval/status")
        console.print(f"Provider: {data.get('provider', '?')}")
        console.print(f"Total evaluations: {data.get('total_evaluations', 0)}")
        console.print(f"Active judges: {data.get('active_judges', 0)}")
        if data.get("sdk_available"):
            console.print(f"SDK: available ({', '.join(data.get('evaluator_classes', []))})")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@eval_app.command("list")
def eval_list(
    limit: int = typer.Option(20, "--limit", help="Max results"),
    agent_id: str = typer.Option("", "--agent-id", help="Filter by agent"),
    server: str = _SERVER_OPT,
) -> None:
    """List recent evaluations."""
    try:
        path = f"/api/eval?limit={limit}"
        if agent_id:
            path += f"&agent_id={agent_id}"
        data = _api_get(server, path)
        for ev in data.get("evaluations", []):
            score = ev.get("score", "—")
            passed = "✓" if ev.get("passed") else ("✗" if ev.get("passed") is False else "—")
            console.print(
                f"  [{ev.get('id', '')}] agent={ev.get('agent_id', '?')} score={score} passed={passed}"
            )
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@eval_app.command("scores")
def eval_scores(server: str = _SERVER_OPT) -> None:
    """Show aggregated scores by agent."""
    try:
        data = _api_get(server, "/api/eval/scores")
        scores = data.get("scores", [])
        if not scores:
            console.print("[dim]No scores yet — run some evaluations first.[/dim]")
            return
        for s in scores:
            avg = f"{s['avg_score']:.2f}" if s.get("avg_score") is not None else "—"
            console.print(f"  {s['agent_id']}: avg={avg} passed={s['passed']}/{s['total']}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@eval_app.command("judges")
def eval_judges(server: str = _SERVER_OPT) -> None:
    """List registered judges."""
    try:
        data = _api_get(server, "/api/eval/judges")
        judges = data.get("judges", [])
        if not judges:
            console.print("[dim]No judges registered.[/dim]")
            return
        for j in judges:
            console.print(f"  {j.get('name', '?')} (source={j.get('source', '?')})")
        console.print(f"Total: {len(judges)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@eval_app.command("run")
def eval_run(
    input_text: str = typer.Option(..., "--input", help="Input text"),
    output_text: str = typer.Option(..., "--output", help="Output text"),
    expected: str = typer.Option("", "--expected", help="Expected text"),
    agent_id: str = typer.Option("cli", "--agent-id", help="Agent ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Run an evaluation."""
    try:
        data = _api_post(
            server,
            "/api/eval/run",
            {
                "agent_id": agent_id,
                "input": input_text,
                "output": output_text,
                "expected": expected,
            },
        )
        result = data.get("result", {})
        score = result.get("score", "—")
        passed = "✓" if result.get("passed") else ("✗" if result.get("passed") is False else "—")
        console.print(
            f"[green]✓[/green] Evaluation {result.get('id', '?')}: score={score} passed={passed}"
        )
        console.print(f"  Feedback: {result.get('feedback', '—')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Traces ───────────────────────────────────────────────────────────
traces_app = typer.Typer(
    name="traces", help="Manage distributed traces (list, spans, get)", add_completion=False
)
app.add_typer(traces_app, name="traces")


@traces_app.command("status")
def traces_status(server: str = _SERVER_OPT) -> None:
    """Show tracing status."""
    try:
        data = _api_get(server, "/api/traces/status")
        console.print(f"Provider: {data.get('provider', '?')}")
        console.print(f"Total traces: {data.get('total_traces', 0)}")
        console.print(f"Total spans: {data.get('total_spans', 0)}")
        if "trace_available" in data:
            console.print(f"SDK trace: {'available' if data['trace_available'] else 'unavailable'}")
        if "obs_available" in data:
            console.print(f"SDK obs: {'available' if data['obs_available'] else 'unavailable'}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@traces_app.command("list")
def traces_list(
    limit: int = typer.Option(20, "--limit", help="Max results"),
    server: str = _SERVER_OPT,
) -> None:
    """List recent traces."""
    try:
        data = _api_get(server, f"/api/traces?limit={limit}")
        traces = data.get("traces", [])
        if not traces:
            console.print("[dim]No traces recorded yet.[/dim]")
            return
        for t in traces:
            console.print(
                f"  [{t.get('id', '')}] {t.get('name', '')} "
                f"status={t.get('status', '?')} {t.get('duration_ms', 0)}ms "
                f"spans={t.get('span_count', 0)}"
            )
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@traces_app.command("spans")
def traces_spans(
    limit: int = typer.Option(20, "--limit", help="Max results"),
    trace_id: str = typer.Option("", "--trace-id", help="Filter by trace ID"),
    server: str = _SERVER_OPT,
) -> None:
    """List recent spans."""
    try:
        path = f"/api/traces/spans?limit={limit}"
        if trace_id:
            path += f"&trace_id={trace_id}"
        data = _api_get(server, path)
        spans = data.get("spans", [])
        if not spans:
            console.print("[dim]No spans recorded yet.[/dim]")
            return
        for s in spans:
            console.print(
                f"  [{s.get('id', '')}] {s.get('name', '')} kind={s.get('kind', '?')} {s.get('duration_ms', 0)}ms"
            )
        console.print(f"Total: {data.get('count', 0)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@traces_app.command("get")
def traces_get(
    trace_id: str = typer.Argument(help="Trace ID"),
    server: str = _SERVER_OPT,
) -> None:
    """Get a specific trace by ID."""
    try:
        data = _api_get(server, f"/api/traces/{trace_id}")
        trace = data.get("trace", {})
        spans = data.get("spans", [])
        console.print(f"[bold]Trace: {trace.get('id', '')}[/bold]")
        console.print(f"  Agent: {trace.get('agent_id', '?')}")
        console.print(f"  Name: {trace.get('name', '')}")
        console.print(f"  Status: {trace.get('status', '?')}")
        console.print(f"  Duration: {trace.get('duration_ms', 0)}ms")
        console.print(f"  Spans ({len(spans)}):")
        for s in spans:
            console.print(
                f"    [{s.get('id', '')}] {s.get('name', '')} {s.get('duration_ms', 0)}ms"
            )
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Pages ────────────────────────────────────────────────────────────
pages_app = typer.Typer(name="pages", help="Manage sidebar pages (list, ids)", add_completion=False)
app.add_typer(pages_app, name="pages")


# ── Surfaces (A2UI canvas) ───────────────────────────────────────────
surface_app = typer.Typer(
    name="surface", help="Manage A2UI surfaces (agent canvas)", add_completion=False
)
app.add_typer(surface_app, name="surface")


@surface_app.command("list")
def surface_list(server: str = _SERVER_OPT) -> None:
    """List all surfaces."""
    try:
        data = _api_get(server, "/api/surfaces")
        surfaces = data.get("surfaces", [])
        if not surfaces:
            console.print("[dim]No surfaces yet (empty canvas is normal).[/dim]")
            return
        for s in surfaces:
            console.print(
                f"  {s.get('id', '?')} — {s.get('message_count', 0)} message(s)"
            )
        console.print(f"Total: {len(surfaces)}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@surface_app.command("get")
def surface_get(
    surface_id: str = typer.Argument("main", help="Surface id"),
    server: str = _SERVER_OPT,
    as_json: bool = typer.Option(False, "--json", help="Print raw JSON"),
) -> None:
    """Get surface messages (empty list if not created yet)."""
    import json as _json

    try:
        data = _api_get(server, f"/api/surfaces/{surface_id}")
        if as_json:
            console.print(_json.dumps(data, indent=2))
            return
        messages = data.get("messages") or []
        console.print(f"Surface: {data.get('id', surface_id)}")
        console.print(f"Messages: {len(messages)}")
        if messages:
            console.print(_json.dumps(messages, indent=2))
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@surface_app.command("push")
def surface_push(
    surface_id: str = typer.Argument("main", help="Surface id"),
    file: Path = typer.Option(..., "--file", "-f", help="JSON file: {messages: [...]}"),
    replace: bool = typer.Option(False, "--replace", help="Replace instead of append"),
    server: str = _SERVER_OPT,
) -> None:
    """Push A2UI messages to a surface (same as POST /api/surfaces/{id}/messages)."""
    import json as _json

    try:
        body = _json.loads(file.read_text(encoding="utf-8"))
        if "messages" not in body:
            raise typer.BadParameter("JSON file must contain a 'messages' array")
        if replace:
            body["replace"] = True
        data = _api_post(server, f"/api/surfaces/{surface_id}/messages", body)
        console.print(
            f"[green]✓[/green] Pushed to {data.get('id', surface_id)} "
            f"({data.get('message_count', '?')} message(s))"
        )
    except typer.BadParameter:
        raise
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@surface_app.command("clear")
def surface_clear(
    surface_id: str = typer.Argument("main", help="Surface id"),
    server: str = _SERVER_OPT,
) -> None:
    """Delete a surface (same as DELETE /api/surfaces/{id})."""
    try:
        data = _api_delete(server, f"/api/surfaces/{surface_id}")
        console.print(f"[green]✓[/green] Cleared surface: {data.get('id', surface_id)}")
    except Exception as e:
        err = str(e)
        if "404" in err:
            console.print(f"[yellow]![/yellow] Surface '{surface_id}' not found (already empty)")
            return
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@surface_app.command("status")
def surface_status(server: str = _SERVER_OPT) -> None:
    """Show surface feature status."""
    try:
        data = _api_get(server, "/api/surfaces")
        surfaces = data.get("surfaces", [])
        total_msgs = sum(s.get("message_count", 0) for s in surfaces)
        console.print(f"Surfaces: {len(surfaces)}")
        console.print(f"Total messages: {total_msgs}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@pages_app.command("list")
def pages_list(server: str = _SERVER_OPT) -> None:
    """List all registered sidebar pages."""
    try:
        data = _api_get(server, "/api/pages")
        pages = data.get("pages", [])
        if not pages:
            console.print("[dim]No pages registered.[/dim]")
            return
        current_group = ""
        for p in pages:
            group = p.get("group", "Other")
            if group != current_group:
                console.print(f"\n[bold]{group}[/bold]")
                current_group = group
            console.print(
                f"  {p.get('icon', '📄')} {p.get('title', p.get('id', '?')):20s} "
                f"id={p.get('id', '?'):15s} order={p.get('order', 100)}"
            )
        console.print(f"\nTotal: {len(pages)} pages")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@pages_app.command("ids")
def pages_ids(server: str = _SERVER_OPT) -> None:
    """Print all page IDs (useful for aiui.set_pages() whitelist)."""
    try:
        data = _api_get(server, "/api/pages")
        pages = data.get("pages", [])
        ids = [p.get("id", "?") for p in pages]
        console.print(", ".join(ids))
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Doctor command — ``aiui doctor`` structured diagnostics
# ---------------------------------------------------------------------------


@app.command()
def doctor(
    server: str = typer.Option(
        "http://127.0.0.1:8000",
        "--server",
        "-s",
        help="Server URL to diagnose",
    ),
    json_output: bool = typer.Option(
        False,
        "--json",
        help="Output results as JSON",
    ),
):
    """Run structured diagnostics against a running AIUI server."""
    import json as _json

    checks = []

    def _check(name: str, path: str, extractor=None):
        """Run a single diagnostic check."""
        try:
            data = _api_get(server, path)
            if extractor:
                status, detail = extractor(data)
            else:
                status, detail = "pass", "ok"
            return {"name": name, "status": status, "detail": detail}
        except Exception as e:
            return {"name": name, "status": "fail", "detail": str(e)}

    # Check 1: Server Health
    from praisonaiui.health_utils import is_success_status

    def _health_extractor(data):
        status = data.get("status", "unknown")
        if is_success_status(status):
            return "pass", f"running on {server.split('://')[-1]}"
        return "warn", f"status: {status}"

    checks.append(_check("Server Health", "/health/live", _health_extractor))

    # Check 2: Provider Status
    def _provider_extractor(data):
        name = data.get("name", "unknown")
        return "pass", f"{name} (active)"

    checks.append(_check("Provider Status", "/api/provider", _provider_extractor))

    # Check 3: Gateway Status
    def _gateway_extractor(data):
        status = data.get("status", "unknown")
        provider_type = data.get("provider", data.get("name", "unknown"))
        agents_list = data.get("agents", [])
        agent_count = len(agents_list) if isinstance(agents_list, list) else 0
        check_status = "pass" if status in ("ok", "healthy") else "warn"
        return check_status, f"{provider_type} ({agent_count} agents)"

    checks.append(_check("Gateway Status", "/api/provider", _gateway_extractor))

    # Check 4: Features Loaded
    def _features_extractor(data):
        features = data.get("features", [])
        count = len(features)
        return "pass", f"{count}/37 features registered"

    checks.append(_check("Features Loaded", "/api/features", _features_extractor))

    # Check 5: Config Store
    def _config_extractor(data):
        if "config" in data or "error" not in data:
            return "pass", "config store active"
        return "warn", data.get("error", "unknown")

    checks.append(_check("Config Store", "/api/config", _config_extractor))

    # Check 6: Datastore
    def _datastore_extractor(data):
        sessions = data if isinstance(data, list) else data.get("sessions", [])
        count = len(sessions)
        return "pass", f"JSONFileDataStore ({count} sessions)"

    checks.append(_check("Datastore", "/sessions", _datastore_extractor))

    # Check 7: Channels
    def _channels_extractor(data):
        channels = data.get("channels", [])
        if not channels:
            return "warn", "no channels configured"
        active = sum(1 for c in channels if c.get("enabled", True))
        return "pass", f"{active}/{len(channels)} channels active"

    checks.append(_check("Channels", "/api/channels", _channels_extractor))

    # Calculate summary
    passed = sum(1 for c in checks if c["status"] == "pass")
    warnings = sum(1 for c in checks if c["status"] == "warn")
    failed = sum(1 for c in checks if c["status"] == "fail")

    if json_output:
        result = {
            "checks": checks,
            "summary": {"passed": passed, "warnings": warnings, "failed": failed},
        }
        console.print(_json.dumps(result, indent=2))
        return

    # Rich formatted output
    console.print()
    console.print(
        Panel.fit(
            "[bold cyan]AIUI Doctor — Instance Diagnostic[/bold cyan]",
            border_style="cyan",
        )
    )
    console.print()

    status_icons = {
        "pass": f"[green]{_icon('✅', '[PASS]')}[/green]",
        "warn": f"[yellow]{_icon('⚠️', '[WARN]')}[/yellow]",
        "fail": f"[red]{_icon('❌', '[FAIL]')}[/red]",
    }

    arrow = _icon("▶", ">")
    border = _icon("═", "=") * 43
    for i, check in enumerate(checks, 1):
        icon = status_icons.get(check["status"], _icon("❓", "[?]"))
        console.print(f"{arrow} {i}. {check['name']:20} {icon} {check['detail']}")

    console.print()
    console.print(border)
    console.print(
        f"  SUMMARY: [green]{passed} passed[/green], [yellow]{warnings} warning{'s' if warnings != 1 else ''}[/yellow], [red]{failed} failed[/red]"
    )
    console.print(border)

    if failed > 0:
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# UI plugins — ``aiui plugins list|doctor`` (entry-point group praisonaiui.plugins)
# ---------------------------------------------------------------------------


class _PluginsGroup(typer.core.TyperGroup):
    """``aiui plugins <name> …`` also reaches a plugin's own CLI."""

    def get_command(self, ctx, cmd_name):  # type: ignore[override]
        cmd = super().get_command(ctx, cmd_name)
        if cmd is None:
            cmd = _plugin_cli_command(cmd_name)
        return cmd


plugins_app = typer.Typer(
    name="plugins",
    help=(
        "Inspect UI plugins (Python packages declaring the 'praisonaiui.plugins' entry point). "
        "A plugin's own commands run as 'aiui <plugin> ...' or 'aiui plugins <plugin> ...'."
    ),
    add_completion=False,
    cls=_PluginsGroup,
)
app.add_typer(plugins_app, name="plugins")

_PLUGIN_NAME_OK = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _load_extensions_policy(config: Optional[Path]) -> Any:
    """Apply ``extensions:`` from a YAML config, as the server would.

    Returns the section (None without one) so a later ``create_app`` in the
    same command can be given the same policy.
    """
    if config is None:
        return None
    import yaml

    from praisonaiui.plugin_registry import get_plugin_registry
    from praisonaiui.schema.loader import ConfigLoadError, load_config_file

    try:
        data = load_config_file(config) or {}
    except (OSError, yaml.YAMLError, ConfigLoadError) as exc:
        console.print(f"[red]Error:[/red] cannot read {config}: {exc}")
        raise typer.Exit(code=2)
    section = data.get("extensions") if isinstance(data, dict) else None
    if section is not None:
        get_plugin_registry().apply_config(section)
    return section


def _builtin_records(config: Optional[Path]) -> list:
    """The first-party plugin records (``builtin.<name>``) under the policy.

    Built-ins are part of the package, never entry points, so they are listed
    even with plugin autoload disabled.
    """
    from praisonaiui.builtin import register_builtin_plugins
    from praisonaiui.plugin_registry import get_plugin_registry

    registry = get_plugin_registry()
    register_builtin_plugins(registry)
    _load_extensions_policy(config)
    return registry.builtin_records()


def _builtin_pages_by_id(records: list) -> dict[str, str]:
    """Page id -> the ``builtin.<name>`` record that contributes it."""
    out: dict[str, str] = {}
    for rec in records:
        specs: list = []
        # pages() is the page table; shell_pages() the app-shell-only layout
        # pages (ADR 0003), so `aiui plugins` shows their owning record too.
        for name in ("pages", "shell_pages"):
            hook = getattr(rec.plugin, name, None)
            try:
                specs += list(hook() or ()) if callable(hook) else []
            except Exception:  # noqa: BLE001 - diagnostics only
                pass
        for spec in specs:
            pid = _spec_get(spec, "id")
            if pid:
                out.setdefault(str(pid), rec.name)
    return out


def _builtin_row(rec) -> dict:
    row = _plugin_record_dict(rec)
    row["required"] = bool(getattr(rec, "required", False))
    row["description"] = getattr(rec.plugin, "description", "") or ""
    row["pages"] = sorted(_builtin_pages_by_id([rec]))
    return row


def _plugin_record_dict(rec) -> dict:
    to_dict = getattr(rec, "to_dict", None)
    if callable(to_dict):
        return dict(to_dict())
    return {
        "name": rec.name,
        "entryPoint": getattr(rec, "entry_point", None),
        "dist": getattr(rec, "dist", None),
        "version": getattr(rec, "version", None),
        "status": rec.status,
        **({"error": rec.error} if getattr(rec, "error", None) else {}),
    }


def _installed_plugin_entry_points() -> list[dict]:
    """Entry-point metadata only (no import), for when autoload is disabled."""
    from importlib.metadata import entry_points

    out = []
    for ep in entry_points(group=PLUGIN_ENTRY_POINT_GROUP):
        dist = getattr(ep, "dist", None)
        out.append(
            {
                "name": ep.name,
                "entryPoint": ep.value,
                "dist": getattr(dist, "name", None),
                "version": getattr(dist, "version", None),
                "status": "not loaded",
            }
        )
    return out


def _discover_plugins(config: Optional[Path]) -> tuple[list, list[dict]]:
    """(records, rows). Records are empty when autoload is disabled."""
    if _plugin_autoload_disabled():
        return [], _installed_plugin_entry_points()
    from praisonaiui.plugin_registry import get_plugin_registry

    _load_extensions_policy(config)
    records = get_plugin_registry().discover(refresh=True)
    return records, [_plugin_record_dict(r) for r in records]


_STATUS_STYLE = {
    "ok": "green",
    "error": "red",
    "incompatible": "red",
    "disabled": "dim",
    "disabled-by-default": "yellow",
    "not loaded": "dim",
}


@plugins_app.command("list")
def plugins_list(
    json_output: bool = typer.Option(False, "--json", help="Print JSON instead of a table"),
    config: Optional[Path] = typer.Option(
        None, "--config", "-c", help="Apply the 'extensions:' policy from this YAML config"
    ),
) -> None:
    """List installed UI plugins with their version, status and load error."""
    import json as _json

    from rich.table import Table

    _records, rows = _discover_plugins(config)
    builtin_rows = [_builtin_row(rec) for rec in _builtin_records(config)]
    if json_output:
        print(
            _json.dumps(
                {
                    "plugins": rows,
                    "builtins": builtin_rows,
                    "autoload": not _plugin_autoload_disabled(),
                },
                indent=2,
            )
        )
        return
    if builtin_rows:
        btable = Table(title="Built-in plugins (extensions.disabled: builtin.<name>)", show_lines=False)
        btable.add_column("Name", style="bold")
        btable.add_column("Status")
        btable.add_column("Required")
        btable.add_column("Pages", overflow="fold")
        for row in builtin_rows:
            status = str(row.get("status"))
            style = _STATUS_STYLE.get(status, "")
            btable.add_row(
                str(row.get("name")),
                f"[{style}]{status}[/{style}]" if style else status,
                "yes" if row.get("required") else "",
                ", ".join(row.get("pages") or []) or "-",
            )
        console.print(btable)
        if any(r.get("required") and r.get("status") == "disabled" for r in builtin_rows):
            console.print(
                "[dim]A disabled built-in marked required keeps the features the host "
                "needs; only its pages and optional features are off.[/dim]"
            )
    if _plugin_autoload_disabled():
        console.print(
            f"[yellow]Plugin autoload is disabled ({PLUGIN_AUTOLOAD_ENV}=1): "
            "entry points are listed but not imported.[/yellow]"
        )
    if not rows:
        console.print(
            "No UI plugins installed. A plugin is a Python package that declares the "
            f"'{PLUGIN_ENTRY_POINT_GROUP}' entry point (see docs/features/plugins.md)."
        )
        return
    table = Table(title="UI plugins", show_lines=False)
    table.add_column("Name", style="bold")
    table.add_column("Version")
    table.add_column("Status")
    table.add_column("Package / entry point", overflow="fold")
    table.add_column("Error", overflow="fold")
    for row in rows:
        status = str(row.get("status"))
        style = _STATUS_STYLE.get(status, "")
        source = " / ".join(str(x) for x in (row.get("dist"), row.get("entryPoint")) if x)
        table.add_row(
            str(row.get("name")),
            str(row.get("version") or "-"),
            f"[{style}]{status}[/{style}]" if style else status,
            source,
            str(row.get("error") or ""),
        )
    console.print(table)


def _spec_get(spec, key: str):
    if isinstance(spec, dict):
        camel = key.split("_")[0] + "".join(p.title() for p in key.split("_")[1:])
        return spec.get(key, spec.get(camel))
    return getattr(spec, key, None)


def _sri_sha384(path: Path) -> str:
    import base64
    import hashlib

    return "sha384-" + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode()


def _builtin_page_ids(extensions: Any = None) -> Optional[set[str]]:
    """Page ids the server registers on its own (app + built-in), or None.

    ``extensions`` is the YAML policy, so a ``builtin.<name>`` it disables
    contributes no ids.
    """
    import contextlib
    import io
    import logging as _logging

    try:
        import praisonaiui.server as _srv

        previous = _logging.root.manager.disable
        _logging.disable(_logging.WARNING)
        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                _srv.create_app(config={"extensions": extensions} if extensions is not None else None)
        finally:
            _logging.disable(previous)
        return set(_srv._pages)
    except Exception:  # noqa: BLE001 - diagnostics only
        return None


def _doctor_plugin(rec, static_files: dict, findings: list) -> dict:
    """Check one loaded plugin. Appends (level, plugin, check, detail) findings."""

    from praisonaiui.plugin_registry import (
        _resolve_layout,
        _resolve_nav_group,
        _resolve_page,
        _resolve_settings_section,
        _resolve_theme,
    )

    def add(level: str, check: str, detail: str) -> None:
        findings.append((level, rec.name, check, detail))

    plugin = rec.plugin
    contributed: dict = {"pages": [], "blocks": [], "tools": []}

    # sdk gate (incompatible plugins never get here)
    try:
        from praisonaiui.plugin_registry import SDK_API_VERSION
    except ImportError:  # pragma: no cover
        SDK_API_VERSION = 1
    add("ok", "sdk", f"targets SDK v{getattr(plugin, 'sdk', SDK_API_VERSION)} (host v{SDK_API_VERSION})")

    # static_dir
    root: Optional[Path] = None
    hook = getattr(plugin, "static_dir", None)
    if callable(hook):
        try:
            raw = hook()
        except Exception as exc:  # noqa: BLE001
            add("error", "static_dir", f"static_dir() raised {type(exc).__name__}: {exc}")
            raw = None
        if raw:
            root = Path(raw).resolve()
            if root.is_dir():
                add("ok", "static_dir", f"{root} → /_plugins/{rec.name}/")
                static_files[rec.name] = root
            else:
                add("error", "static_dir", f"{root} is not a directory")
                root = None

    def check_asset(kind: str, ident: str, module, integrity) -> None:
        if not module:
            return
        module = str(module)
        if module.startswith(("http://", "https://")):
            add("warn", kind, f"{ident}: loads a remote module {module} (no SRI check possible here)")
            return
        if module.startswith("/"):
            add("ok", kind, f"{ident}: absolute module path {module}")
            return
        if root is None:
            add("error", kind, f"{ident}: relative module {module!r} but the plugin has no static_dir()")
            return
        target = (root / module).resolve()
        if root not in target.parents:
            add("error", kind, f"{ident}: module path {module!r} escapes static_dir")
            return
        if not target.is_file():
            add("error", kind, f"{ident}: {module} not found in {root}")
            return
        actual = _sri_sha384(target)
        if integrity and integrity != actual:
            add("error", kind, f"{ident}: integrity mismatch for {module} (declared {integrity}, file {actual})")
        else:
            add("ok", kind, f"{ident}: /_plugins/{rec.name}/{module} ({actual[:20]}…)")

    for hook_name, kind in (("pages", "pages"), ("blocks", "blocks"), ("tool_renderers", "tools")):
        hook = getattr(plugin, hook_name, None)
        if not callable(hook):
            continue
        try:
            specs = list(hook() or ())
        except Exception as exc:  # noqa: BLE001
            add("error", hook_name, f"{hook_name}() raised {type(exc).__name__}: {exc}")
            continue
        for spec in specs:
            if kind == "pages":
                pid = str(_spec_get(spec, "id") or "")
                page_kind = _spec_get(spec, "kind") or "blocks"
                contributed["pages"].append(pid)
                try:
                    _resolve_page(rec, spec)  # what the server does: same rules, same message
                except Exception as exc:  # noqa: BLE001
                    add("error", "pages", f"page {pid!r} is dropped: {exc}")
                    continue
                if page_kind == "react" and not _spec_get(spec, "module"):
                    add("error", "pages", f"page {pid!r}: kind 'react' needs a module")
                if page_kind == "blocks" and not _spec_get(spec, "api_endpoint") and not callable(
                    getattr(plugin, "routes", None)
                ):
                    add("warn", "pages", f"page {pid!r}: kind 'blocks' but the plugin has no routes() to serve it")
                check_asset("pages", f"page {pid!r}", _spec_get(spec, "module"), _spec_get(spec, "integrity"))
                check_asset("pages", f"page {pid!r} css", _spec_get(spec, "css"), None)
            elif kind == "blocks":
                btype = str(_spec_get(spec, "type") or "")
                contributed["blocks"].append(btype)
                check_asset("blocks", f"block {btype!r}", _spec_get(spec, "module"), _spec_get(spec, "integrity"))
            else:
                tname = str(_spec_get(spec, "tool_name") or "")
                contributed["tools"].append(tname)
                check_asset("tools", f"tool {tname!r}", _spec_get(spec, "module"), _spec_get(spec, "integrity"))

    # settings(), nav_groups(), themes(), layouts(): each entry goes through
    # the resolver the server uses, which drops an invalid one from the UI.
    for hook_name, resolve, label in (
        ("settings", _resolve_settings_section, lambda s: f"section {s.id!r}"),
        ("nav_groups", _resolve_nav_group, lambda g: f"group {g.name!r}"),
        ("themes", _resolve_theme, lambda t: f"theme {t.id!r}"),
        ("layouts", _resolve_layout, lambda lay: f"layout {lay.id!r}"),
    ):
        hook = getattr(plugin, hook_name, None)
        if not callable(hook):
            continue
        try:
            specs = list(hook() or ())
        except Exception as exc:  # noqa: BLE001
            add("error", hook_name, f"{hook_name}() raised {type(exc).__name__}: {exc}")
            continue
        seen_ids: set = set()
        for spec in specs:
            try:
                resolved = resolve(rec, spec)
            except Exception as exc:  # noqa: BLE001
                add("error", hook_name, f"invalid entry {spec!r} is dropped: {exc}")
                continue
            ident = label(resolved)
            if hook_name == "settings" and resolved.id in seen_ids:
                add("error", hook_name, f"{ident} is declared twice; the second is dropped")
                continue
            seen_ids.add(getattr(resolved, "id", None))
            if hook_name == "layouts":
                check_asset("layouts", ident, _spec_get(spec, "module"), _spec_get(spec, "integrity"))
                check_asset("layouts", f"{ident} css", _spec_get(spec, "css"), None)
            else:
                add("ok", hook_name, ident)

    hook = getattr(plugin, "routes", None)
    if callable(hook):
        try:
            routes = list(hook() or [])
            add("ok", "routes", f"{len(routes)} route(s) under /api/plugins/{rec.name}")
        except Exception as exc:  # noqa: BLE001
            add("error", "routes", f"routes() raised {type(exc).__name__}: {exc}")

    hook = getattr(plugin, "cli_commands", None)
    if callable(hook):
        try:
            cmd = _as_click_command(hook(), rec.name)
        except Exception as exc:  # noqa: BLE001
            add("error", "cli", f"cli_commands() failed: {exc}")
        else:
            if cmd is not None:
                builtin = set(typer.main.get_command(app).commands)  # type: ignore[attr-defined]
                if rec.name in builtin:
                    add(
                        "warn",
                        "cli",
                        f"'aiui {rec.name}' is a built-in command; use 'aiui plugins {rec.name} …'",
                    )
                else:
                    add("ok", "cli", f"'aiui {rec.name} …' and 'aiui plugins {rec.name} …'")
    return contributed


@plugins_app.command("doctor")
def plugins_doctor(
    config: Optional[Path] = typer.Option(
        None, "--config", "-c", help="Apply the 'extensions:' policy from this YAML config"
    ),
    check_builtin: bool = typer.Option(
        True,
        "--builtin/--no-builtin",
        help="Build the app once to detect plugin page ids shadowed by built-in pages",
    ),
) -> None:
    """Check every UI plugin: entry-point load, SDK gate, static_dir and SRI, shadowed ids.

    Exits with code 1 when any check fails.
    """
    from rich.table import Table

    if _plugin_autoload_disabled():
        console.print(
            f"[yellow]{PLUGIN_AUTOLOAD_ENV}=1: plugins are not loaded, so there is nothing to check. "
            "Unset it to run the doctor.[/yellow]"
        )
        raise typer.Exit(code=1)

    records, _rows = _discover_plugins(config)
    builtins = _builtin_records(config)
    _ext_section = _load_extensions_policy(config)
    builtin_owner = _builtin_pages_by_id(builtins)
    from praisonaiui.plugin_registry import get_plugin_registry

    unknown_builtins = get_plugin_registry().unknown_builtin_names()
    if not records:
        for raw in unknown_builtins:
            console.print(f"[yellow]warn[/yellow] extensions.disabled: {raw!r} matches no built-in plugin")
        console.print(
            f"{len(builtins)} built-in plugin(s), "
            f"{sum(1 for r in builtins if r.status == 'disabled')} disabled. "
            f"No UI plugins installed (entry-point group '{PLUGIN_ENTRY_POINT_GROUP}')."
        )
        return

    findings: list = []
    for raw in unknown_builtins:
        findings.append(("warn", "-", "extensions", f"disabled entry {raw!r} matches no built-in plugin"))
    for rec in builtins:
        if rec.status == "disabled":
            note = "required features stay on" if rec.required else "pages and features off"
            findings.append(("info", rec.name, "builtin", f"disabled by extensions.disabled ({note})"))
    static_files: dict = {}
    contributions: dict = {}
    for rec in records:
        version = f" {rec.version}" if getattr(rec, "version", None) else ""
        where = getattr(rec, "entry_point", "") or ""
        if not _PLUGIN_NAME_OK.match(rec.name):
            findings.append(
                (
                    "error",
                    rec.name,
                    "name",
                    "entry-point name must match [a-z0-9][a-z0-9_-]* (it becomes /api/plugins/<name> "
                    "and /_plugins/<name>)",
                )
            )
        if rec.status == "ok" and rec.plugin is not None:
            findings.append(("ok", rec.name, "load", f"loaded {where}{version}"))
            contributions[rec.name] = _doctor_plugin(rec, static_files, findings)
        elif rec.status == "disabled":
            findings.append(("info", rec.name, "load", "disabled by the extensions policy (not imported)"))
        elif rec.status == "incompatible":
            findings.append(("error", rec.name, "sdk", rec.error or "incompatible SDK version"))
        else:
            level = "warn" if rec.status == "disabled-by-default" else "error"
            findings.append((level, rec.name, "load", f"{rec.status}: {rec.error or 'unknown error'} ({where})"))

    # Shadowed ids: the server keeps the first page id it sees (app and
    # built-in pages first, then plugins in entry-point order).
    builtin_ids = _builtin_page_ids(_ext_section) if check_builtin and contributions else set()
    if builtin_ids is None:
        findings.append(("warn", "-", "shadow", "could not build the app to list built-in page ids"))
        builtin_ids = set()
    seen_pages: dict = {}
    seen_tools: dict = {}
    seen_blocks: dict = {}
    for name, contributed in contributions.items():
        for pid in contributed["pages"]:
            if pid in builtin_ids:
                owner = builtin_owner.get(pid)
                hint = (
                    f" ({owner}); add {owner} to extensions.disabled to use this plugin's page"
                    if owner
                    else " (registered by the app)"
                )
                findings.append(("warn", name, "shadow", f"page {pid!r} is shadowed by a built-in page{hint}"))
            elif pid in seen_pages:
                findings.append(("warn", name, "shadow", f"page {pid!r} is shadowed by plugin {seen_pages[pid]!r}"))
            else:
                seen_pages[pid] = name
        for tool in contributed["tools"]:
            if tool in seen_tools:
                findings.append(("warn", name, "shadow", f"tool renderer {tool!r} also comes from {seen_tools[tool]!r}"))
            seen_tools.setdefault(tool, name)
        for btype in contributed["blocks"]:
            if btype in seen_blocks:
                findings.append(("warn", name, "shadow", f"block {btype!r} also comes from {seen_blocks[btype]!r}"))
            seen_blocks.setdefault(btype, name)

    table = Table(title="aiui plugins doctor")
    table.add_column("Plugin", style="bold")
    table.add_column("Check")
    table.add_column("Result")
    table.add_column("Detail", overflow="fold")
    marks = {
        "ok": "[green]ok[/green]",
        "info": "[dim]info[/dim]",
        "warn": "[yellow]warn[/yellow]",
        "error": "[red]FAIL[/red]",
    }
    for level, plugin, check, detail in findings:
        table.add_row(plugin, check, marks.get(level, level), detail)
    console.print(table)
    errors = sum(1 for f in findings if f[0] == "error")
    warnings = sum(1 for f in findings if f[0] == "warn")
    console.print(
        f"{len(records)} plugin(s), {len(builtins)} built-in: {errors} failure(s), {warnings} warning(s)"
    )
    if errors:
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Test runner — ``aiui test chat|memory|sessions|endpoints|all``
# ---------------------------------------------------------------------------
from praisonaiui.test_runner import test_app

app.add_typer(test_app, name="test")

from praisonaiui.cli_docs import docs_app  # noqa: E402  (aiui docs check-links)

app.add_typer(docs_app, name="docs")


if __name__ == "__main__":
    app()
