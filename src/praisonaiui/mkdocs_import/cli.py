"""Command line for the MkDocs importer. Not registered on the main ``aiui`` app."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import typer

from praisonaiui.mkdocs_import.convert import convert_mkdocs
from praisonaiui.mkdocs_import.model import ConversionError, ConversionResult

app = typer.Typer(
    add_completion=False,
    help="Convert a MkDocs config into a PraisonAI UI docs config.",
)


@app.command()
def convert(
    source: Path = typer.Argument(..., help="Path to mkdocs.yml", exists=True, dir_okay=False),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="Where to write the AIUI config. Defaults to aiui.template.yaml beside the MkDocs file.",
    ),
    force: bool = typer.Option(False, "--force", help="Overwrite an existing AIUI config."),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the config and the conversion notes. Do not write a file.",
    ),
) -> None:
    """Write an AIUI docs config from a MkDocs config. The MkDocs file is not changed."""
    try:
        result = convert_mkdocs(source)
    except ConversionError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(1) from exc

    _echo_findings(result)
    if not result.ok:
        typer.echo(result.error or "Converted config is not valid.", err=True)
        raise typer.Exit(1)

    if dry_run:
        typer.echo(result.yaml_text)
        raise typer.Exit(0)

    destination = output or source.parent / "aiui.template.yaml"
    if destination.exists() and not force:
        typer.echo(
            f"{destination} already exists. Pass --force to overwrite it.",
            err=True,
        )
        raise typer.Exit(2)

    destination.write_text(result.yaml_text, encoding="utf-8")
    typer.echo(
        f"Wrote {destination} ({result.page_count} pages, theme {result.draft.preset})."
    )


def _echo_findings(result: ConversionResult) -> None:
    for finding in result.findings:
        if finding.level == "transferred":
            continue
        label = "Dropped" if finding.level == "dropped" else "Note"
        typer.echo(f"{label}: {finding.message}", err=True)


def main() -> None:
    """Entry point for ``python -m praisonaiui.mkdocs_import``."""
    app()
