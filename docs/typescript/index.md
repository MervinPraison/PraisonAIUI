# TypeScript SDK Overview

> src/praisonaiui-ts is a small TypeScript package, named praisonaiui, for

`src/praisonaiui-ts` is a small TypeScript package, named `praisonaiui`, for
rendering an `aiui build` site inside your own React or Next.js app. It reads
the JSON manifests the build writes and gives you layout and slot components.

!!! note "Status"
    You do not need this package to use PraisonAIUI. `aiui run` and
    `aiui build` ship their own UI inside the Python wheel, and nothing in the
    current UI is published to npm. The `praisonaiui` package on npm is version
    0.1.0 (January 2026); the source in the repository is 0.2.0 and is not
    published. The package is not built or tested in CI.

    To extend the UI that `aiui run` serves, write a plugin against `@aiui/sdk`
    instead; see [UI plugins](https://ui.praison.ai/docs/features/plugins.md).

## Build it from the repository

```bash
git clone https://github.com/MervinPraison/PraisonAIUI.git
cd PraisonAIUI/src/praisonaiui-ts
npm install
npm install --no-save next@14   # the type declarations import Next.js types
npm run build                   # tsup, output in dist/
```

Without `next` installed, `npm run build` writes the JavaScript but fails at
the type-declaration step. React 18 or later is a peer dependency; Next.js 14
or later is optional at runtime.

## Package exports

| Export | Contents |
|--------|----------|
| `praisonaiui` | `createAIUI`, `resolveTemplate`, `SlotRegistry`, and the types `Config`, `UIConfig`, `NavTree`, `RouteManifest` |
| `praisonaiui/runtime` | `createAIUI`, `resolveTemplate`, `SlotRegistry` |
| `praisonaiui/next` | `withAIUI`, `getDocsPageProps` |
| `praisonaiui/components` | `ThreeColumnLayout`, `DefaultLayout`, `Header`, `Footer`, `DocsSidebar`, `Toc`, `DocContent` |

## Example

```typescript
import { createAIUI, resolveTemplate } from 'praisonaiui/runtime';

// The folder written by `aiui build` (ui-config.json, docs-nav.json, route-manifest.json)
const aiui = createAIUI({ configPath: '/aiui' });
await aiui.load();

const match = resolveTemplate('/docs/getting-started', aiui.routes!, aiui.config!.templates);
// { template: "docs", layout: "ThreeColumnLayout", slots: {...}, slotOverrides: undefined }
```

## Next steps

- [Runtime](https://ui.praison.ai/docs/typescript/runtime.md): `createAIUI`, `resolveTemplate`, `SlotRegistry`
- [Next.js Adapter](https://ui.praison.ai/docs/typescript/nextjs.md): `withAIUI`, `getDocsPageProps`
- [Components](https://ui.praison.ai/docs/typescript/components.md): layouts and slot components

## Related pages

- [TypeScript SDK Reference](https://ui.praison.ai/docs/api/typescript.md)
- [Runtime](https://ui.praison.ai/docs/typescript/runtime.md)
- [Installation](https://ui.praison.ai/docs/getting-started/installation.md)
