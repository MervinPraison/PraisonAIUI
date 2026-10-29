# Next.js Adapter

Integrate PraisonAIUI with Next.js.

## Installation

```bash
npm install praisonaiui next react react-dom
```

## Configuration

Wrap your Next.js config:

```typescript
// next.config.ts
import { withAIUI } from 'praisonaiui/next';

export default withAIUI({
  // your Next.js config options
});
```

## Page Setup

### App Router

```typescript
// app/docs/[...slug]/page.tsx
import { getDocsPageProps } from 'praisonaiui/next';
import { DocsPage } from 'praisonaiui/components';

export default async function Page({ params }) {
  const props = await getDocsPageProps(params.slug);
  return <DocsPage {...props} />;
}

export async function generateStaticParams() {
  // Generate paths from docs-nav.json
}
```

### Pages Router

```typescript
// pages/docs/[...slug].tsx
import { getDocsPageProps } from 'praisonaiui/next';
import { DocsPage } from 'praisonaiui/components';

export default function Page(props) {
  return <DocsPage {...props} />;
}

export async function getStaticProps({ params }) {
  return {
    props: await getDocsPageProps(params.slug)
  };
}

export async function getStaticPaths() {
  // Generate paths
}
```

## MDX Support

Enable MDX:

```typescript
// next.config.ts
import { withAIUI } from 'praisonaiui/next';

export default withAIUI({
  // MDX is enabled by default
});
```
