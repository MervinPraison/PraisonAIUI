# Components

React components in `praisonaiui/components`. Read the
[overview](index.md) first: the package is optional and built from
`src/praisonaiui-ts`. The components render plain markup with `aiui-*` class
names and ship no CSS.

## Layouts

### ThreeColumnLayout

Header, left column, main, right column and footer.

```tsx
import { ThreeColumnLayout } from 'praisonaiui/components';

<ThreeColumnLayout
  header={<Header />}
  left={<DocsSidebar />}
  main={<DocContent />}
  right={<Toc />}
  footer={<Footer />}
/>
```

### DefaultLayout

Header, hero, main and footer.

```tsx
import { DefaultLayout } from 'praisonaiui/components';

<DefaultLayout header={<Header />} hero={<Hero />} main={<Content />} footer={<Footer />} />
```

Every layout prop is optional.

## Slot components

### Header

```tsx
import { Header } from 'praisonaiui/components';

<Header
  logoText="My Site"
  logoImage="/logo.svg"
  links={[
    { label: 'Docs', href: '/docs' },
    { label: 'GitHub', href: 'https://github.com/...', external: true },
  ]}
  cta={{ label: 'Get Started', href: '/start' }}
/>
```

### Footer

```tsx
import { Footer } from 'praisonaiui/components';

<Footer text="© 2026 My Company" links={[{ label: 'GitHub', href: 'https://github.com' }]} />
```

### DocsSidebar

```tsx
import { DocsSidebar } from 'praisonaiui/components';

<DocsSidebar items={aiui.nav?.items} collapsible showSearch />
```

| Prop | Default | Description |
|------|---------|-------------|
| `items` | `[]` | `NavItem[]` (`{ title, path, children? }`), for example `docs-nav.json`'s `items` |
| `collapsible` | `true` | Items with children can fold |
| `showSearch` | `false` | Show a search box (markup only; filtering is up to you) |
| `source` | none | Accepted for parity with the YAML `source: docs-nav`; not used |

### Toc

```tsx
import { Toc } from 'praisonaiui/components';

<Toc headings={[{ id: 'install', text: 'Install', level: 2 }]} minLevel={2} maxLevel={4} />
```

Renders nothing when no heading falls between `minLevel` and `maxLevel`.

### DocContent

```tsx
import { DocContent } from 'praisonaiui/components';

<DocContent html={htmlString} />      // inserted as HTML: sanitize it first
<DocContent>{children}</DocContent>   // or render children
```

## CSS classes

| Component | Classes |
|-----------|---------|
| Layouts | `aiui-layout`, `aiui-layout-three-column`, `aiui-layout-default`, `aiui-layout-header`, `aiui-layout-hero`, `aiui-layout-body`, `aiui-layout-left`, `aiui-layout-main`, `aiui-layout-right`, `aiui-layout-footer` |
| Header | `aiui-header`, `aiui-header-content`, `aiui-header-logo`, `aiui-header-nav`, `aiui-header-cta` |
| Footer | `aiui-footer`, `aiui-footer-content`, `aiui-footer-text`, `aiui-footer-links` |
| DocsSidebar | `aiui-sidebar`, `aiui-sidebar-search`, `aiui-sidebar-nav`, `aiui-nav-item`, `aiui-nav-item-header`, `aiui-nav-toggle`, `aiui-nav-children` |
| Toc | `aiui-toc`, `aiui-toc-title`, `aiui-toc-nav`, `aiui-toc-link` |
| DocContent | `aiui-doc-content` |

```css
.aiui-header {
  border-bottom: 1px solid #e5e7eb;
}
```
