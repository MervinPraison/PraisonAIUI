# Python API Reference

Programmatic API for the PraisonAIUI compiler.

## Core Classes

### Config

Main configuration model.

```python
from praisonaiui import Config

# From file
config = Config.from_yaml("aiui.template.yaml")

# From dict
config = Config(**{
    "schemaVersion": 1,
    "site": {"title": "My Site"},
    ...
})
```

### Compiler

Compile configuration to manifests.

```python
from praisonaiui.compiler import Compiler

compiler = Compiler(config)
result = compiler.compile()
```

### CompileResult

```python
@dataclass
class CompileResult:
    ui_config: dict       # Site configuration
    docs_nav: dict        # Navigation tree
    route_manifest: dict  # Route mappings
    errors: list[str]     # Any errors
```

## Schema Models

### SiteConfig

```python
from praisonaiui.schema import SiteConfig

site = SiteConfig(
    title="My Site",
    description="Description",
    ui="shadcn",
    theme={"darkMode": True}
)
```

### ContentConfig

```python
from praisonaiui.schema import ContentConfig

content = ContentConfig(
    docs=DocsConfig(
        dir="./docs",
        include=["**/*.md"]
    )
)
```

## DocsScanner

Scan docs directory for pages.

```python
from praisonaiui.compiler import DocsScanner

scanner = DocsScanner(
    docs_dir=Path("./docs"),
    include=["**/*.md"],
    exclude=["**/drafts/**"]
)

pages = scanner.scan()
for page in pages:
    print(page.slug, page.title)
```

## NavBuilder

Build navigation tree.

```python
from praisonaiui.compiler import NavBuilder

builder = NavBuilder(pages)
nav = builder.build()
```
