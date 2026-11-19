---
title: AI-ready docs
description: Every page as clean Markdown for agents, llms.txt by nav group, llms-full.txt, agent instructions, Visibility, Accept text/markdown, an MCP server and Ask AI with cited answers.
---

# AI-ready docs

`aiui build` publishes each docs page twice: the page people read, and the
same page as clean Markdown for AI agents. Nothing to configure, and it works
on any static host.

| URL | What it holds |
|---|---|
| `/docs/<page>.md` | the page as agent-ready Markdown (below) |
| `/llms.txt` | the [llmstxt.org](https://llmstxt.org) index: one `##` section per nav group, each page linked as its `.md` |
| `/llms-full.txt` | every indexed page's agent-ready Markdown in one file |
| `/.well-known/llms.txt`, `/.well-known/llms-full.txt` | copies, where some agents look first |

Each page's HTML names its Markdown (`<link rel="alternate" type="text/markdown" href="…/docs/guide/install.md">`).
Links are absolute with a site URL (`seo.siteUrl` or a `CNAME`, see
[SEO](seo.md)), root-relative otherwise. Hidden and `noindex` pages stay out
of the llms files. An `llms.txt` or `llms-full.txt` next to `aiui.yaml` is
published as it is.

## The agent-ready Markdown

| In the source | In the `.md` |
|---|---|
| front matter | `# Title`, then `> description` |
| `<Note>`, `<Warning title="…">`, … | a blockquote with a bold label: `> **Note:** …` |
| `<Tabs>` / `<Tab title="pip">` | one heading per tab, a level under the heading above |
| `<Steps>` / `<Step title="Install">` | a numbered list: `1. **Install**` |
| `<Card title="Guide" href="guide.md">` | a list item: `- [Guide](https://…/docs/guide.md)` |
| `<ParamField>`, `<ResponseField>` (in `<Expandable>`), `<RequestExample>`, `<Panel>` | `` - `user_id` (path, string, required): … `` (nested one level); a bold "Request example" over its fences; the content |
| `<Accordion>`, `<Frame>`, other tags, comments | their content (a bold title, an italic caption); comments removed |
| links to pages (`setup.md`, `/docs/setup`) | absolute `.md` URLs; other links absolute URLs |

Code is never changed. **Copy page**, **View as Markdown** and **Open in
ChatGPT / Claude** use this version; the browser renders the untouched source,
published as `/docs/<page>.source.md`. `.mdx` pages work the same way, and are
in search and `llms-full.txt`.

## Agent instructions

```yaml
markdown:
  instructions:            # or one string
    - Cite the page URL you used.
    - Prefer the `aiui` CLI over editing generated files.
```

Every `.md`, `llms.txt` and `llms-full.txt` then carries, under the title, a
`> ## Agent instructions` quote block with these lines.

## Content for people or for agents only

```mdx
<Visibility for="humans">Click **Deploy** in the top bar.</Visibility>
<Visibility for="agents">Run `aiui build` and upload the output folder.</Visibility>
```

`for="humans"` shows on the page and in site search only; `for="agents"` only
in the `.md` and the llms files.

## Accept: text/markdown

`aiui serve` answers a page URL with its Markdown when `Accept` ranks
`text/markdown` at least as high as `text/html` (browsers still get the page):

```bash
curl -H "Accept: text/markdown" http://127.0.0.1:8000/docs/guide/install
```

## MCP server

`aiui serve` and `aiui dev` also run an
[MCP](https://modelcontextprotocol.io) server for the site at `/mcp`, so an
editor's agent can search and read the docs while it works, and tell you when
a page let it down. Nothing to install or configure:

| Tool | What it returns |
|---|---|
| `search_docs(query, limit=10)` | the best matching pages and sections (ranked as the search dialog ranks them), each with its path, URL and a snippet |
| `read_page(path)` | one page's agent-ready Markdown; `path` is a page path (`/docs/guide/install`) or URL |
| `list_pages()` | every page by nav group (`llms.txt`) |
| `submit_feedback(path, helpful, comment?)` | stores a vote on a page, like a reader's "Was this page helpful?", with `source: agent` |

The first three are read-only. `submit_feedback` lets an agent report a page
that is wrong, outdated, unclear or missing what it needed, so docs problems
reach you from the agents reading them. Reports land in the same
store as readers' votes, so `aiui docs feedback` counts them together (in the
CSV and JSON exports `source` tells them apart), under the same limits as the page's vote
button: 20 a minute per client (shared with `/api/docs/feedback`), 4 KiB, a
1,000-character comment, and only for pages that exist. The tool is not
listed when [page feedback](writing-docs.md#page-feedback) is off
(`feedback: false`) or posted to your own `endpoint`.

Connect from the page menu (**Copy MCP server URL**, **Connect to Cursor**,
**Connect to VS Code**), or add it by hand:

```json
{ "mcpServers": { "acme-docs": { "url": "https://docs.acme.dev/mcp" } } }
```

Agents also find it on their own: `/.well-known/mcp` (also `mcp.json` and
`mcp/server-card.json`) serves a server card with the endpoint and the tools,
and `llms.txt` ends with an "MCP server" section linking it.

The transport is Streamable HTTP (JSON-RPC over `POST`, protocol versions
2025-03-26 to 2025-11-25) and stateless. Requests whose `Host` is
not a name the server answers to (DNS rebinding; behind a reverse proxy on the
same machine list the public name in `AIUI_ALLOWED_HOSTS`) or that come from
another site's page (`Origin`; allow one with `--cors-origins` or
`AIUI_ALLOWED_ORIGINS`) are refused. To turn the server off:

```yaml
content:
  docs:
    dir: docs
    mcp: false
```

A static host (GitHub Pages, any CDN) runs no server, so it has no `/mcp`
and the menu shows no MCP items; the `.md` pages and llms files above still
work there.

## Ask AI

`aiui serve` and `aiui dev` also answer questions about the docs, with the
sections each answer came from. Set a model key in the environment and
serve; there is nothing to configure:

```bash
export OPENAI_API_KEY=sk-...
aiui serve
```

The server ranks the build's sections for the question (the same ranking as
search, widened so a long question still finds its pages), sends the best six
to the model and streams a Markdown answer that cites them as `[1]`, `[2]`.
Your key stays on the server: it is read from the environment and never logged
or sent to the browser.

