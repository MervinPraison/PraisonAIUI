# Navigation

`aiui build` turns the docs folder into the sidebar (`docs-nav.json`). YAML
`navigation.tabs` then splits that sidebar into tabs.

## The Generated Sidebar

Each folder becomes a section and each Markdown file an entry:

- Inside a folder, pages sort by frontmatter `order`, then by file name (see
  [Content Sources](content-sources.md#frontmatter)).
- A folder's section takes the title of its `index.md` when that page sorts
  first in the folder. Otherwise the section is the folder name, title-cased,
  and the index page shows as a separate entry. Give the index page
  `order: -1` to be sure.
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
default) and one you list in YAML (`manual`, below). `sort`, `collapsible` and
`maxDepth` are accepted by the schema, but the build does not read them yet.

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
  `index` for the home page. A name that matches no page is skipped.
- A page listed twice appears once, where it is first listed.
- Frontmatter `nav_title` gives a page a shorter sidebar title than its
  heading (`nav_title: CLI` on a page titled "CLI API Reference").
- Pages no group lists are still built and reachable by URL, but hidden: not
  in any sidebar, search, `sitemap.xml` or `llms.txt` (see
  [Hidden pages](seo.md#hidden-pages)). Leave a page out of the site with
  `content.docs.exclude` (see [Content Sources](content-sources.md#includeexclude-patterns)).
- `hidden: true` on a group hides its pages the same way; on a tab it also
  drops the tab from the header.
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

- The names are lucide's: `message-square`, `panels-top-left`,
  `layout-dashboard`, `book-open`, `plug`, `shield-check`, `code`,
  `terminal`, `bot`, `zap`, `rocket` and `palette` (the same set as the home
  page features). Any other name shows no icon.
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

## Header Links

`navbar` adds links and one primary button to the header:

```yaml
navbar:
  links:
    - label: "Blog"
      href: "https://example.com/blog"
  primary:
    type: github          # button | github
    href: "https://github.com/your/repo"
```
