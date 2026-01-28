# PraisonAIUI Monorepo

[![Python Tests](https://github.com/MervinPraison/PraisonAIUI/actions/workflows/ci.yml/badge.svg)](https://github.com/MervinPraison/PraisonAIUI/actions)
[![npm version](https://badge.fury.io/js/praisonaiui.svg)](https://badge.fury.io/js/praisonaiui)
[![PyPI version](https://badge.fury.io/py/praisonaiui.svg)](https://badge.fury.io/py/praisonaiui)

> **One YAML file, one docs folder, one command — ship a beautiful documentation site.**

PraisonAIUI is a YAML-driven website generator that transforms a single configuration file and a docs folder into a modern, production-ready website.

## Quick Start

### Installation

```bash
# Python CLI (compiler)
pip install praisonaiui

# TypeScript runtime (React/Next.js)
npm install praisonaiui
```

### Usage

1. Create your config file:

```yaml
# aiui.template.yaml
site:
  title: "My Docs"

content:
  docs:
    dir: "./docs"

templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      main: { type: "DocContent" }

routes:
  - match: "/docs/**"
    template: "docs"
```

2. Run the CLI:

```bash
aiui build
```

3. Start your Next.js dev server:

```bash
npm run dev
```

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`src/praisonaiui`](./src/praisonaiui) | CLI + compiler | `pip install aiui` |
| [`src/praisonaiui-ts`](./src/praisonaiui-ts) | React runtime + Next.js adapter | `npm install praisonaiui` |

## Documentation

- [Getting Started](./docs/getting-started/index.md)
- [Configuration Guide](./docs/guides/configuration.md)
- [API Reference](./docs/api/cli.md)

## Development

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

### Running Tests

```bash
# Python tests (from repo root)
pytest tests -v

# TypeScript tests
cd src/praisonaiui-ts && pnpm test
```

## Engineering Principles

- **DRY**: Schema defined once, shared across packages
- **TDD**: Tests first, implementation second
- **Minimal Impact**: Smallest change that solves the problem

## License

MIT © [Praison Limited](https://praison.ai)
