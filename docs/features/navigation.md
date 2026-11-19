# Navigation

`aiui build` turns the docs folder into the sidebar (`docs-nav.json`). YAML
`navigation.tabs` then splits that sidebar into tabs.

## The Generated Sidebar

Each folder becomes a section and each Markdown file an entry:

- Inside a folder, pages sort by frontmatter `order`, then by file name (see
  [Content Sources](content-sources.md#frontmatter)).
- A folder's section takes the title of its `index.md` (or another
  `indexFiles` name) and links to it; a folder without one is titled with
  its name, title-cased. Link a folder's index page by the folder (`notes/`).
- An entry's title is the frontmatter `title`, else the first `#` heading.

The generated tree looks like this:

```json
{
  "items": [
    {
      "title": "Getting Started",
      "path": "/docs/getting-started",
      "children": [
        { "title": "Installation", "path": "/docs/getting-started/installation" },
        { "title": "Quick Start", "path": "/docs/getting-started/quickstart" }
      ]
    }
  ]
}
```

`content.docs.nav.mode` picks between this generated sidebar (`auto`, the
default) and one you list in YAML (below). Options for the generated sidebar:

```yaml
content:
  docs:
    indexFiles: [index.md, README.md, _index.md]   # files that name their folder
    nav:
      sort: alpha        # filesystem (default) | alpha (title) | date (frontmatter `date`, newest first)
      collapsible: false # groups never fold (default: true)
      directory: card    # card | accordion: list each folder's pages (Directory Listings)
```

Frontmatter `order` wins over `sort`. A folder's index page is its section's
own page (the label links there).

## A Sidebar at the Root

`navigation.pages` and `navigation.groups` list the sidebar in order, with no
tab or `nav.mode` needed:

```yaml
navigation:
  pages:
    - index                   # a top-level page
    - group: "API"
      root: api/overview      # the group's own page: its label and breadcrumb link there
      tag: "New"              # a badge after the label (up to 24 characters)
      pages:
        - api/auth
        - group: "Errors"
          expanded: false     # starts folded
          pages: [api/errors]
  groups:
    - group: "Guides"
      directory: card         # list the group's pages on its page
      pages: [guide/setup, guide/deploy]
```

These group keys work in tab groups too.

## Folding Groups

Every group folds: click its label, or the chevron beside a label that links
to a page. Each reader's choice is remembered across reloads and visits. The
group holding the current page always opens. `interaction.drilldown: true`
makes a group label with no page of its own open the group's first page.

```yaml
interaction:
  drilldown: true
```

## Directory Listings

`directory: card` (a card grid) or `accordion` (a row per page) lists a
group's pages with their descriptions at the end of the group's page. A group
with no `root` gets a generated page at `/docs/<group-slug>` (`Guides` is
`/docs/guides`), or uses the page already there. `content.docs.nav.directory`
does this for every folder of the generated sidebar.

## Breadcrumbs

The line above a page title is the page's group. `styling.eyebrows:
breadcrumbs` shows every group above it, each with a page of its own linked.
Every page's HTML carries a schema.org `BreadcrumbList` for search engines.

```yaml
styling:
  eyebrows: breadcrumbs   # section (default) | breadcrumbs
```

## Checks

`aiui validate` and `aiui build` warn about a listed page name that matches no
page (code 2101, with the closest name; `aiui validate --strict` fails), a tab,
anchor or dropdown with nothing to open (2102) and about keys that
do nothing yet (1004: `nav.maxDepth`, `i18n.fallbackLocale`, `translationsDir`).

## A Sidebar You List (`mode: manual`)

With `content.docs.nav.mode: manual` the sidebar comes from the tab groups:
each group is a section holding the pages it lists, in that order, whatever
folder they live in. A `pages` entry may itself be a group, which nests a
section (one level is the usual choice).

```yaml
content:
  docs:
    dir: "./docs"
    nav:
      mode: manual

navigation:
  tabs:
    - tab: "Guides"
      groups:
        - group: "App"
          pages:
            - features/styles
            - group: "Layouts"          # a nested section
              pages:
                - features/layouts
                - features/layouts/chat-canvas
        - group: "Deployment"
          pages:
            - features/deployment
            - health-endpoints          # a page at the docs root
    - tab: "Project"
      groups:
        - group: "Decisions"
          pages:
            - adr/index
            - adr/0001-replay-view      # the file name works too
```

- A page is named by its URL path under the docs base (`features/layouts`),
  its file path without `.md` (`adr/0001-replay-view`, `adr/index`) or
  `index` for the home page. A name that matches no page is skipped (and
  reported, see Checks).
- A page listed twice appears once, where it is first listed.
- Frontmatter `nav_title` gives a page a shorter sidebar title than its
  heading (`nav_title: CLI` on a page titled "CLI API Reference").
- Pages no group lists are still built and reachable by URL, but hidden: not
  in any sidebar, search, `sitemap.xml` or `llms.txt` (see
  [Hidden pages](seo.md#hidden-pages)). Leave a page out of the site with
  `content.docs.exclude` (see [Content Sources](content-sources.md#includeexclude-patterns)).
- `hidden: true` on a group hides its pages the same way; on a tab it also
  drops the tab from the header.
- `boost: 2` on a group ranks its pages higher in site search (0.1 to 10; a
  page's own `boost` wins; see [Search](writing-docs.md#search)). With
  tabs, search results can be filtered by tab.
- The active tab is the one whose groups list the page; for a page no group
  lists, the folder `prefix` decides as in auto mode, then the first tab.

## Sidebar Icons

A group's `icon:` in the navigation YAML, or a page's frontmatter `icon:`,
puts a 16px line icon before its title in the sidebar and the phone drawer.

```yaml
navigation:
  tabs:
    - tab: "Get started"
      groups:
        - group: "Get started"
          icon: rocket
          pages:
            - getting-started/quickstart
```

```markdown
---
title: CLI
icon: terminal
---
```

- Any [lucide icon](https://lucide.dev/icons) name (`flag`, `house`, or an
  old name such as `home`), an emoji (`icon: "🚀"`) or an image URL
  (`https://…` or `/icons/x.svg`). See [Icons](writing-docs.md#icons).
  `aiui validate` warns (7009) about a name that is not an icon.
- Page icons work in both modes; group icons need `mode: manual`.

## Tabs

`navigation.tabs` groups the sidebar sections into tabs in the header. A
section belongs to the first group whose `group` name matches its title, whose
`prefix` is its folder, or whose `pages` list one of its pages. The sidebar
shows only the active tab's sections, in the order of its groups; the active tab
follows the URL.

```yaml
navigation:
  tabs:
    - tab: "Documentation"
      groups:
        - group: "Getting Started"
          icon: "rocket"
          prefix: "getting-started"
          pages:
            - getting-started/installation
            - getting-started/quickstart
        - group: "Features"
          prefix: "features"
    - tab: "API Reference"
      groups:
        - group: "API"
          prefix: "api"
```

A section that no group of any tab claims is not shown while tabs are set.
In manual mode the groups are the sections, so each one belongs to its tab.

Clicking a tab opens its first page; the active tab follows the page you
are on. On phones the tabs move into the navigation drawer, where tapping
one shows its sidebar without leaving the page.

### Tab options

```yaml
navigation:
  tabs:
    - tab: "Guides"
      icon: book-open                  # any icon (see Sidebar Icons)
      pages: [index, quickstart]       # pages straight in the tab, no group needed
    - tab: "Blog"
      href: "https://example.com/blog" # a link out (opens in a new tab)
    - tab: "API"
      menu:                            # a small dropdown under the tab
        - item: "REST"
          description: "HTTP endpoints"
          icon: globe
          groups:
            - group: "REST"
              pages: [api/rest/users]
        - item: "SDKs"
          pages: [api/sdk/python, api/sdk/node]
        - item: "Status"
          href: "https://status.example.com"
```

| Key | On | Does |
|-----|----|------|
| `icon` | tab, menu item, anchor, dropdown | an icon before the name |
| `href` | tab, menu item, anchor, dropdown | a link instead of a sidebar (`url` still works on a tab) |
| `pages` | tab, menu item, anchor, dropdown | pages listed straight in it (before its `groups`) |
| `groups` | tab, menu item, anchor, dropdown | its sidebar sections |
| `hidden` | tab, menu item, anchor, dropdown | leaves the header and sidebar; its pages stay routable |
| `menu` | tab | items, each with its own sidebar or `href`; the tab opens the list |
| `description` | menu item, dropdown | a second line under the name |
| `tabs` | dropdown | header tabs shown while that dropdown is open |

## Anchors

Anchors are links pinned at the top of the sidebar on every page. An anchor
with `href` links out; one with `pages` or `groups` opens its own sidebar,
like a tab. `navigation.global.anchors` takes the same entries and lists
them first.

```yaml
navigation:
  global:
    anchors:
      - anchor: "Community"
        icon: users
        href: "https://example.com/forum"
  anchors:
    - anchor: "Changelog"
      icon: newspaper
      pages: [changelog]
```

## Dropdowns (Product Switcher)

`navigation.dropdowns` (also spelled `products`, with `product:` names) puts
a switcher at the top of the sidebar. Each entry opens its own sidebar, or
brings its own header `tabs`, so one site can hold several products.

```yaml
navigation:
  dropdowns:
    - dropdown: "Cloud"
      description: "Hosted service"
      icon: cloud
      tabs:
        - tab: "Guides"
          groups: [{ group: "Cloud", pages: [cloud/start, cloud/deploy] }]
        - tab: "API"
          pages: [cloud/api]
    - dropdown: "Self-hosted"
      description: "Run it yourself"
      icon: server
      groups:
        - group: "Install"
          pages: [self/install]
```

Tabs, menu items, anchors and dropdowns share one rule: each part with
pages or groups gets its own sidebar, and the page you are on decides which
one is open. `aiui validate` warns about one with no pages, groups or
`href` (code 2102) and about a listed page that does not exist (2101).

## Versions

`navigation.versions` publishes several versions of the docs side by side.
The default version is served at the docs root; every other version comes
from its own folder, with no page list needed:

```yaml
navigation:
  versions:
    - { version: v2, default: true, tag: Latest }   # docs/**  ->  /docs/...
    - { version: v1, tag: Deprecated }              # docs/v1/** ->  /docs/v1/...
```

| Key | Meaning |
|---|---|
| `version` | the name in the switcher; also the folder and URL segment (`v1`, `2.x`) |
| `default` | the version at the docs root (default: the first one) |
| `tag` | a badge after the name (`Latest`, `Beta`, `Deprecated`), up to 24 characters |
| `index` | `true` keeps an older version in the sitemap and `llms.txt` (default: only the default version) |
| `groups`, `pages`, `tabs` | the version's own sidebar and header tabs (with `nav.mode: manual`); without them the folder's pages form the sidebar |
| `hidden` | left out of the switcher; its pages stay routable |

A switcher at the top of the sidebar (and of the phone drawer) names the open
version. Picking another one opens the same page in it (`/docs/guide/setup`
and `/docs/v1/guide/setup`), or that version's first page when it has no
such page. The sidebar, the pager, the header tabs and the site search show
the open version only; the top-level `tabs` and `dropdowns` belong to the
default version, and anchors show in every version.

An older version's page names the default version's same page as its
canonical URL and carries `robots: noindex`, so search engines send readers
to the current docs; its pages stay out of `sitemap.xml` and `llms.txt`
unless the version sets `index: true`. A page's own `canonical` or `robots`
front matter wins. `aiui validate` reports two versions with one name, more
than one default, and a version that lists a page from another version's
folder (code 7018).

## Header Links

`navbar` adds links and one primary button to the header. On phones they move
into the navigation drawer.

```yaml
navbar:
  links:
    - label: "Blog"
      href: "https://example.com/blog"
      icon: newspaper       # optional: any icon value (lucide name, image URL, emoji)
    - type: discord         # github | discord: the network's mark; no label needed
      href: "https://discord.gg/your-server"
  primary:
    type: github            # button (default) | github | discord
    href: "https://github.com/your/repo"
```

A link with `type` and no `label` shows the network's mark alone, named for
screen readers. Links to another site open in a new tab.

The star count needs no setup: the browser asks the public GitHub API once and
keeps the answer for six hours. If it cannot get one, the button shows the mark
and the label.

## Footer

`footer.socials` maps a network to a URL and draws its mark; `footer.links`
adds columns of links above the bottom line.

```yaml
footer:
  socials:
    github: "https://github.com/your/repo"
    x: "https://x.com/you"
    discord: "https://discord.gg/your-server"
    status: "https://status.example.com"   # any key: a globe named "status"
  links:
    - header: "Company"                    # optional
      items:
        - label: "About"
          href: "https://example.com/about"
```

Known keys: `github`, `gitlab`, `x` (or `twitter`), `discord`, `slack`,
`linkedin`, `youtube`, `bluesky`, `mastodon`, `reddit`, `telegram`,
`facebook`, `instagram`, `threads`, `medium`, `hacker-news`, `npm`,
`website`, `email` (a `mailto:` URL), `rss` and `podcast`. Any other key whose
URL is on one of those sites gets that mark (`community:
https://discord.gg/x` shows Discord); the rest get a globe. Each mark is a link
named for its network.

## Banner

`banner` puts a strip above the header on every docs page:

```yaml
banner:
  content: "Version 2 is out. [Read the notes](/changelog)"   # Markdown
  dismissible: true      # a close button (default false)
  type: warning          # info (default) | warning | success
```

`banner: "Version 2 is out."` is the short form. A closed banner stays closed
for that reader until its content changes, so a new announcement shows again
with no key to bump.
