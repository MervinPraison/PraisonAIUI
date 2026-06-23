"""Tests for version consistency between pyproject.toml and __version__.py"""

import sys
from pathlib import Path


def test_version_consistency():
    """Test that pyproject.toml version matches __version__.py"""
    # Python 3.11+ has tomllib in stdlib, older versions need tomli
    if sys.version_info >= (3, 11):
        import tomllib
    else:
        try:
            import tomli as tomllib
        except ImportError:
            # For Python < 3.11 without tomli, use a simple regex approach
            import re

            # Read pyproject.toml
            project_root = Path(__file__).parent.parent.parent
            pyproject_path = project_root / "pyproject.toml"
            with open(pyproject_path, "r") as f:
                content = f.read()

            # Extract version from pyproject.toml
            match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
            if not match:
                raise ValueError("Could not find version in pyproject.toml")
            pyproject_version = match.group(1)

            # Import and check __version__
            from praisonaiui import __version__

            assert __version__ == pyproject_version, (
                f"Version mismatch: pyproject.toml has {pyproject_version} "
                f"but __version__.py has {__version__}"
            )
            return

    # Standard approach with tomllib/tomli
    project_root = Path(__file__).parent.parent.parent
    pyproject_path = project_root / "pyproject.toml"

    with open(pyproject_path, "rb") as f:
        pyproject = tomllib.load(f)

    pyproject_version = pyproject["project"]["version"]

    from praisonaiui import __version__

    assert __version__ == pyproject_version, (
        f"Version mismatch: pyproject.toml has {pyproject_version} "
        f"but __version__.py has {__version__}"
    )
