# Tests

## Quick Start

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run all tests
pytest tests/unit tests/integration -v

# Run only unit tests
pytest tests/unit -v

# Run only integration tests
pytest tests/integration -v

# Run with coverage
pytest tests/unit tests/integration -v --cov=src/praisonaiui --cov-report=term-missing

# Run a specific test file
pytest tests/unit/test_compiler.py -v

# Run a specific test class
pytest tests/unit/test_compiler.py::TestCompilerUiConfig -v

# Run a single test
pytest tests/unit/test_compiler.py::TestCompilerUiConfig::test_minimal_ui_config -v
```

## Test Structure

```
tests/
├── unit/                         # Fast, isolated tests (no I/O, no server)
│   ├── test_schema.py            # Pydantic models: Config, SiteConfig, etc.
│   ├── test_validators.py        # Config validation: broken refs, missing dirs
│   ├── test_compiler.py          # Compilation pipeline: JSON generation, slots
│   ├── test_scanner.py           # Docs scanner: frontmatter, slugs, ordering
│   ├── test_serve.py             # Serve command: SPA handler, ports, auto-build
│   ├── test_plugins.py           # Plugin system: register, hooks, global manager
│   └── test_i18n_a11y.py         # i18n and accessibility config models
│
└── integration/                  # End-to-end CLI tests (uses tmp filesystem)
    └── test_cli.py               # validate → build → serve pipeline
```

## Test Categories

### Unit Tests (68 tests, ~0.5s)

| File | Tests | What It Covers |
|------|-------|----------------|
| `test_schema.py` | 9 | Pydantic models — `SiteConfig`, `ContentConfig`, `TemplateConfig`, `RouteConfig`, `Config`. Tests defaults, field validation, `model_validate()` from dict |
| `test_validators.py` | 4 | `validate_config()` — catches broken component refs, missing template refs in routes, missing docs directories |
| `test_compiler.py` | 16 | `Compiler.compile()` — `ui-config.json` generation, `route-manifest.json`, template slot ref serialization, broken ref detection, output file creation, minification, `docs-nav.json` generation |
| `test_scanner.py` | 7 | `DocsScanner` — empty dirs, single files, frontmatter extraction, index files, nested structures, exclude patterns, number-prefix ordering |
| `test_serve.py` | 9 | Serve command — exists in CLI, requires output dir, port handling, SPA fallback, static file serving, JSON manifest serving, auto-build toggle |
| `test_plugins.py` | 8 | `PluginManager` — register/unregister, duplicate detection, hook chaining, `BasePlugin` defaults, global singleton pattern |
| `test_i18n_a11y.py` | 9 | `I18nConfig` defaults/RTL/fallback, `A11yConfig` defaults/ARIA labels/reduce-motion, `Config` integration with both |

### Integration Tests (11 tests, ~0.5s)

| File | Tests | What It Covers |
|------|-------|----------------|
| `test_cli.py` | 11 | Full CLI pipeline — `validate` (valid/missing config), `build` (output structure, UI config content, minification, invalid config, broken refs), `serve` (missing output, help flags), `init` help, full `validate → build → verify` pipeline |

## Writing New Tests

### Conventions

1. **File naming**: `test_<module>.py` — mirrors the source module
2. **Class naming**: `TestClassName` — groups related tests
3. **Test naming**: `test_<what_it_does>` — descriptive, reads like a sentence
4. **Docstrings**: Every test class and method has a docstring explaining what's tested
5. **Fixtures**: Use `tmp_path` (pytest built-in) for filesystem tests, `@pytest.fixture` for shared configs
6. **Imports**: Import from `praisonaiui.*`, not relative paths

### Adding a Unit Test

```python
"""Tests for <module name>."""

import pytest
from praisonaiui.<module> import <class>


class TestMyFeature:
    """Tests for <feature>."""

    def test_basic_behavior(self):
        """Test the basic functionality works."""
        result = <class>.do_something()
        assert result == expected

    def test_edge_case(self, tmp_path):
        """Test an edge case with filesystem."""
        (tmp_path / "file.md").write_text("# Hello")
        result = <class>.process(tmp_path)
        assert result is not None
```

### Adding an Integration Test

```python
"""Integration tests for <feature>."""

from typer.testing import CliRunner
from praisonaiui.cli import app

runner = CliRunner()


class TestMyCommand:
    """Tests for the `aiui <command>` command."""

    def test_command_works(self, project_dir):
        result = runner.invoke(app, ["<command>", "--flag", "value"])
        assert result.exit_code == 0
```

## CI/CD

Tests run on every push and PR via `.github/workflows/ci.yml`:

```yaml
- run: pip install -e ".[dev]"
- run: ruff check src/ tests/
- run: pytest tests/unit tests/integration -v
```

Both `ruff` and `pytest` must pass — failures block merges.
