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

`content.docs.nav` (`mode`, `sort`, `collapsible`, `maxDepth`) is accepted by
the schema, but the build does not read it yet: the order above always applies.

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
