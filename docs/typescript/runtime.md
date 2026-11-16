# Runtime

Manifest loading and template resolution in the `praisonaiui` TypeScript
package. Read the [overview](index.md) first: the package is optional and
built from `src/praisonaiui-ts`.

## createAIUI

Create an instance that loads the three manifests written by `aiui build`.

```typescript
import { createAIUI } from 'praisonaiui/runtime';

const aiui = createAIUI({ configPath: '/aiui' });  // URL of the build output
await aiui.load();   // fetches ui-config.json, docs-nav.json, route-manifest.json

aiui.config;   // UIConfig: site, components, templates
aiui.nav;      // NavTree: { items: [{ title, path, children? }] }
aiui.routes;   // RouteManifest: { routes: [{ pattern, template, priority, slotOverrides? }] }
```

`load()` uses `fetch`, so `configPath` is a URL path the browser can reach.
It throws if any of the three files fails to load.

## resolveTemplate

Find the template for a path.

```typescript
import { resolveTemplate } from 'praisonaiui/runtime';

const match = resolveTemplate('/docs/getting-started', aiui.routes!, aiui.config!.templates);
// {
//   template: "docs",
//   layout: "ThreeColumnLayout",
//   slots: { header: { ref: "header_main" }, main: { type: "DocContent" }, ... },
//   slotOverrides: undefined
// }
```

Routes are tried by `priority`, highest first (`aiui build` gives the first
route in the YAML the highest). In a pattern `*` matches one path segment and
`**` any number. It returns `null` when no route matches or the route names a
template that does not exist.

## SlotRegistry

A static map from a component type to a React component, for your own
renderer to look up.

```typescript
import { SlotRegistry } from 'praisonaiui/runtime';

SlotRegistry.register('Header', MyCustomHeader);
const Header = SlotRegistry.get('Header');   // undefined if not registered
SlotRegistry.has('Footer');                  // boolean
SlotRegistry.clear();
```

Nothing in the package reads the registry on its own; the components in
[Components](components.md) do not consult it.
