# Installation

> PraisonAIUI is one Python package. The PyPI name is aiui, you import it as

PraisonAIUI is one Python package. The PyPI name is `aiui`, you import it as
`praisonaiui`, and the command is `aiui`. The browser UI ships inside the
wheel, so you do not need Node.js or npm to run an app or build a docs site.

## Requirements

Python 3.10 or higher.

> **Note: No Node.js needed**
>
> The browser UI ships inside the wheel. You need Node.js only to change the
> React frontend in a clone of the repository (version in `src/frontend/.nvmrc`).

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

> **Check:**
> A version number means the `aiui` command is on your path. Next: the
> [quick start](https://ui.praison.ai/docs/getting-started/quickstart.md).

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
shell provides at runtime; see [UI plugins](https://ui.praison.ai/docs/features/plugins.md).
The older `praisonaiui` package on npm (0.1.0) is a separate docs-site runtime,
described under [TypeScript SDK](https://ui.praison.ai/docs/typescript.md); `aiui run` and
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

See [Testing](https://ui.praison.ai/docs/testing.md) for the test commands.

## Next steps

- [Quick Start](https://ui.praison.ai/docs/getting-started/quickstart.md): run your first app
- [CLI Usage](https://ui.praison.ai/docs/getting-started/cli.md): the commands you will use most

## Related pages

- [TypeScript SDK Overview](https://ui.praison.ai/docs/typescript.md)
- [Quick Start](https://ui.praison.ai/docs/getting-started/quickstart.md)
- [Architecture](https://ui.praison.ai/docs/concepts/architecture.md)