| Model setting | Where |
|---|---|
| `content.docs.assistant.model`, else `AIUI_ASSISTANT_MODEL`, else `OPENAI_MODEL_NAME`, else `gpt-4o-mini` | which model answers |
| `OPENAI_API_KEY`, `OPENAI_BASE_URL` | any OpenAI-compatible API, including a local server (`OPENAI_BASE_URL=http://localhost:11434/v1` needs no key) |
| a `provider/model` name such as `anthropic/claude-sonnet-4-5` | goes through LiteLLM when it is installed, with that provider's key |

Without a key the endpoint still answers: it returns the best matching
sections and says AI answers are not set up, so readers never hit an error.

```yaml
content:
  docs:
    dir: docs
    assistant:
      starters: ["How do I install it?", "How do I change the theme?"]
      instructions: Call the product Acme, never "the tool".
      # model: gpt-4o-mini
      # endpoint: https://docs-api.acme.dev/api/docs/ask   # static host only
```

| Key | Default | What it does |
|---|---|---|
| `starters` | none | up to six questions offered before the reader asks |
| `instructions` | none | extra rules for every answer (tone, names, scope); up to 4,000 characters |
| `model` | see above | the model |
| `endpoint` | none | on a static host, the ask URL of an `aiui serve` running the same build |

The docs site's Ask AI panel (⌘I, starter questions, ask about a selected
passage, an `assistant` page mode) is **(planned)**; until it lands, call the
API below. `assistant: false` turns it off. The build writes these settings into
`ui-config.json`, which is public: keep secrets out of `instructions`.

### The HTTP API

`POST /api/docs/ask` with `{"question": "...", "context": "...", "page": "/docs/x", "history": [{"role": "user", "content": "..."}]}`
(only `question` is required; `context` is a quoted passage, `history` the
earlier turns) answers with Server-Sent Events:

| Event | Data |
|---|---|
| `sources` | `[{"n": 1, "title", "heading", "path", "url", "snippet"}]`, the sections the answer may cite as `[n]` |
| `text` | `{"text": "..."}`, the next piece of the Markdown answer |
| `done` | `{}` |
| `unavailable` | `{"message": "..."}` instead of `text` when no model is set up |
| `error` | `{"message": "..."}` when the model call failed |

`GET /api/docs/search?q=install&limit=10` returns `{"results": [{"title", "heading", "anchor", "path", "url", "snippet"}]}`,
ranked as the search dialog ranks them, and each page's Markdown is at
`/docs/<page>.md`, so another app can embed docs search and answers.

The endpoints are public like the site, so they are guarded: 10 questions a
minute per client, a 32 KiB body, a 2,000-character question, the same `Host`
and `Origin` checks as the MCP server, and `application/json` or `text/plain`
bodies (a static site on another origin posts `text/plain`, allowed with
`--cors-origins` or `AIUI_ALLOWED_ORIGINS`). Answers spend your key, so put a
public site behind your own rate limits too.
