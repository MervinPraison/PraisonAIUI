/**
 * A page icon the manifest names but a frame's static lucide map does not
 * have: an app page's `@aiui.page(icon=...)` or a plugin page's `icon`.
 * Shared by the shell sidebar and every layout frame (frames may import
 * @/lib, never @/shell, R17).
 *
 * The value may be
 *   - any lucide name (`users`, `film`): drawn from its lazy chunk
 *     (`virtual:aiui-icons`, scripts/lib/lucide-icons.mjs), so no lucide
 *     table grows the boot chunk (R10). An empty frame of the same size
 *     shows until it arrives, the caller's fallback for an unknown name;
 *   - an image URL (`https://…`, `http://…` or a root path `/…`);
 *   - an emoji (muted, so a colour emoji does not shout next to line icons).
 * `navIcon` is read before `icon` (built-in pages keep their legacy emoji in
 * `icon`). Callers try their static map first; this covers the rest.
 */
import { createElement, useEffect, useState, type ReactNode } from 'react'
import { pageGlyphSource } from './pageGlyphSource'
import { cn } from './utils'

type IconNode = [tag: string, attrs: Record<string, string>][]

const svg = (nodes: IconNode, className?: string) =>
  createElement(
    'svg',
    {
      xmlns: 'http://www.w3.org/2000/svg',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className,
      'aria-hidden': true,
    },
    nodes.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs })),
  )

/** Lucide drawings fetched so far: the nodes, or null for a name lucide does not have. */
const fetched = new Map<string, IconNode | null>()

function LazyLucide({ name, className, fallback }: { name: string; className?: string; fallback: ReactNode }) {
  const [nodes, setNodes] = useState(() => fetched.get(name))
  useEffect(() => {
    if (nodes !== undefined) return
    let live = true
    import('virtual:aiui-icons')
      .then((m) => m.default(name))
      .then(
        (found) => {
          fetched.set(name, (found as IconNode | undefined) ?? null)
          if (live) setNodes(fetched.get(name))
        },
        () => live && setNodes(null),
      )
    return () => {
      live = false
    }
  }, [name, nodes])
  return nodes === null ? fallback : svg(nodes ?? [], className)
}

function ImageGlyph({ src, className, fallback }: { src: string; className?: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (failed) return fallback
  return createElement('img', {
    src,
    alt: '',
    'aria-hidden': true,
    className: cn('object-contain', className),
    loading: 'lazy',
    decoding: 'async',
    referrerPolicy: 'no-referrer',
    onError: () => setFailed(true),
  })
}

export interface PageGlyphProps {
  navIcon?: string
  icon?: string
  /** Size and colour classes (`size-4 shrink-0` …), applied to every form. */
  className?: string
  /** Drawn when the fields name no icon, the name is not a lucide icon, or the image fails. */
  fallback: ReactNode
}

/** A page's icon from its manifest fields (decorative: the row carries the title). */
export function PageGlyph({ navIcon, icon, className, fallback }: PageGlyphProps) {
  const source = pageGlyphSource(navIcon, icon)
  if (!source) return fallback
  if (source.kind === 'name') return createElement(LazyLucide, { key: source.name, name: source.name, className, fallback })
  if (source.kind === 'url') return createElement(ImageGlyph, { key: source.src, src: source.src, className, fallback })
  return createElement(
    'span',
    {
      'aria-hidden': true,
      className: cn('inline-flex items-center justify-center text-[13px] leading-none opacity-70 grayscale', className),
    },
    source.text,
  )
}
