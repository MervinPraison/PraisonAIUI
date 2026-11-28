# Advanced Examples

> Docs-site configurations beyond a single template. Every snippet here passes

Docs-site configurations beyond a single template. Every snippet here passes
`aiui validate --strict`.

## Multiple Templates

A centered landing page with a hero banner, and the three-column layout for
the docs:

```yaml
templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "header" }
      left: { type: "DocsSidebar" }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "footer" }

  landing:
    layout: "CenteredLayout"
    slots:
      header: { ref: "header" }
      footer: { ref: "footer" }
      right: null
    zones:
      hero:
        - type: "HeroBanner"
          props:
            title: "My Project"
            subtitle: "Docs for everyone"
            ctaLabel: "Get Started"
            ctaHref: "/docs/getting-started/quickstart"

routes:
  - match: "/docs/**"
    template: "docs"

  - match: "/"
    template: "landing"
```

The layouts and the zones each renders are in [Templates](https://ui.praison.ai/docs/concepts/templates.md)
and [Widget Zones](https://ui.praison.ai/docs/features/widget-zones.md).

## Route-Level Overrides

A route's `slots` can override the `right` slot (the table of contents); header
and footer always come from the template. The first matching route wins, so put
the specific route first:

```yaml
routes:
  - match: "/docs/changelog"
    template: "docs"
    slots:
      right: null  # Hide TOC on the changelog

  - match: "/docs/**"
    template: "docs"
```

## Custom Components

The docs site renderer has no hook for your own header or sidebar component;
the `Header` and `Footer` props cover branding (see
[Slots & Components](https://ui.praison.ai/docs/concepts/slots.md)). For full control, scaffold the
React frontend with `aiui init --frontend` and change it there.

## Custom Colors

```yaml
site:
  title: "My Project"
  theme:
    preset: "emerald"
    radius: "lg"
    darkMode: true
```

`site.customCss` applies to both the runtime server (`aiui run`, CSS text) and
the static docs output of `aiui build` (CSS text, files and URLs); see
[Theming](https://ui.praison.ai/docs/features/theming.md#custom-css-and-js).

## Related pages

- [Slots & Components](https://ui.praison.ai/docs/concepts/slots.md)
- [YAML Configuration](https://ui.praison.ai/docs/concepts/configuration.md)
- [Zero-Code YAML & Plugin Examples](https://ui.praison.ai/docs/examples/yaml-and-plugins.md)
