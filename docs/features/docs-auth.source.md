# Docs sign-in

Put a docs site behind a password, keep some pages open to everyone, and limit
others to a group of readers. `aiui serve` and `aiui dev` enforce it; there is
nothing to install and no account system to run.

## A password for the whole site

```yaml
content:
  docs:
    dir: docs
    auth:
      password: env:DOCS_PASSWORD
```

```bash
aiui build
DOCS_PASSWORD='a long passphrase' aiui serve
```

Every page now asks for the password. A reader who opens any page gets a sign-in
page in the site's own theme, at that URL, and lands on the page they asked for.
The session lasts seven days. `/__aiui/login` shows who is signed in and a
**Sign out** button (link to it from `navbar.links` if you want one).

Passwords are always written `env:NAME`: the build stores the variable's name,
never the password. Change the variable and restart to change the password;
every reader signed in with the old one is signed out.

## Open pages

Most docs want a public home and quickstart and the rest behind sign-in:

```yaml
auth:
  password: env:DOCS_PASSWORD
  public: ["/", quickstart, "guides/*"]
```

`public` lists page paths relative to the docs (`/` is the home page,
`/docs/quickstart` also works) and patterns (`*` matches any part of a path). A
page can also say it in its front matter:

```markdown
---
title: Pricing
public: true
---
```

`public: false` keeps a page behind sign-in when a pattern would open it, so
`public: ["*"]` plus `public: false` on a few pages protects only those.

## A password per reader

```yaml
auth:
  password: env:DOCS_PASSWORD          # optional: a shared password
  users:
    alice: env:ALICE_PASSWORD
    bob: env:BOB_PASSWORD
```

Readers sign in with their password alone; it tells the server who they are.

## Groups

Give readers groups, then name the groups a page is for:

```yaml
auth:
  users:
    alice: {password: env:ALICE_PASSWORD, groups: [partners]}
```

```markdown
---
title: Partner API
groups: [partners]
---
```

A page with `groups` is for readers in at least one of them. To any other
signed-in reader it does not exist: a 404, and it is missing from their sidebar,
search, `llms.txt`, MCP and Ask AI. A signed-out reader who opens it gets the
sign-in page (they may be a member).

## What is protected

A page's rule covers everything made from it: its HTML (including the copy
inside `<noscript>`), its `.md` and `.source.md` files and `Accept:
text/markdown` answer, its social card under `/og/`, its Try it data and its RSS
feed. `docs-nav.json`, `search-index.json`, `llms.txt` and `llms-full.txt` (and
their `/.well-known/` copies) hold only the pages the reader may read (so the
pages do not carry the navigation, as they do on a site without sign-in, and
the build writes no split search index, `search-index/`: search reads the cut
`search-index.json`), and the
[MCP server](ai-ready-docs.md#mcp-server), [Ask AI](ai-ready-docs.md#ask-ai),
`/api/docs/search` and page feedback see only those pages. An AI tool that
connects to `/mcp` without the browser's cookie reads the open pages. The
sitemap lists only open pages.

Code, styles, fonts, images and `ui-config.json` are open to anyone, so open
pages render (do not put a secret in an image). Any other file (OpenAPI specs, a
nav group's generated page, files you copied in) needs sign-in.

## Security

- Protected answers carry `Cache-Control: private`, so a shared cache never
  hands one reader's page to another.
- The session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` over HTTPS
  (also behind a proxy that sets `X-Forwarded-Proto`). It is signed with a key
  derived from the reader's password.
- Passwords are compared in constant time. Ten wrong passwords from one address
  in ten minutes block that address for the rest of the ten minutes (429).
- Sign-in and sign-out only accept a form posted from the site itself
  (`AIUI_ALLOWED_ORIGINS` adds origins, as for the rest of aiui).
- A password variable that is not set is logged as a warning; that reader
  cannot sign in.

## Static hosts

Sign-in needs the aiui server. A static host (GitHub Pages, a CDN) serves every
file of the build, so `aiui build` warns (7017) on a site with
`content.docs.auth`; serve it with `aiui serve` ([deployment](deployment.md)).
`aiui validate` reports front matter `public` or `groups` on a site without
`content.docs.auth`, and a group no reader is in (7017). A docs folder served by `aiui run` uses the app's own
sign-in instead ([deployment](deployment.md#auth-enforcement)).
