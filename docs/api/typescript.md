# TypeScript SDK Reference

Complete API reference for the TypeScript/React runtime.

## Installation

```bash
npm install praisonaiui
```

## Core Functions

### createAIUI

Initialize the runtime with manifests.

```typescript
import { createAIUI } from 'praisonaiui/runtime';

const aiui = createAIUI({
  manifestPath: './aiui',
  basePath: '/docs'
});
```

### resolveTemplate

Match a route to a template.

```typescript
import { resolveTemplate } from 'praisonaiui/runtime';

const template = resolveTemplate('/docs/getting-started', routeManifest);
// { layout: "ThreeColumnLayout", slots: {...} }
```

## SlotRegistry

Register custom components for slots.

```typescript
import { SlotRegistry } from 'praisonaiui/runtime';

// Register a custom header
SlotRegistry.register('Header', MyCustomHeader);

// Get registered component
const Header = SlotRegistry.get('Header');
```

## Next.js Adapter

### withAIUI

Wrap your Next.js config:

```typescript
// next.config.ts
import { withAIUI } from 'praisonaiui/next';

export default withAIUI({
  // your Next.js config
});
```

### getDocsPageProps

Get props for docs pages:

```typescript
import { getDocsPageProps } from 'praisonaiui/next';

export async function getStaticProps({ params }) {
  return getDocsPageProps(params.slug);
}
```

## Types

```typescript
import type {
  Config,
  SiteConfig,
  TemplateConfig,
  RouteConfig,
  NavItem,
  DocPage,
} from 'praisonaiui';
```
