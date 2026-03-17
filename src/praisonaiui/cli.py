"""CLI module - Typer-based command line interface."""

import asyncio
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
) -> None:
    """Serve the site locally with a production-ready HTTP server."""
    import socket

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

    # Build Starlette app with security
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.middleware.cors import CORSMiddleware
    from starlette.requests import Request
    from starlette.responses import FileResponse, Response
    from starlette.routing import Route

    output_resolved = output.resolve()

    def _is_safe_path(requested: Path) -> bool:
        """Guard against path traversal — ensure file is inside output dir."""
        try:
            requested.resolve().relative_to(output_resolved)
            return True
        except ValueError:
            return False

    async def spa_handler(request: Request) -> Response:
        """SPA handler: serve static files with path-traversal guard and index.html fallback."""

        url_path = request.url.path.lstrip("/")
        file_path = output_resolved / url_path

        # Path traversal guard
        if not _is_safe_path(file_path):
            return Response("Forbidden", status_code=403)

        # Serve exact file if it exists
        if file_path.is_file():
            import mimetypes

            mime, _ = mimetypes.guess_type(str(file_path))
            return FileResponse(str(file_path), media_type=mime)

        # Try adding index.html for directories
        if file_path.is_dir():
            index = file_path / "index.html"
            if index.is_file():
                return FileResponse(str(index))

        # Try with .html extension
        html_path = file_path.with_suffix(".html")
        if html_path.is_file() and _is_safe_path(html_path):
            return FileResponse(str(html_path))

        # SPA fallback — serve index.html for client-side routes
        index_html = output_resolved / "index.html"
        if index_html.is_file():
            return FileResponse(str(index_html))

        return Response("Not Found", status_code=404)

    middleware = []
    if cors_origins:
        origins = [o.strip() for o in cors_origins.split(",") if o.strip()]
        middleware.append(
            Middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET"])
        )

    starlette_app = Starlette(
        routes=[Route("/{path:path}", endpoint=spa_handler)],
        middleware=middleware,
    )

    protocol = "https" if ssl_certfile else "http"
    console.print(f"\n[green]🚀[/green] Serving at [link]{protocol}://{host}:{actual_port}[/link]")
    if ssl_certfile:
        console.print(f"[green]🔒[/green] TLS enabled with {ssl_certfile}")
    console.print("[dim]Press Ctrl+C to stop[/dim]\n")

    # Open browser
    import webbrowser

    webbrowser.open(f"{protocol}://{host}:{actual_port}")

    # Start file watcher in background thread if --watch
    if watch and config.exists():
        import threading

        def _watch_and_rebuild() -> None:
            try:
                from watchfiles import watch as wf_watch

                for _changes in wf_watch(config.parent):
                    console.print("[blue]↻[/blue] Detected changes, rebuilding...")
                    try:
                        build(config=config, output=output, minify=False)
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

    examples = [d.name for d in examples_dir.iterdir() if d.is_dir() and (d / "aiui.template.yaml").exists()]
    if not examples:
        console.print(f"[red]Error:[/red] No examples found in {examples_dir}")
        raise typer.Exit(code=1)

    console.print(f"[green]Found {len(examples)} examples:[/green] {', '.join(examples)}")

    # Create temp directory for built content
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        current_example = {"name": examples[0]}

        # Build example with optional theme override
        def build_example(name: str, theme_preset: str = None, radius: str = None, dark_mode: bool = None) -> bool:
            """Build an example and copy to temp dir, optionally overriding theme."""
            import yaml

            example_path = examples_dir / name
            if not example_path.exists():
                return False

            try:
                # If theme override specified, create a modified config
                config_file = example_path / "aiui.template.yaml"
                original_config = None

                if any([theme_preset, radius, dark_mode is not None]) and config_file.exists():
                    with open(config_file) as f:
                        original_config = f.read()

                    # Parse and modify
                    config = yaml.safe_load(original_config)
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

                    with open(config_file, "w") as f:
                        yaml.dump(config, f, default_flow_style=False)

                # Run aiui build in example directory
                result = subprocess.run(
                    ["aiui", "build", "-o", str(temp_path / "site")],
                    cwd=example_path,
                    capture_output=True,
                    text=True,
                )

                # Restore original config if modified
                if original_config:
                    with open(config_file, "w") as f:
                        f.write(original_config)

                if result.returncode != 0:
                    console.print("[red]Build failed![/red]")
                    console.print(f"[dim]Return code: {result.returncode}[/dim]")
                    console.print(f"[dim]STDOUT: {result.stdout[:1000] if result.stdout else 'None'}[/dim]")
                    console.print(f"[dim]STDERR: {result.stderr[:1000] if result.stderr else 'None'}[/dim]")
                return result.returncode == 0
            except Exception as e:
                import traceback
                console.print(f"[red]Build error:[/red] {e}")
                console.print(f"[dim]{traceback.format_exc()}[/dim]")
                return False

        # Initial build
        console.print(f"[yellow]Building {current_example['name']}...[/yellow]")
        build_example(current_example["name"])

        # Official shadcn theme presets (Tailwind color names)
        themes = ["zinc", "slate", "stone", "neutral", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose"]
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
                <h3>aiui.template.yaml</h3>
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
                    theme_preset = query.get("theme", [None])[0]
                    radius = query.get("radius", [None])[0]
                    dark_mode_str = query.get("darkMode", [None])[0]
                    dark_mode = dark_mode_str == "true" if dark_mode_str else None

                    if example_name and example_name in examples:
                        console.print(f"[yellow]Building {example_name} (theme={theme_preset}, radius={radius}, dark={dark_mode})...[/yellow]")
                        success = build_example(example_name, theme_preset, radius, dark_mode)
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

                # API: get YAML content
                if path == "/api/yaml":
                    example_name = query.get("example", [None])[0]
                    if example_name and example_name in examples:
                        yaml_path = examples_dir / example_name / "aiui.template.yaml"
                        yaml_content = ""
                        if yaml_path.exists():
                            with open(yaml_path) as f:
                                yaml_content = f.read()
                        self.send_response(200)
                        self.send_header("Content-type", "application/json")
                        self.end_headers()
                        self.wfile.write(json.dumps({"yaml": yaml_content, "example": example_name}).encode())
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
                path = self.path.split("?")[0]

                # API: save YAML and rebuild
                if path == "/api/yaml":
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(content_length).decode('utf-8')
                    try:
                        data = json.loads(body)
                        example_name = data.get("example")
                        yaml_content = data.get("yaml", "")

                        if example_name and example_name in examples:
                            yaml_path = examples_dir / example_name / "aiui.template.yaml"
                            # Write the new YAML
                            with open(yaml_path, "w") as f:
                                f.write(yaml_content)
                            console.print(f"[yellow]Rebuilding {example_name} with edited YAML...[/yellow]")
                            # Rebuild
                            success = build_example(example_name)
                            self.send_response(200)
                            self.send_header("Content-type", "application/json")
                            self.end_headers()
                            self.wfile.write(json.dumps({"success": success, "example": example_name}).encode())
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

        console.print(f"\n[green]🚀[/green] Dev dashboard at [link]http://localhost:{actual_port}[/link]")
        console.print("[dim]Switch examples with the dropdown. Press Ctrl+C to stop.[/dim]\n")
        webbrowser.open(f"http://localhost:{actual_port}")

        with socketserver.TCPServer(("", actual_port), DevHandler) as httpd:
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                console.print("\n[green]Dev server stopped.[/green]")


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
            def calculate(expression: str) -> str:
                """Evaluate a math expression safely."""
                allowed = set("0123456789+-*/.() ")
                if all(c in allowed for c in expression):
                    try:
                        return f"Result: {eval(expression)}"
                    except Exception as e:
                        return f"Error: {e}"
                return "Error: Only basic math operations allowed"
            _resolved_tools.append(calculate)

    # ── Lazy agent creation ──────────────────────────────────────────
    _agent_cache = {}

    def _get_agent():
        if "agent" not in _agent_cache:
            try:
                from praisonaiagents import Agent
            except ImportError:
                raise ImportError(
                    "praisonaiagents package required for YAML chat. "
                    "Install with: pip install praisonai"
                )
            agent_kwargs = {
                "name": agent_name,
                "instructions": instructions,
            }
            if model:
                agent_kwargs["model"] = model
            if _resolved_tools:
                agent_kwargs["tools"] = _resolved_tools
            _agent_cache["agent"] = Agent(**agent_kwargs)
            # Disable the Responses API on the OpenAI client so the Chat
            # Completions streaming path is used instead.  The Responses API
            # returns the full text at once and only emits FIRST_TOKEN[:50],
            # preventing real token-by-token streaming in the UI.
            _client = getattr(_agent_cache["agent"], "_openai_client", None)
            if _client and not _client.base_url:
                _client.base_url = "https://api.openai.com/v1"
        return _agent_cache["agent"]

    async def on_reply(msg):
        from praisonaiui.callbacks import _set_context
        _set_context(msg)
        try:
            await aiui.think("Thinking...")
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
                elif full_response and len(_streamed_content.strip()) < len(full_response.strip()) * 0.8:
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
    datastore: str = typer.Option(
        "sdk",
        "--datastore",
        "-d",
        help="Data persistence: 'sdk' (unified with praisonai-agents, default), 'json', 'memory', 'json:/path', or 'sdk:/path'",
    ),
    style: str = typer.Option(
        "chat",
        "--style",
        "-s",
        help="UI style: 'chat' (default), 'docs', 'agents' (tabbed multi-agent), 'playground' (input/output panels), 'dashboard', 'custom'",
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
    import importlib.util
    import socket
    import sys

    # Validate app file exists
    if not app_file.exists():
        console.print(f"[red]Error:[/red] App file not found: {app_file}")
        raise typer.Exit(code=1)

    is_yaml = app_file.suffix in (".yaml", ".yml")

    if is_yaml:
        # Load YAML chat configuration
        console.print(f"[yellow]⏳[/yellow] Loading {app_file}...")
        import yaml as _yaml

        with open(app_file) as f:
            chat_yaml = _yaml.safe_load(f) or {}

        # Apply config from YAML (override CLI defaults only if present)
        if "datastore" in chat_yaml and datastore == "memory":
            datastore = chat_yaml["datastore"]

        # Auto-register callbacks from YAML
        _register_yaml_chat(chat_yaml)
        is_chat_mode = True
    else:
        # Load the user's app module FIRST to register callbacks
        console.print(f"[yellow]⏳[/yellow] Loading {app_file}...")
        spec = importlib.util.spec_from_file_location("user_app", app_file)
        if spec is None or spec.loader is None:
            console.print(f"[red]Error:[/red] Could not load {app_file}")
            raise typer.Exit(code=1)

        user_module = importlib.util.module_from_spec(spec)
        sys.modules["user_app"] = user_module
        spec.loader.exec_module(user_module)

        # Check if app.py registered a @reply callback (chat mode)
        from praisonaiui.server import _callbacks
        is_chat_mode = "reply" in _callbacks or "on:reply" in _callbacks

    # ── Resolve final style ──────────────────────────────────────
    # Priority: CLI explicit --style > aiui.set_style() > auto-detect
    # Only auto-detect when CLI used the default value ("chat")
    from praisonaiui.server import get_style, detect_style
    if style == "chat":
        explicit = get_style()
        if explicit:
            style = explicit
        else:
            detected = detect_style()
            if detected != "chat":
                console.print(f"[cyan]ℹ️[/cyan] Auto-detected style: [bold]{detected}[/bold]")
            style = detected

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
        console.print("[yellow]⏳[/yellow] Building static files...")
        build(config=config, output=output, minify=False)

    # If chat mode: set up chat frontend directly from templates
    if is_chat_mode:
        import json as _json
        import shutil

        output.mkdir(parents=True, exist_ok=True)

        # Copy bundled frontend template (has the React SPA with ChatLayout)
        pkg_frontend = Path(__file__).parent / "templates" / "frontend"
        if pkg_frontend.exists():
            # Copy index.html and assets from the package template
            for item in pkg_frontend.iterdir():
                dst = output / item.name
                if item.is_dir():
                    if dst.exists():
                        shutil.rmtree(dst)
                    shutil.copytree(item, dst)
                else:
                    shutil.copy2(item, dst)

        # Write chat-mode ui-config.json
        ui_config_path = output / "ui-config.json"
        ui_cfg = {
            "site": {
                "title": "AI Chat",
                "theme": {"preset": "zinc", "darkMode": True, "radius": "md"},
            },
            "style": style,
        }
        with open(ui_config_path, "w") as f:
            _json.dump(ui_cfg, f, indent=2)

        # Write minimal route-manifest and docs-nav so the SPA doesn't error
        (output / "route-manifest.json").write_text('{"routes": []}')
        (output / "docs-nav.json").write_text('{"items": []}')

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

    static_dir = output if output.exists() else None

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

        # Run gateway
        import asyncio
        asyncio.run(gateway.start())
    else:
        # Set up datastore
        from praisonaiui.server import set_datastore

        if datastore == "memory":
            from praisonaiui.datastore import MemoryDataStore
            store = MemoryDataStore()
        elif datastore == "sdk":
            try:
                from praisonaiui.datastore_sdk import SDKFileDataStore
                store = SDKFileDataStore()
            except (ImportError, Exception):
                from praisonaiui.datastore import JSONFileDataStore
                store = JSONFileDataStore()
                datastore = "json (sdk fallback)"
        elif datastore.startswith("sdk:"):
            from praisonaiui.datastore_sdk import SDKFileDataStore
            store = SDKFileDataStore(session_dir=datastore[4:])
        elif datastore == "json":
            from praisonaiui.datastore import JSONFileDataStore
            store = JSONFileDataStore()
        elif datastore.startswith("json:"):
            from praisonaiui.datastore import JSONFileDataStore
            store = JSONFileDataStore(data_dir=datastore[5:])
        else:
            console.print(f"[red]Error:[/red] Unknown datastore: {datastore}")
            raise typer.Exit(code=1)

        set_datastore(store)

        # Use standalone server (default)
        from praisonaiui.server import create_app, set_style as _set_style

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

        uvicorn.run(
            server_app,
            host=host,
            port=actual_port,
            log_level="info",
            reload=reload,
            reload_dirs=[str(app_file.parent)] if reload else None,
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
@app.command()
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

    try:
        with urlopen(f"{server}/health") as resp:
            data = _json.loads(resp.read())
            status = data.get("status", "unknown")
            ts = data.get("timestamp", "")
            if status == "healthy":
                console.print(Panel.fit(
                    f"Server: [green]healthy[/green] ({ts})",
                    title="Health Check",
                    border_style="green",
                ))
            else:
                console.print(Panel.fit(
                    f"Server: [yellow]{status}[/yellow] ({ts})",
                    title="Health Check",
                    border_style="yellow",
                ))
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
                    icon = "[green]✅[/green]" if healthy else "[yellow]⚠️[/yellow]"
                    console.print(f"  {icon} {name}: {detail}")
        except Exception as e:
            console.print(f"[yellow]⚠️[/yellow] Could not fetch feature health: {e}")


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

    try:
        with urlopen(f"{server}/api/provider") as resp:
            data = _json.loads(resp.read())
            console.print(f"[bold]Provider:[/bold] {data.get('name', 'unknown')}")
            console.print(f"[bold]Module:[/bold]   {data.get('module', 'unknown')}")
            status = data.get("status", "unknown")
            color = "green" if status == "ok" else "red"
            console.print(f"[bold]Status:[/bold]   [{color}]{status}[/{color}]")
            agents = data.get("agents", [])
            if agents:
                console.print(f"[bold]Agents:[/bold]   {len(agents)}")
                for a in agents:
                    console.print(f"  • {a.get('name', 'unnamed')}: {a.get('description', '')}")
            extra_keys = {k for k in data if k not in {"name", "module", "status", "agents", "provider"}}
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
        with urlopen(f"{server}/health") as resp:
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
    req = UrlRequest(f"{server}{path}", data=data, method="PATCH",
                     headers={"Content-Type": "application/json"})
    with urlopen(req) as resp:
        return _json.loads(resp.read())


# ── Features listing ─────────────────────────────────────────────────
features_app = typer.Typer(name="features", help="List all registered features", add_completion=False)
app.add_typer(features_app, name="features")


@features_app.command("list")
def features_list(server: str = _SERVER_OPT) -> None:
    """List all registered protocol features."""
    try:
        data = _api_get(server, "/api/features")
        for f in data.get("features", []):
            h = f.get("health", {})
            status = h.get("status", "?")
            color = "green" if status == "ok" else "red"
            console.print(f"  [{color}]●[/{color}] {f['name']} — {f.get('description', '')}")
            if f.get("routes"):
                console.print(f"    routes: {', '.join(f['routes'])}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


@features_app.command("status")
def features_status(server: str = _SERVER_OPT) -> None:
    """Show feature health summary."""
    try:
        data = _api_get(server, "/api/features")
        features = data.get("features", [])
        ok = sum(1 for f in features if f.get("health", {}).get("status") == "ok")
        console.print(f"Features: {ok}/{len(features)} healthy")
        for f in features:
            h = f.get("health", {})
            status = h.get("status", "?")
            color = "green" if status == "ok" else "red"
            console.print(f"  [{color}]●[/{color}] {f['name']}: {status}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Approvals ────────────────────────────────────────────────────────
approval_app = typer.Typer(name="approval", help="Manage tool-execution approvals", add_completion=False)
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
        data = _api_post(server, f"/api/approvals/{approval_id}/resolve",
                         {"approved": approved, "reason": reason})
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
            console.print(f"  [{s}] {j['id']} — {j.get('name', '?')} ({j.get('schedule', {}).get('kind', '?')})")
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
        data = _api_post(server, "/api/schedules", {
            "name": name, "message": message,
            "schedule": {"kind": "every", "every_seconds": every},
        })
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
    memory_type: str = typer.Option("all", "--type", help="Filter by type: short, long, entity, all"),
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
            console.print(f"  {h['id']} — {h.get('name', '?')} ({h.get('event', '?')}, {h.get('type', '?')})")
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
        console.print(f"[green]✓[/green] Triggered: {data.get('hook_id', hook_id)} → {data.get('result', '?')}")
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
workflows_app = typer.Typer(name="workflows", help="Manage multi-step workflows", add_completion=False)
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
            console.print(f"  {r['id']} — {r.get('workflow_name', r.get('workflow_id', '?'))} ({r.get('status', '?')})")
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
session_ext_app = typer.Typer(name="session-ext", help="Extended session operations (state, labels, usage)", add_completion=False)
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
        _api_post(server, f"/api/sessions/{session_id}/state",
                         {"state": {key: value}})
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
        console.print(f"Session {session_id}: {usage.get('tokens', 0)} tokens, {usage.get('requests', 0)} requests")
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
eval_app = typer.Typer(name="eval", help="Manage agent evaluations (list, scores, judges, run)", add_completion=False)
app.add_typer(eval_app, name="eval")


@eval_app.command("status")
def eval_status(server: str = _SERVER_OPT) -> None:
    """Show eval status and judge count."""
    try:
        data = _api_get(server, "/api/eval/status")
        console.print(f"Provider: {data.get('provider', '?')}")
        console.print(f"Total evaluations: {data.get('total_evaluations', 0)}")
        console.print(f"Active judges: {data.get('active_judges', 0)}")
        if data.get('sdk_available'):
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
            console.print(f"  [{ev.get('id','')}] agent={ev.get('agent_id','?')} score={score} passed={passed}")
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
            console.print(f"  {j.get('name','?')} (source={j.get('source','?')})")
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
        data = _api_post(server, "/api/eval/run", {
            "agent_id": agent_id, "input": input_text,
            "output": output_text, "expected": expected,
        })
        result = data.get("result", {})
        score = result.get("score", "—")
        passed = "✓" if result.get("passed") else ("✗" if result.get("passed") is False else "—")
        console.print(f"[green]✓[/green] Evaluation {result.get('id','?')}: score={score} passed={passed}")
        console.print(f"  Feedback: {result.get('feedback', '—')}")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Traces ───────────────────────────────────────────────────────────
traces_app = typer.Typer(name="traces", help="Manage distributed traces (list, spans, get)", add_completion=False)
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
                f"  [{t.get('id','')}] {t.get('name','')} "
                f"status={t.get('status','?')} {t.get('duration_ms',0)}ms "
                f"spans={t.get('span_count',0)}"
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
            console.print(f"  [{s.get('id','')}] {s.get('name','')} kind={s.get('kind','?')} {s.get('duration_ms',0)}ms")
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
            console.print(f"    [{s.get('id','')}] {s.get('name','')} {s.get('duration_ms',0)}ms")
    except Exception as e:
        console.print(f"[red]✗[/red] {e}")
        raise typer.Exit(code=1)


# ── Pages ────────────────────────────────────────────────────────────
pages_app = typer.Typer(name="pages", help="Manage sidebar pages (list, ids)", add_completion=False)
app.add_typer(pages_app, name="pages")


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
    def _health_extractor(data):
        status = data.get("status", "unknown")
        if status == "healthy":
            return "pass", f"running on {server.split('://')[-1]}"
        return "warn", f"status: {status}"
    checks.append(_check("Server Health", "/health", _health_extractor))

    # Check 2: Provider Status
    def _provider_extractor(data):
        name = data.get("name", "unknown")
        return "pass", f"{name} (active)"
    checks.append(_check("Provider Status", "/api/provider", _provider_extractor))

    # Check 3: Gateway Status
    def _gateway_extractor(data):
        gw_type = data.get("type", "unknown")
        agents = data.get("agents", 0)
        return "pass", f"{gw_type} ({agents} agents)"
    checks.append(_check("Gateway Status", "/api/provider/health", _gateway_extractor))

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
    console.print(Panel.fit(
        "[bold cyan]AIUI Doctor — Instance Diagnostic[/bold cyan]",
        border_style="cyan",
    ))
    console.print()

    status_icons = {"pass": "[green]✅[/green]", "warn": "[yellow]⚠️[/yellow]", "fail": "[red]❌[/red]"}

    for i, check in enumerate(checks, 1):
        icon = status_icons.get(check["status"], "❓")
        console.print(f"▶ {i}. {check['name']:20} {icon} {check['detail']}")

    console.print()
    console.print("═" * 43)
    console.print(f"  SUMMARY: [green]{passed} passed[/green], [yellow]{warnings} warning{'s' if warnings != 1 else ''}[/yellow], [red]{failed} failed[/red]")
    console.print("═" * 43)

    if failed > 0:
        raise typer.Exit(code=1)


# ---------------------------------------------------------------------------
# Test runner — ``aiui test chat|memory|sessions|endpoints|all``
# ---------------------------------------------------------------------------
from praisonaiui.test_runner import test_app
app.add_typer(test_app, name="test")


if __name__ == "__main__":
    app()
