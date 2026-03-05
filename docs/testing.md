# Testing

PraisonAIUI uses [pytest](https://pytest.org) for all testing. Tests are split into unit and integration categories.

## Running Tests

```bash
# Install dev dependencies
pip install -e ".[dev]"

# Run all tests
pytest tests/unit tests/integration -v

# Run with coverage report
pytest tests/unit tests/integration -v --cov=src/praisonaiui --cov-report=term-missing
```

## Test Categories

### Unit Tests (`tests/unit/`)

Fast, isolated tests that do not start servers or make network calls.

| Module | File | Count | Description |
|--------|------|-------|-------------|
| Schema Models | `test_schema.py` | 9 | Validates all Pydantic models: `SiteConfig`, `ContentConfig`, `TemplateConfig`, `RouteConfig`, `Config`. Covers defaults, all-fields, and `model_validate()` |
| Validators | `test_validators.py` | 4 | Tests `validate_config()` — broken component refs, missing template refs in routes, missing docs directories |
| Compiler | `test_compiler.py` | 16 | Tests the full compilation pipeline: `ui-config.json`, `route-manifest.json`, template slot serialization, validation failures, output files, minification, `docs-nav.json` |
| Docs Scanner | `test_scanner.py` | 7 | Tests `DocsScanner` — empty dirs, frontmatter extraction, index files, nested structures, exclude patterns, number-prefix ordering |
| Serve | `test_serve.py` | 9 | Tests serve command registration, port handling, SPA fallback, JSON manifest serving, auto-build toggle |
| Plugins | `test_plugins.py` | 8 | Tests `PluginManager` registration, hooks, chaining, `BasePlugin` defaults, global singleton |
| i18n & a11y | `test_i18n_a11y.py` | 9 | Tests internationalization and accessibility config models |

**Total: 62 unit tests**

### Integration Tests (`tests/integration/`)

End-to-end tests that exercise the full CLI pipeline using temporary directories.

| Module | File | Count | Description |
|--------|------|-------|-------------|
| CLI Pipeline | `test_cli.py` | 11 | Full `validate → build → serve` pipeline, init command, error handling |

**Total: 11 integration tests**

### Manual / Browser Tests

These are not automated but are documented here for completeness:

| Test | How to Run | What to Verify |
|------|-----------|----------------|
| Live serve | `aiui build && aiui serve` | Page loads, sidebar navigates, TOC updates |
| SPA routing | Click sidebar items | URL updates without page reload |
| Path traversal | `curl --path-as-is 'http://localhost:8000/%2e%2e/etc/passwd'` | Returns 403 |
| CORS | `curl -sI -H 'Origin: http://evil.com' http://localhost:8000/` | No access-control headers |
| SSL | `aiui serve --ssl-certfile cert.pem --ssl-keyfile key.pem` | HTTPS URL shown in output |
| All docs serve | Visit each sidebar link | Markdown content renders |
| Favicon | Check browser tab | SVG icon visible |

## Architecture Diagram

```
aiui.template.yaml
        │
        ▼
┌───────────────┐     tests/unit/test_schema.py
│  Schema Models│◄──── tests/unit/test_validators.py
│  (Pydantic)   │
└──────┬────────┘
       │
       ▼
┌───────────────┐     tests/unit/test_compiler.py
│   Compiler    │◄──── tests/unit/test_scanner.py
│  (Pipeline)   │
└──────┬────────┘
       │
       ▼
┌───────────────┐     tests/unit/test_serve.py
│  Serve (CLI)  │◄──── tests/integration/test_cli.py
│ Starlette+Uvi │
└───────────────┘

┌───────────────┐     tests/unit/test_plugins.py
│  Plugin System│
└───────────────┘

┌───────────────┐     tests/unit/test_i18n_a11y.py
│  i18n & a11y  │
└───────────────┘
```

## Writing Tests

See [tests/README.md](../tests/README.md) for conventions, examples, and templates.
