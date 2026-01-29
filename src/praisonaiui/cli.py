"""CLI module - Typer-based command line interface."""

from pathlib import Path
from typing import Optional

import typer
from rich.console import Console
from rich.panel import Panel

from praisonaiui.__version__ import __version__

app = typer.Typer(
    name="aiui",
    help="PraisonAIUI - YAML-driven website generator",
    add_completion=False,
)
console = Console()


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
) -> None:
    """Initialize a new PraisonAIUI project."""
    config_path = Path.cwd() / "aiui.template.yaml"

    if config_path.exists() and not force:
        console.print(
            "[red]Error:[/red] aiui.template.yaml already exists. Use --force to overwrite."
        )
        raise typer.Exit(code=1)

    # Create minimal config
    minimal_config = """# aiui.template.yaml
schemaVersion: 1

site:
  title: "My Documentation"
  description: "Built with PraisonAIUI"

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

    config_path.write_text(minimal_config)
    console.print(Panel(f"[green]✓[/green] Created {config_path}", title="Success"))


@app.command()
def validate(
    config: Path = typer.Option(
        Path("aiui.template.yaml"),
        "--config",
        "-c",
        help="Path to configuration file",
    ),
    strict: bool = typer.Option(
        False,
        "--strict",
        help="Enable strict validation",
    ),
) -> None:
    """Validate configuration file."""
    import yaml

    from praisonaiui.schema.models import Config
    from praisonaiui.schema.validators import validate_config

    if not config.exists():
        console.print(f"[red]Error:[/red] Configuration file not found: {config}")
        raise typer.Exit(code=2)

    try:
        with open(config) as f:
            data = yaml.safe_load(f)
        cfg = Config.model_validate(data)
    except Exception as e:
        console.print(f"[red]Error:[/red] Failed to parse configuration: {e}")
        raise typer.Exit(code=1)

    result = validate_config(cfg, config.parent)

    if result.valid:
        console.print("[green]✓[/green] Configuration is valid")
    else:
        console.print("[red]✗[/red] Configuration has errors:")
        for error in result.errors:
            console.print(f"  [{error.category}] {error.message}")
            if error.suggestion:
                console.print(f"    💡 {error.suggestion}")
        raise typer.Exit(code=1)


@app.command()
def build(
    config: Path = typer.Option(
        Path("aiui.template.yaml"),
        "--config",
        "-c",
        help="Path to configuration file",
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
) -> None:
    """Build manifests from configuration."""
    import yaml

    from praisonaiui.compiler import Compiler
    from praisonaiui.schema.models import Config

    if not config.exists():
        console.print(f"[red]Error:[/red] Configuration file not found: {config}")
        raise typer.Exit(code=2)

    try:
        with open(config) as f:
            data = yaml.safe_load(f)
        cfg = Config.model_validate(data)
    except Exception as e:
        console.print(f"[red]Error:[/red] Failed to parse configuration: {e}")
        raise typer.Exit(code=1)

    compiler = Compiler(cfg, base_path=config.parent)
    result = compiler.compile(output_dir=output, minify=minify)

    if result.success:
        msg = f"[green]✓[/green] Built {len(result.files)} files to {output}/"
        console.print(Panel(msg, title="Success"))
        for file in result.files:
            console.print(f"  • {file}")
    else:
        console.print(f"[red]Error:[/red] Build failed: {result.error}")
        raise typer.Exit(code=3)


@app.command()
def dev(
    config: Path = typer.Option(
        Path("aiui.template.yaml"),
        "--config",
        "-c",
        help="Path to configuration file",
    ),
    port: int = typer.Option(
        3000,
        "--port",
        "-p",
        help="Port for development server",
    ),
) -> None:
    """Start development mode with file watching."""
    console.print(f"[yellow]⏳[/yellow] Watching {config} for changes...")
    console.print("[dim]Press Ctrl+C to stop[/dim]")

    try:
        from watchfiles import watch

        for changes in watch(config.parent):
            console.print("[blue]↻[/blue] Detected changes, rebuilding...")
            # Trigger rebuild
            build(config=config, output=Path("aiui"), minify=False)
    except KeyboardInterrupt:
        console.print("\n[green]Stopped.[/green]")


@app.command()
def serve(
    config: Path = typer.Option(
        Path("aiui.template.yaml"),
        "--config",
        "-c",
        help="Path to configuration file",
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
) -> None:
    """Serve the site locally with a built-in HTTP server."""
    import http.server
    import socketserver
    import webbrowser

    # Build first unless --no-build
    if not no_build:
        console.print("[yellow]⏳[/yellow] Building manifests...")
        build(config=config, output=output, minify=False)

    # Check if output directory exists
    if not output.exists():
        console.print(f"[red]Error:[/red] Output directory not found: {output}")
        console.print("Run 'aiui build' first or remove --no-build flag.")
        raise typer.Exit(code=2)

    # Start HTTP server
    console.print(f"\n[green]🚀[/green] Serving at [link]http://localhost:{port}[/link]")
    console.print("[dim]Press Ctrl+C to stop[/dim]\n")

    # Open browser
    webbrowser.open(f"http://localhost:{port}")

    # Serve from output directory
    import os

    os.chdir(output)

    handler = http.server.SimpleHTTPRequestHandler

    with socketserver.TCPServer(("", port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            console.print("\n[green]Server stopped.[/green]")


if __name__ == "__main__":
    app()
