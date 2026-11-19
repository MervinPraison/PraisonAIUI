"""``aiui docs`` commands for docs sites: ``check-links``, ``feedback``.

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

docs_app = typer.Typer(name="docs", help="Docs site tools (check-links, feedback)", add_completion=False)


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

    from praisonaiui.cli import _load_site_config, _resolve_config, console
    from praisonaiui.compiler.links import check_site_links

    path = _resolve_config(config)
    _data, cfg = _load_site_config(path)
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


@docs_app.command("feedback")
def feedback_command(
    fmt: str = typer.Option("table", "--format", "-f", help="table (per page), csv or json (every vote)"),
    output: Optional[Path] = typer.Option(None, "--output", "-o", help="Write to this file instead of the terminal"),
    site: Optional[str] = typer.Option(None, "--site", help="Only the votes of this site (its site.title)"),
) -> None:
    """The "Was this page helpful?" votes aiui serve / aiui dev stored: per page, or every vote (csv, json)."""
    from rich.table import Table

    from praisonaiui import docs_feedback as df
    from praisonaiui.cli import console

    if fmt not in ("table", "csv", "json"):
        raise typer.BadParameter("--format is table, csv or json")
    records = df.load(site=site)
    if fmt == "table":
        if not records:
            console.print(f"No feedback yet ({df.store_path()})")
            return
        table = Table(title=f"{len(records)} vote{'' if len(records) == 1 else 's'}")
        for col in ("Page", "Helpful", "Not helpful", "Code flags", "Comments"):
            table.add_column(col, justify="left" if col == "Page" else "right")
        for p in df.by_page(records):
            table.add_row(escape(p["path"]), str(p["yes"]), str(p["no"]), str(p["code"]), str(p["comments"]))
        console.print(table)
        return
    text = df.to_csv(records) if fmt == "csv" else json.dumps(records, indent=2, ensure_ascii=False) + "\n"
    if output:
        output.write_text(text, encoding="utf-8")
        console.print(f"Wrote {len(records)} votes to {output}")
    else:
        typer.echo(text, nl=False)
