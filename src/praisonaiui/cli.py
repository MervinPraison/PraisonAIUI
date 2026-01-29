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
    frontend: bool = typer.Option(
        False,
        "--frontend",
        help="Scaffold a Vite + React + shadcn frontend project for customization",
    ),
) -> None:
    """Initialize a new PraisonAIUI project."""
    config_path = Path.cwd() / "aiui.template.yaml"

    # If --frontend flag, scaffold a frontend project
    if frontend:
        _scaffold_frontend(force)
        return

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

    config_path.write_text(minimal_config)
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
        shutil.copytree(template_dir, frontend_dir, ignore=shutil.ignore_patterns(
            "node_modules", "dist", ".git", "*.log"
        ))
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
    import socket
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

    # Find available port
    def find_available_port(start_port: int, max_attempts: int = 10) -> int:
        for i in range(max_attempts):
            test_port = start_port + i
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(("", test_port))
                    return test_port
                except OSError:
                    continue
        raise OSError(f"No available port found in range {start_port}-{start_port + max_attempts}")

    try:
        actual_port = find_available_port(port)
    except OSError as e:
        console.print(f"[red]Error:[/red] {e}")
        raise typer.Exit(code=4)

    if actual_port != port:
        console.print(f"[yellow]⚠️[/yellow] Port {port} in use, using {actual_port}")

    # Serve from output directory
    import os

    os.chdir(output)

    # Custom SPA handler that falls back to index.html for client-side routes
    class SPAHandler(http.server.SimpleHTTPRequestHandler):
        """Handler that serves index.html for SPA routes (no file extension)."""

        def do_GET(self):
            # If path has no extension and doesn't exist, serve index.html
            path = self.path.split("?")[0]  # Remove query string
            if "." not in path.split("/")[-1]:  # No file extension
                file_path = self.translate_path(path)
                if not os.path.exists(file_path) or os.path.isdir(file_path):
                    self.path = "/index.html"
            return super().do_GET()

    handler = SPAHandler

    # Start HTTP server
    console.print(f"\n[green]🚀[/green] Serving at [link]http://localhost:{actual_port}[/link]")
    console.print("[dim]Press Ctrl+C to stop[/dim]\n")

    # Open browser
    webbrowser.open(f"http://localhost:{actual_port}")

    with socketserver.TCPServer(("", actual_port), handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            console.print("\n[green]Server stopped.[/green]")


@app.command()
def dev(
    examples_dir: Path = typer.Option(
        Path("examples"),
        "--examples",
        "-e",
        help="Directory containing example projects",
    ),
    port: int = typer.Option(
        9000,
        "--port",
        "-p",
        help="Port for dev server",
    ),
) -> None:
    """Development dashboard - switch between examples live."""
    import http.server
    import json
    import os
    import socket
    import socketserver
    import subprocess
    import tempfile
    import threading
    import urllib.parse
    import webbrowser

    # Find examples
    if not examples_dir.exists():
        console.print(f"[red]Error:[/red] Examples directory not found: {examples_dir}")
        raise typer.Exit(code=1)

    examples = [d.name for d in examples_dir.iterdir() if d.is_dir() and (d / "aiui.template.yaml").exists()]
    if not examples:
        console.print(f"[red]Error:[/red] No examples found in {examples_dir}")
        raise typer.Exit(code=1)

    console.print(f"[green]Found {len(examples)} examples:[/green] {', '.join(examples)}")

    # Create temp directory for built content
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        current_example = {"name": examples[0]}

        # Build first example
        def build_example(name: str) -> bool:
            """Build an example and copy to temp dir."""
            example_path = examples_dir / name
            if not example_path.exists():
                return False
            try:
                # Run aiui build in example directory
                result = subprocess.run(
                    ["aiui", "build", "-o", str(temp_path / "site")],
                    cwd=example_path,
                    capture_output=True,
                    text=True,
                )
                return result.returncode == 0
            except Exception as e:
                console.print(f"[red]Build error:[/red] {e}")
                return False

        # Initial build
        console.print(f"[yellow]Building {current_example['name']}...[/yellow]")
        build_example(current_example["name"])

        # Dashboard HTML
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
            display: flex; align-items: center; gap: 16px;
            padding: 12px 20px;
            background: linear-gradient(to bottom, rgba(10,10,10,0.98), rgba(10,10,10,0.95));
            border-bottom: 1px solid rgba(255,255,255,0.1);
            backdrop-filter: blur(12px);
        }}
        .logo {{ display: flex; align-items: center; gap: 10px; font-weight: 600; font-size: 14px; }}
        .logo-icon {{ 
            width: 28px; height: 28px; border-radius: 6px;
            background: linear-gradient(135deg, #6366f1, #8b5cf6);
            display: flex; align-items: center; justify-content: center;
            font-size: 10px; font-weight: 700;
        }}
        select {{
            background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15);
            color: #fafafa; padding: 8px 32px 8px 12px;
            border-radius: 8px; font-size: 13px; cursor: pointer;
            appearance: none;
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%23888' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10l-5 5z'/%3E%3C/svg%3E");
            background-repeat: no-repeat; background-position: right 10px center;
        }}
        select:hover {{ border-color: rgba(255,255,255,0.3); }}
        select:focus {{ outline: none; border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.2); }}
        .status {{ font-size: 12px; color: #888; margin-left: auto; }}
        .status.loading {{ color: #f59e0b; }}
        .status.ready {{ color: #22c55e; }}
        iframe {{
            position: fixed; top: 53px; left: 0; right: 0; bottom: 0;
            width: 100%; height: calc(100vh - 53px); border: none;
        }}
    </style>
</head>
<body>
    <div class="toolbar">
        <div class="logo">
            <div class="logo-icon">AI</div>
            <span>Dev Dashboard</span>
        </div>
        <select id="example-select" onchange="switchExample(this.value)">
            {"".join(f'<option value="{e}">{e}</option>' for e in examples)}
        </select>
        <span id="status" class="status ready">Ready</span>
    </div>
    <iframe id="preview" src="/site/"></iframe>
    <script>
        async function switchExample(name) {{
            const status = document.getElementById('status');
            const iframe = document.getElementById('preview');
            status.textContent = 'Building...';
            status.className = 'status loading';
            try {{
                const res = await fetch('/api/switch?example=' + encodeURIComponent(name));
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
                        s.bind(("", start + i))
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

            def do_GET(self):
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
                    if example_name and example_name in examples:
                        console.print(f"[yellow]Switching to {example_name}...[/yellow]")
                        success = build_example(example_name)
                        current_example["name"] = example_name
                        self.send_response(200)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"success": success, "example": example_name}).encode())
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

            def log_message(self, format, *args):
                pass  # Suppress logs

        console.print(f"\n[green]🚀[/green] Dev dashboard at [link]http://localhost:{actual_port}[/link]")
        console.print(f"[dim]Switch examples with the dropdown. Press Ctrl+C to stop.[/dim]\n")
        webbrowser.open(f"http://localhost:{actual_port}")

        with socketserver.TCPServer(("", actual_port), DevHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                console.print("\n[green]Dev server stopped.[/green]")


if __name__ == "__main__":
    app()
