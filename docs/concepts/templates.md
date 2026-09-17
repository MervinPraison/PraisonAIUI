# Templates & Layouts

Learn how templates and layouts work in PraisonAIUI.

## Overview

Templates define the structure of your pages by combining:
- A **layout** - The structural container
- **Slots** - Pluggable content areas

## Layouts

PraisonAIUI provides four layouts:

| Layout | Description |
|--------|-------------|
| `ThreeColumnLayout` | Sidebar + Content + TOC (classic docs) |
| `TwoColumnLayout` | Sidebar + Content (no TOC) |
| `CenteredLayout` | Centered content, no sidebar |
| `FullWidthLayout` | Full-width content |

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

Full-width content without sidebar.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├─────────────────────────────────────────────┤
│            Main (Full Width)                 │
├─────────────────────────────────────────────┤
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
Remove a slot entirely:
```yaml
slots:
  right: null
```
