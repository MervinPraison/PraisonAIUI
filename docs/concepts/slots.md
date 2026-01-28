# Slots & Components

Understanding the slot system and built-in components.

## Slot System

Slots are named insertion points in layouts. Each template assigns components to slots:

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

## Built-in Components

### Header

Site header with logo, navigation, and CTA.

```yaml
components:
  my_header:
    type: "Header"
    props:
      logoText: "My Site"
      logoHref: "/"
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

Site footer with links and copyright.

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

### DocsSidebar

Documentation navigation sidebar.

```yaml
components:
  sidebar:
    type: "DocsSidebar"
    props:
      source: "docs-nav"    # Uses generated navigation
      collapsible: true
      searchable: true
```

### Toc

Table of contents for the current page.

```yaml
slots:
  right: { type: "Toc" }
```

### DocContent

Renders the markdown content for the current page.

```yaml
slots:
  main: { type: "DocContent" }
```

## Custom Components

Override built-in components using the TypeScript SDK:

```typescript
import { SlotRegistry } from 'praisonaiui/runtime';

SlotRegistry.register('Header', MyCustomHeader);
```
