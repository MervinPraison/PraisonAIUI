# Runtime

Core runtime utilities for the TypeScript SDK.

## createAIUI

Initialize the runtime:

```typescript
import { createAIUI } from 'praisonaiui/runtime';

const aiui = createAIUI({
  manifestPath: './aiui',  // Path to manifests
  basePath: '/docs'        // Base path for docs
});
```

## resolveTemplate

Match a route to its template configuration:

```typescript
import { resolveTemplate } from 'praisonaiui/runtime';

const template = resolveTemplate('/docs/getting-started', routeManifest);

console.log(template);
// {
//   layout: "ThreeColumnLayout",
//   slots: {
//     header: { ref: "main_header" },
//     main: { type: "DocContent" }
//   }
// }
```

## SlotRegistry

Register and retrieve slot components:

```typescript
import { SlotRegistry } from 'praisonaiui/runtime';

// Register custom component
SlotRegistry.register('Header', MyCustomHeader);

// Get component
const HeaderComponent = SlotRegistry.get('Header');

// Check if registered
if (SlotRegistry.has('Footer')) {
  // ...
}

// Get all registered
const all = SlotRegistry.getAll();
```

## Manifest Loading

```typescript
import { loadManifest } from 'praisonaiui/runtime';

const uiConfig = await loadManifest('ui-config.json');
const docsNav = await loadManifest('docs-nav.json');
const routes = await loadManifest('route-manifest.json');
```
