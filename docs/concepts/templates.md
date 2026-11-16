# Templates & Layouts

Learn how templates and layouts work in PraisonAIUI.

## Overview

A template, used by the docs site (`aiui build`), combines:

- a **layout**: the structure around the page content
- **slots**: the components for the header, footer and table of contents (see
  [Slots & Components](slots.md))
- optional **zones**: widgets around the content (see
  [Widget Zones](../features/widget-zones.md))

Routes pick the template for a URL (see [Configuration](configuration.md#routes)).
These are docs-site layouts; the layouts of the React app shell are a different
thing (see [Layouts](../features/layouts.md)).

## Layouts

Every layout sits between the site header and footer.

| Layout | Description |
|--------|-------------|
| `ThreeColumnLayout` | Sidebar + content + TOC (the default) |
| `TwoColumnLayout` | Sidebar + content (no TOC) |
| `CenteredLayout` | Centered content, no sidebar; `hero` zone |
| `FullWidthLayout` | Sidebar when there is navigation, wide content; `hero` zone |
| `FlexibleLayout` | Sidebar (or `leftSidebar` widgets), content, TOC, and widget zones |

### ThreeColumnLayout

The classic documentation layout with sidebar and TOC.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├───────┬─────────────────────────┬───────────┤
│ Left  │          Main           │   Right   │
│(Side) │        (Content)        │   (TOC)   │
├───────┴─────────────────────────┴───────────┤
│                   Footer                     │
└─────────────────────────────────────────────┘
```

### TwoColumnLayout

Sidebar + Content without the right TOC column.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├───────┬─────────────────────────────────────┤
│ Left  │              Main                    │
│(Side) │           (Content)                  │
├───────┴─────────────────────────────────────┤
│                   Footer                     │
└─────────────────────────────────────────────┘
```

### CenteredLayout

Centered content with no sidebar, ideal for articles/blogs.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├─────────────────────────────────────────────┤
│              Main (Centered)                 │
├─────────────────────────────────────────────┤
│                   Footer                     │
└─────────────────────────────────────────────┘
```

### FullWidthLayout

The content takes the remaining width; the sidebar shows only when the site
has docs navigation.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├───────┬─────────────────────────────────────┤
│ Left  │        Main (Full Width)             │
│(Side) │                                      │
├───────┴─────────────────────────────────────┤
│                   Footer                     │
└─────────────────────────────────────────────┘
```

## Defining Templates

```yaml
templates:
  docs:
    layout: "ThreeColumnLayout"
    slots:
      header: { ref: "my_header" }
      left: { ref: "sidebar" }
      main: { type: "DocContent" }
      right: { type: "Toc" }
      footer: { ref: "my_footer" }
```

## Slot Assignment

Slots can be assigned in two ways:

### Reference (ref)
Point to a component defined in the `components` section:
```yaml
slots:
  header: { ref: "my_header" }
```

### Direct Type
Use a component type directly:
```yaml
slots:
  main: { type: "DocContent" }
```

### Null (hide)
`right: null` hides the table of contents (the only slot the renderer hides):
```yaml
slots:
  right: null
```
