# Components

Built-in React components for PraisonAIUI.

## Layout Components

### ThreeColumnLayout

Documentation layout with sidebar and TOC.

```tsx
import { ThreeColumnLayout } from 'praisonaiui/components';

<ThreeColumnLayout
  header={<Header />}
  left={<Sidebar />}
  main={<Content />}
  right={<Toc />}
  footer={<Footer />}
/>
```

### DefaultLayout

Simple layout for landing pages.

```tsx
import { DefaultLayout } from 'praisonaiui/components';

<DefaultLayout
  header={<Header />}
  hero={<Hero />}
  main={<Content />}
  footer={<Footer />}
/>
```

## Slot Components

### Header

```tsx
import { Header } from 'praisonaiui/components';

<Header
  logoText="My Site"
  logoHref="/"
  links={[
    { label: "Docs", href: "/docs" },
    { label: "Blog", href: "/blog" }
  ]}
  cta={{ label: "Get Started", href: "/start" }}
/>
```

### Footer

```tsx
import { Footer } from 'praisonaiui/components';

<Footer
  text="© 2024 My Company"
  links={[
    { label: "GitHub", href: "https://github.com" }
  ]}
/>
```

### DocsSidebar

```tsx
import { DocsSidebar } from 'praisonaiui/components';

<DocsSidebar
  items={navItems}
  currentPath="/docs/getting-started"
  collapsible={true}
  searchable={true}
/>
```

### Toc

```tsx
import { Toc } from 'praisonaiui/components';

<Toc headings={pageHeadings} />
```

### DocContent

```tsx
import { DocContent } from 'praisonaiui/components';

<DocContent content={htmlContent} />
```

## Styling Components

All components use semantic CSS classes prefixed with `aiui-`. Style them with your preferred CSS approach:

| Component | CSS Classes |
|-----------|-------------|
| Layouts | `aiui-layout`, `aiui-layout-three-column`, `aiui-layout-header`, `aiui-layout-main` |
| Header | `aiui-header`, `aiui-header-logo`, `aiui-header-nav`, `aiui-header-cta` |
| Footer | `aiui-footer`, `aiui-footer-links` |
| Sidebar | `aiui-sidebar`, `aiui-sidebar-item`, `aiui-sidebar-group` |
| Toc | `aiui-toc`, `aiui-toc-item` |
| Content | `aiui-content`, `aiui-content-body` |

```css
/* Example custom styling */
.aiui-header {
  background: linear-gradient(to right, #6366f1, #8b5cf6);
}
```
