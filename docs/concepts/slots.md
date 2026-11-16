# Slots & Components

A template names a component for each slot of its layout. In the docs site that
`aiui build` produces, the React renderer reads three slots; the others are
validated and compiled into the manifest but do not change the page.

## Slot System

```yaml
templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "main_header" }
      left: { type: "DocsSidebar" }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "main_footer" }
```

| Slot | Effect in the docs site |
|------|-------------------------|
| `header` | Its component's props (`logoText`, `logoImage`, `links`, `cta`) fill the header; YAML `navbar` and `logo` win when set |
| `footer` | Its component's props (`text`, `links`) fill the footer bottom row, next to YAML `footer` |
| `right` | `null` hides the table of contents; any other value shows it |
| `left`, `main` | No effect: the sidebar is always the generated navigation and the main area the page's Markdown |

Without a `header` or `footer` slot, the components named `header` and
`footer` are used. `aiui validate` checks that every `ref` names a component.

## Built-in Components

### Header

```yaml
components:
  my_header:
    type: "Header"
    props:
      logoText: "My Site"
      logoImage: "/logo.svg"
      links:
        - label: "Docs"
          href: "/docs"
        - label: "Blog"
          href: "/blog"
      cta:
        label: "Get Started"
        href: "/docs/quickstart"
```

### Footer

```yaml
components:
  my_footer:
    type: "Footer"
    props:
      text: "© 2024 My Company"
      links:
        - label: "GitHub"
          href: "https://github.com"
```

### DocsSidebar, DocContent, Toc

These name the generated navigation, the page content and the table of
contents. They take no props the renderer reads.

```yaml
slots:
  left: { type: "DocsSidebar" }
  main: { type: "DocContent" }
  right: { type: "Toc" }
```

## Custom Components

The docs site renderer has no hook for your own slot components. The separate
TypeScript runtime in the repository (`src/praisonaiui-ts`, see
[TypeScript](../typescript/index.md)) has a `SlotRegistry` for apps that render
the manifests themselves. Pages in the React app shell are added with plugins
instead (see [Plugins](../features/plugins.md)).
