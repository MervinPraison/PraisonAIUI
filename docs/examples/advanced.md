# Advanced Examples

Complex configurations and customization patterns.

## Multiple Templates

Different layouts for different sections:

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

  marketing:
    layout: "DefaultLayout"
    slots:
      header: { ref: "header" }
      hero: { type: "Hero" }
      main: { type: "PageContent" }
      footer: { ref: "footer" }

routes:
  - match: "/docs/**"
    template: "docs"

  - match: "/"
    template: "marketing"

  - match: "/pricing"
    template: "marketing"
```

## Route-Level Overrides

Override slots for specific pages:

```yaml
routes:
  - match: "/docs/**"
    template: "docs"

  - match: "/docs/changelog"
    template: "docs"
    slots:
      right: null  # Hide TOC on changelog

  - match: "/docs/api/**"
    template: "docs"
    slots:
      left: { type: "ApiSidebar" }  # Different sidebar
```

## Custom Components

Register custom components in TypeScript:

```typescript
// components/CustomHeader.tsx
import { SlotRegistry } from 'praisonaiui/runtime';

function CustomHeader({ logoText, links }) {
  return (
    <header className="custom-header">
      <h1>{logoText}</h1>
      <nav>
        {links.map(link => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </nav>
    </header>
  );
}

// Register to override default Header
SlotRegistry.register('Header', CustomHeader);
```

## Dark Mode with Custom Colors

```yaml
site:
  theme:
    darkMode: true
    brandColor: "emerald"
    radius: "lg"
```

```css
/* styles/globals.css */
:root {
  --brand-primary: #10b981;
  --brand-secondary: #34d399;
}

[data-theme="dark"] {
  --brand-primary: #34d399;
  --brand-secondary: #6ee7b7;
}
```
