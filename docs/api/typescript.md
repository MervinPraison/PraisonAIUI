---
nav_title: TypeScript API
---

# TypeScript SDK Reference

Two TypeScript surfaces exist, for different jobs:

| You want to | Use |
|-------------|-----|
| Add a page, block or layout to the UI that `aiui run` serves | `@aiui/sdk`, provided by the React app shell at runtime. Nothing to install; see [UI plugins](../features/plugins.md) |
| Render an `aiui build` site inside your own React or Next.js app | The optional `praisonaiui` package in `src/praisonaiui-ts`; see [TypeScript SDK](../typescript/index.md) |

The UI that ships with the Python package (`src/frontend`) is private and not
published to npm.

## `praisonaiui` package

Built from the repository (`src/praisonaiui-ts`, version 0.2.0, not
published; npm has an older 0.1.0). Signatures from its source:

### Runtime

```typescript
import { createAIUI, resolveTemplate, SlotRegistry } from 'praisonaiui/runtime';

createAIUI(options: { configPath: string }): {
  config: UIConfig | null;
  nav: NavTree | null;
  routes: RouteManifest | null;
  load(): Promise<void>;          // fetches the three manifests from configPath
};

resolveTemplate(
  path: string,
  manifest: RouteManifest,
  templates: Record<string, TemplateConfig>,
): { template: string; layout: string; slots: Record<string, SlotRef | null>;
     slotOverrides?: Record<string, SlotRef | null> } | null;

SlotRegistry.register(type: string, component: React.ComponentType<any>): void;
SlotRegistry.get(type: string): React.ComponentType<any> | undefined;
SlotRegistry.has(type: string): boolean;
SlotRegistry.clear(): void;
```

Details: [Runtime](../typescript/runtime.md).

### Next.js adapter

```typescript
import { withAIUI, getDocsPageProps } from 'praisonaiui/next';

withAIUI(nextConfig?: NextConfig, aiuiConfig?: { configPath?: string }): NextConfig;
// adds the webpack alias '@aiui' -> configPath (default './aiui') and md/mdx page extensions

getDocsPageProps(params: { slug?: string[] }): Promise<{ props: { path: string; slug: string } }>;
```

Details: [Next.js Adapter](../typescript/nextjs.md).

### Components

`ThreeColumnLayout`, `DefaultLayout`, `Header`, `Footer`, `DocsSidebar`,
`Toc`, `DocContent` from `praisonaiui/components`. Props:
[Components](../typescript/components.md).

### Types

```typescript
import type { Config, UIConfig, NavTree, RouteManifest } from 'praisonaiui';
```

Other interfaces (`SiteConfig`, `TemplateConfig`, `RouteConfig`, `NavItem`,
`SlotRef` and more) are declared in `src/types/index.ts` but not exported from
the package entry.
