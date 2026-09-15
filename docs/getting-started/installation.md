# Installation

Install PraisonAIUI to start building YAML-driven websites.

## Requirements

- Python 3.9 or higher
- Node.js 18+ (for TypeScript runtime)
- Next.js 14+ (optional, for React components)

## Python Package (CLI)

=== "pip"

    ```bash
    pip install aiui
    ```

=== "uv"

    ```bash
    uv pip install aiui
    ```

=== "pipx"

    ```bash
    pipx install aiui
    ```

After installation, verify:

```bash
aiui --version
# praisonaiui version 0.1.0
```

## TypeScript Package (Runtime)

=== "npm"

    ```bash
    npm install praisonaiui
    ```

=== "pnpm"

    ```bash
    pnpm add praisonaiui
    ```

=== "yarn"

    ```bash
    yarn add praisonaiui
    ```

## Development Installation

For contributing or local development:

```bash
# Clone the repo
git clone https://github.com/MervinPraison/PraisonAIUI.git
cd PraisonAIUI

# Install Python package in dev mode
pip install -e .[dev]

# Install TypeScript package
cd src/praisonaiui-ts
pnpm install
```

## Next Steps

- [Quick Start](quickstart.md) - Create your first project
- [CLI Usage](cli.md) - Learn all CLI commands
