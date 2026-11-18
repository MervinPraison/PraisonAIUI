"""``aiui docs`` commands for docs sites: ``check-links``.

The checker is ``compiler/links.py``; ``aiui validate`` and ``aiui build
--strict`` run it too (``print_broken_links``).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import typer
from rich.markup import escape

if TYPE_CHECKING:
    from rich.console import Console

    from praisonaiui.compiler.links import LinkReport

docs_app = typer.Typer(name="docs", help="Docs site tools (check-links)", add_completion=False)


def print_broken_links(report: LinkReport, console: Console, *, style: str = "red") -> None:
    """One line per broken link: ``file:line: target: reason (did you mean X?)``."""
    from praisonaiui.compiler.links import format_broken

    for link in report.broken:
        console.print(f"  [{style}]{escape(format_broken(link))}[/{style}]", soft_wrap=True)


@docs_app.command("check-links")
def check_links_command(
    config: Optional[Path] = typer.Option(None, "--config", "-c", help="Configuration file (default ./aiui.yaml)"),
    external: bool = typer.Option(False, "--external", help="Also request every http(s) URL (HEAD, then GET)"),
    timeout: float = typer.Option(10.0, "--timeout", help="Seconds to wait for each external URL"),
    as_json: bool = typer.Option(False, "--json", help="Print the broken links as JSON"),
) -> None:
    """Find broken links, anchors and images in the docs pages and the nav.

    Exits 1 when any link is broken, so it can gate CI.
    """
    from dataclasses import asdict

    import yaml

    from praisonaiui.cli import _resolve_config, console
    from praisonaiui.compiler.links import check_site_links
    from praisonaiui.schema.models import Config

    path = _resolve_config(config)
    if not path.exists():
        console.print(f"[red]Error:[/red] Configuration file not found: {path}")
        raise typer.Exit(code=2)
    try:
        cfg = Config.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    except Exception as e:
        console.print(f"[red]Error:[/red] Failed to parse configuration: {e}")
        raise typer.Exit(code=1)
    if not (cfg.content and cfg.content.docs):
        console.print("[yellow]No docs folder configured (content.docs.dir): nothing to check[/yellow]")
        return
    report = check_site_links(cfg, path, external=external, timeout=timeout)
    if as_json:
        out = {"checked": report.checked, "pages": report.pages, "broken": [asdict(b) for b in report.broken]}
        typer.echo(json.dumps(out, indent=2))
    elif report.ok:
        console.print(f"[green]✓[/green] {report.checked} links checked in {report.pages} pages, none broken")
    else:
        print_broken_links(report, console)
        console.print(
            f"[red]✗[/red] {len(report.broken)} broken of {report.checked} links checked in {report.pages} pages"
        )
    if not report.ok:
        raise typer.Exit(code=1)
