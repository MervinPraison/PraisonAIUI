# Redirects and the not-found page

Move or rename a page without breaking the links people already have, and
choose what readers see on a URL with no page.

## Redirects

List moved pages under `redirects:` at the top level of `aiui.yaml`:

```yaml
redirects:
  - source: /docs/getting-started
    destination: /docs/quickstart
  - source: /docs/v1/:slug*          # everything under /docs/v1
    destination: /docs/:slug*
  - source: /blog/:year/:post
    destination: /news/:post
  - source: /docs/beta
    destination: /docs/preview
    permanent: false                 # 302 instead of 301
  - source: /support
    destination: https://example.com/help
```

| Key | Meaning |
|-----|---------|
| `source` | A site path starting with `/`. `:name` matches one path segment; a final `:name*` matches the rest of the path, including nothing (`/docs/v1/:slug*` matches `/docs/v1` and `/docs/v1/a/b`). |
| `destination` | A site path or a full URL. It can reuse the names from `source`. |
| `permanent` | `true` (default) answers with 301, `false` with 302. |

The first matching rule wins. Leave out the `--base-path` prefix: rules use
site paths and the build adds the base path.

### Where each kind of rule works

`aiui build` publishes every rule whose source is not a published page:

| Host | Exact source (`/docs/old`) | Wildcard source (`/docs/v1/:slug*`) |
|------|----------------------------|-------------------------------------|
| `aiui serve` | 301 / 302 | 301 / 302 (a file at the path wins) |
| Netlify, Cloudflare Pages | 301 / 302 from the `_redirects` file | 301 / 302 from `_redirects` |
| GitHub Pages, any static host | A stub page at the old URL (meta refresh, a canonical link, a script redirect) | The docs app follows the rule from the page-not-found view |

The query string and the `#section` carry over unless the destination sets
its own. A stub page never replaces a real file, and the redirect never sends
a crawler to a page it can't index: the stub has `noindex` and a canonical
link to the new URL.

The [link check](../api/cli.md#aiui-docs-check-links) treats every source as
a valid link, so old links in your pages don't fail the build while you
update them.

### Checks

`aiui validate` checks the exact rules:

| Code | Finding |
|------|---------|
| 7010 | The redirect loops, or ends at a path under the docs that is not a page |
| 7011 | A page is still published at the source, so the redirect never runs (delete the page or the rule) |

## The not-found page

A URL with no page shows "Page not found", a link home, the search, and up
to three pages from the sidebar whose names are close to the URL (a typo
such as `/docs/instalation` offers Installation). Set the heading and text
under `errors:`:

```yaml
errors:
  404:                     # or notFound
    title: This page moved
    description: |
      Most pages from the old site are now under **Guides**.
      [Contact us](https://example.com/help) if you can't find yours.
    redirect: false        # true: send readers to the home page instead
```

| Key | Default | Meaning |
|-----|---------|---------|
| `title` | `Page not found` | The heading and the browser tab title |
| `description` | A line naming the missing path | Markdown under the heading |
| `redirect` | `false` | `true` sends readers to the home page instead of showing the page |

A matching `redirects:` rule runs before any of this: the reader goes to the
new page, not the not-found page.
