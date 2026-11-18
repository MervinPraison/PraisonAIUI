---
title: AI-ready docs
description: Every page as clean Markdown for agents, llms.txt by nav group, llms-full.txt, agent instructions, Visibility and Accept text/markdown.
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
