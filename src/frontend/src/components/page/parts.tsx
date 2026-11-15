/**
 * Small pieces shared by the page templates (components/page): the labelled
 * toolbar search and the key-facts grid. Kept apart so one template's chunk
 * never pulls in another template.
 */
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import './page.css'

const GLYPHS = {
  close: ['M18 6 6 18', 'm6 6 12 12'],
  up: ['m18 15-6-6-6 6'],
  down: ['m6 9 6 6 6-6'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
} as const

/**
 * The few line glyphs the templates draw (lucide's x and chevrons). Drawn
 * here, not imported: lucide modules shared with the chat route's lazy
 * children would split into chunks of their own and grow its preload list.
 */
export function Glyph({ name }: { name: keyof typeof GLYPHS }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

/** The labelled search field of a template toolbar. */
export function TemplateSearch({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <label className="aiui-tpl-search">
      <span className="aiui-tpl-sr">{label}</span>
      <Search aria-hidden />
      <Input type="search" value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/** Key facts of a record as a two-column grid (Messages, Tokens, Cost…). */
export function Facts({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  if (items.length === 0) return null
  return (
    <dl className="aiui-tpl-facts">
      {items.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
