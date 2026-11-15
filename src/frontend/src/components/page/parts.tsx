/**
 * Small pieces shared by the page templates (components/page): the labelled
 * toolbar search and the key-facts grid. Kept apart so one template's chunk
 * never pulls in another template.
 */
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import './page.css'

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
