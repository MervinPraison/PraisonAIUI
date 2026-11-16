# Installation

PraisonAIUI is one Python package. The PyPI name is `aiui`, you import it as
`praisonaiui`, and the command is `aiui`. The browser UI ships inside the
wheel, so you do not need Node.js or npm to run an app or build a docs site.

## Requirements

- Python 3.10 or higher
- Node.js only if you change the React frontend in a clone of the repository
  (version in `src/frontend/.nvmrc`)

## Install

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

Check the install:

```bash
aiui --version
# praisonaiui version 0.3.x
```

The wheel installs two commands that do the same thing: `aiui` and `praisonaiui`.

## Optional extras

The base install runs the server, the chat UI and `aiui build`. Extras add
integrations. Install one with `pip install "aiui[<extra>]"`.

| Extra | Adds |
|-------|------|
| `praisonai` | PraisonAI Agents, the PraisonAI wrapper, gateway and bot dependencies, for `--backend praisonai`. A YAML chat app (`aiui run chat.yaml`) needs only `pip install praisonaiagents` |
| `memory` | ChromaDB and LiteLLM for agent memory |
| `knowledge` | mem0, ChromaDB, MarkItDown and Chonkie for the knowledge base |
| `graph` | mem0 graph memory |
| `sql` | SQLAlchemy (async) and aiosqlite for `SQLAlchemyDataStore` |
| `postgres` | `sql` plus asyncpg |
| `bot` | Telegram, Discord and Slack bot libraries |
| `slack`, `discord`, `teams` | One channel's SDK only |
| `mcp` | The MCP client SDK |
| `a2ui` | PraisonAI Agents with A2UI support (agent canvas) |
| `langchain`, `llama-index`, `semantic-kernel` | Framework integrations |
| `all` | Every extra above |
| `dev` | pytest, ruff, mypy and the test dependencies (for contributors) |

The list is `[project.optional-dependencies]` in
[`pyproject.toml`](https://github.com/MervinPraison/PraisonAIUI/blob/main/pyproject.toml).

## No npm package is needed

Nothing in this repository is published to npm for the current UI:
`src/frontend/package.json` is private and its build is committed into the
Python package. Plugins for the React app shell import `@aiui/sdk`, which the
shell provides at runtime; see [UI plugins](../features/plugins.md).
The older `praisonaiui` package on npm (0.1.0) is a separate docs-site runtime,
described under [TypeScript SDK](../typescript/index.md); `aiui run` and
`aiui build` do not use it.

## Development install

To work on PraisonAIUI itself:

```bash
git clone https://github.com/MervinPraison/PraisonAIUI.git
cd PraisonAIUI
pip install -e ".[dev]"

# Only when you change src/frontend/src/**
cd src/frontend
npm ci
npm run build && npm run sync   # rebuild and copy the bundle into the package
```

See [Testing](../testing.md) for the test commands.

## Next steps

- [Quick Start](quickstart.md): run your first app
- [CLI Usage](cli.md): the commands you will use most
