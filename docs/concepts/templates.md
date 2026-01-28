# Templates & Layouts

Learn how templates and layouts work in PraisonAIUI.

## Overview

Templates define the structure of your pages by combining:
- A **layout** - The structural container
- **Slots** - Pluggable content areas

## Layouts

PraisonAIUI provides two layouts:

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

### DefaultLayout

Simple layout for landing pages.

```
┌─────────────────────────────────────────────┐
│                   Header                     │
├─────────────────────────────────────────────┤
│                    Hero                      │
├─────────────────────────────────────────────┤
│                    Main                      │
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
