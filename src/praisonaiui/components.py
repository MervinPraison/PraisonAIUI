"""
Component management for PraisonAIUI.

Handles auto-installation of shadcn/ui components at build time.
"""

import subprocess
from pathlib import Path
from typing import Optional
from rich.console import Console

console = Console()

# List of available shadcn components (from registry)
SHADCN_COMPONENTS = [
    "accordion", "alert", "alert-dialog", "aspect-ratio", "avatar",
    "badge", "breadcrumb", "button", "calendar", "card", "carousel",
    "chart", "checkbox", "collapsible", "command", "context-menu",
    "data-table", "date-picker", "dialog", "drawer", "dropdown-menu",
    "form", "hover-card", "input", "input-otp", "label", "menubar",
    "navigation-menu", "pagination", "popover", "progress", "radio-group",
    "resizable", "scroll-area", "select", "separator", "sheet", "sidebar",
    "skeleton", "slider", "sonner", "switch", "table", "tabs", "textarea",
    "toast", "toggle", "toggle-group", "tooltip"
]


def get_frontend_path() -> Path:
    """Get the path to the frontend source directory."""
    # First check relative to the package itself (development mode)
    # __file__ = src/praisonaiui/components.py
    # parent.parent = src/
    # We want to find src/frontend (sibling of praisonaiui)
    package_src_dir = Path(__file__).parent.parent  # src/praisonaiui -> src
    dev_frontend = package_src_dir / "frontend"
    if dev_frontend.exists() and (dev_frontend / "package.json").exists():
        return dev_frontend
    
    # Fall back to templates in installed package
    templates_frontend = Path(__file__).parent / "templates" / "frontend"
    if templates_frontend.exists():
        return templates_frontend
    
    # Last resort: current working directory
    local_frontend = Path.cwd() / "src" / "frontend"
    if local_frontend.exists():
        return local_frontend
    
    # Return the templates path even if it doesn't exist (will fail gracefully)
    return templates_frontend


def get_installed_components(frontend_path: Optional[Path] = None) -> list[str]:
    """
    Scan the frontend/src/components/ui directory for installed components.
    
    Returns:
        List of installed component names (without .tsx extension)
    """
    if frontend_path is None:
        frontend_path = get_frontend_path()
    
    components_dir = frontend_path / "src" / "components" / "ui"
    if not components_dir.exists():
        return []
    
    installed = []
    for file in components_dir.glob("*.tsx"):
        name = file.stem  # Get filename without extension
        if name in SHADCN_COMPONENTS:
            installed.append(name)
    
    return installed


def install_shadcn_component(name: str, frontend_path: Optional[Path] = None) -> bool:
    """
    Install a single shadcn component using npx.
    
    Args:
        name: Component name (e.g., "accordion", "card")
        frontend_path: Path to frontend directory
        
    Returns:
        True if installation succeeded
    """
    if name not in SHADCN_COMPONENTS:
        console.print(f"[yellow]Warning: '{name}' is not a known shadcn component[/yellow]")
    
    if frontend_path is None:
        frontend_path = get_frontend_path()
    
    try:
        result = subprocess.run(
            ["npx", "shadcn@latest", "add", name, "--yes", "--overwrite"],
            cwd=frontend_path,
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout per component
        )
        
        if result.returncode == 0:
            console.print(f"[green]✓[/green] Installed {name}")
            return True
        else:
            console.print(f"[red]✗ Failed to install {name}:[/red] {result.stderr[:200]}")
            return False
            
    except subprocess.TimeoutExpired:
        console.print(f"[red]✗ Timeout installing {name}[/red]")
        return False
    except FileNotFoundError:
        console.print("[red]Error: npx not found. Please install Node.js.[/red]")
        return False


def ensure_components(required: list[str], frontend_path: Optional[Path] = None) -> tuple[int, int]:
    """
    Ensure all required components are installed.
    
    Args:
        required: List of required component names
        frontend_path: Path to frontend directory
        
    Returns:
        Tuple of (installed_count, failed_count)
    """
    if not required:
        return (0, 0)
    
    if frontend_path is None:
        frontend_path = get_frontend_path()
    
    # Get currently installed components
    installed = set(get_installed_components(frontend_path))
    
    # Find missing components
    missing = [comp for comp in required if comp not in installed]
    
    if not missing:
        console.print(f"[dim]All {len(required)} required components already installed[/dim]")
        return (0, 0)
    
    console.print(f"[cyan]Installing {len(missing)} missing component(s)...[/cyan]")
    
    installed_count = 0
    failed_count = 0
    
    for component in missing:
        if install_shadcn_component(component, frontend_path):
            installed_count += 1
        else:
            failed_count += 1
    
    return (installed_count, failed_count)


def list_available_components() -> list[str]:
    """Get list of all available shadcn components."""
    return SHADCN_COMPONENTS.copy()


def update_component_exports(frontend_path: Optional[Path] = None) -> bool:
    """
    Update the components/index.ts to export newly installed components.
    
    This scans the components/ui directory and ensures all components
    are properly exported from the index file.
    
    Returns:
        True if successful
    """
    if frontend_path is None:
        frontend_path = get_frontend_path()
    
    installed = get_installed_components(frontend_path)
    index_path = frontend_path / "src" / "components" / "index.ts"
    
    if not index_path.exists():
        console.print("[yellow]Warning: components/index.ts not found[/yellow]")
        return False
    
    # Read current exports
    current_content = index_path.read_text()
    
    # Check which components are missing from exports
    missing_exports = []
    for component in installed:
        # Convert kebab-case to component check
        export_pattern = f"from './ui/{component}'"
        if export_pattern not in current_content:
            missing_exports.append(component)
    
    if not missing_exports:
        return True
    
    # Append missing exports
    new_exports = []
    for component in missing_exports:
        # Simple export - actual component names would need to be inferred
        new_exports.append(f"export * from './ui/{component}'")
    
    with open(index_path, "a") as f:
        f.write("\n// Auto-added component exports\n")
        for export in new_exports:
            f.write(f"{export}\n")
    
    console.print(f"[green]Added {len(missing_exports)} component export(s)[/green]")
    return True
