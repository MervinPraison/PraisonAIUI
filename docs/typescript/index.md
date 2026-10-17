# TypeScript SDK Overview

The TypeScript SDK provides React components and runtime utilities for rendering PraisonAIUI sites.

## Installation

```bash
npm install praisonaiui
```

## Features

- **React Components** - Pre-built slot components
- **Next.js Adapter** - Zero-config Next.js integration
- **Runtime** - Manifest loading and template resolution
- **TypeScript** - Full type definitions

## Quick Start

```typescript
import { createAIUI } from 'praisonaiui/runtime';
import { withAIUI } from 'praisonaiui/next';

// Initialize runtime
const aiui = createAIUI({
  manifestPath: './aiui'
});

// Use in Next.js
export default withAIUI({
  // next.config options
});
```

## Package Exports

| Export | Description |
|--------|-------------|
| `praisonaiui` | Main entry, types |
| `praisonaiui/runtime` | Runtime utilities |
| `praisonaiui/next` | Next.js adapter |
| `praisonaiui/components` | React components |

## Next Steps

- [Runtime](runtime.md) - Core runtime utilities
- [Next.js Adapter](nextjs.md) - Next.js integration
- [Components](components.md) - Built-in components
