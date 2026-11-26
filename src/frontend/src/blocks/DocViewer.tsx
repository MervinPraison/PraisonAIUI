/**
 * Markdown document viewer for BlockPage (`markdown_text(..., toc=True)` and
 * `doc_viewer(...)`): extracts `##` / `###` headings (matching `DocsH2`/`DocsH3`
 * anchor ids in `markdown/docsComponents.tsx`) and renders a sticky desktop
 * "On this page" TOC + a collapsible mobile TOC while keeping `rehype-sanitize`.
 */
import { useMemo } from 'react'
import { List } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown } from '@/markdown/LazyMarkdown'
import { extractMarkdownHeadings, type DocHeading } from './docToc'

function TocLinks({ headings }: { headings: readonly DocHeading[] }) {
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {headings.map((h, i) => (
        <li key={`${h.id}-${i}`} className={cn(h.level === 3 && 'pl-3')}>
          <a
            href={`#${h.id}`}
            className="block rounded-sm py-0.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function DocViewer({ content, title, toc }: { content: string; title?: string; toc: boolean }) {
  const headings = useMemo(() => (toc ? extractMarkdownHeadings(content) : []), [content, toc])
  const showToc = toc && headings.length > 0
  return (
    <div data-doc-viewer="" className={cn('min-w-0', showToc && 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_13rem] lg:items-start')}>
      <div className="min-w-0 space-y-4">
        {title && <h2 className="min-w-0 break-words text-2xl font-semibold tracking-tight text-foreground">{title}</h2>}
        {showToc && (
          <details className="rounded-lg border border-border bg-card px-3 py-2 lg:hidden" data-doc-toc-mobile="">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-xs font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <List aria-hidden className="size-3.5 text-muted-foreground" />
              <span>On this page</span>
            </summary>
            <nav aria-label="On this page" className="mt-2 border-t border-border pt-2">
              <TocLinks headings={headings} />
            </nav>
          </details>
        )}
        <Markdown variant="docs" className="min-w-0">
          {content}
        </Markdown>
      </div>
      {showToc && (
        <aside className="hidden lg:sticky lg:top-6 lg:block" data-doc-toc="">
          <nav aria-label="On this page" className="border-l border-border pl-3">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <List aria-hidden className="size-3.5 text-muted-foreground" />
              <span>On this page</span>
            </p>
            <TocLinks headings={headings} />
          </nav>
        </aside>
      )}
    </div>
  )
}
