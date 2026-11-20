# Next.js Adapter

> Helpers for using an aiui build output in a Next.js app, from the

Helpers for using an `aiui build` output in a Next.js app, from the
`praisonaiui` TypeScript package. Read the [overview](https://ui.praison.ai/docs/typescript.md) first: the
package is optional and built from `src/praisonaiui-ts`.

## withAIUI

Wrap your Next.js config.

```typescript
// next.config.ts
import { withAIUI } from 'praisonaiui/next';

export default withAIUI(
  { /* your Next.js config */ },
  { configPath: './aiui' },   // optional, default './aiui'
);
```

It does two things:

- adds a webpack alias `@aiui` pointing at `configPath`, so you can
  `import uiConfig from '@aiui/ui-config.json'`; your own `webpack` function
  still runs;
- adds `md` and `mdx` to `pageExtensions`.

It does not add an MDX loader. To compile `.mdx` pages, configure one yourself
(for example `@next/mdx`).

## getDocsPageProps

Turn a catch-all route's `slug` into a docs path.

```typescript
import { getDocsPageProps } from 'praisonaiui/next';

const { props } = await getDocsPageProps({ slug: ['guide', 'install'] });
// props = { path: "/docs/guide/install", slug: "guide/install" }
```

It returns only the path and slug; load the page content yourself (for
example the Markdown that `aiui build` copies to `<output>/docs/`).

### App Router

```tsx
// app/docs/[...slug]/page.tsx
import { getDocsPageProps } from 'praisonaiui/next';
import { DocContent } from 'praisonaiui/components';

export default async function Page({ params }: { params: { slug?: string[] } }) {
  const { props } = await getDocsPageProps(params);
  const html = await renderMarkdown(props.slug);   // your own loader
  return <DocContent html={html} />;
}
```

### Pages Router

```tsx
// pages/docs/[...slug].tsx
import { getDocsPageProps } from 'praisonaiui/next';

export async function getStaticProps({ params }: { params: { slug?: string[] } }) {
  return getDocsPageProps(params);   // already { props: { path, slug } }
}
```

## Related pages

- [TypeScript SDK Reference](https://ui.praison.ai/docs/api/typescript.md)
- [TypeScript SDK Overview](https://ui.praison.ai/docs/typescript.md)
- [Quick Start](https://ui.praison.ai/docs/getting-started/quickstart.md)
