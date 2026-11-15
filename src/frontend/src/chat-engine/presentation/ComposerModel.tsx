/**
 * The composer's model button inside a layout (ProChat: "gpt-4o-mini ▾"
 * left of Send): which model answers, one press from changing it in
 * Settings. The model comes from the runtime config, else its defaults;
 * nothing shows while neither names one.
 *
 * Drawn by the presentation host (rendered with `Pinned`, which every layout
 * thread mounts in the composer's footer) into the composer's row through a
 * portal, so the chat route carries none of it. Styles: composer.css.
 */
import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { navigate } from '@/sdk/services'

type Conf = { model?: { name?: unknown } } | null | undefined

let model: Promise<string | null> | null = null

const read = (url: string, key: string) =>
  fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: Record<string, Conf> | null) => {
      const name = b?.[key]?.model?.name
      return typeof name === 'string' && name ? name : null
    })
    .catch(() => null)

/** The configured model name, fetched once per page view. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests and sibling modules
export function loadModelName(): Promise<string | null> {
  model ??= read('/api/config/runtime', 'config').then((n) => n ?? read('/api/config/defaults', 'defaults'))
  return model
}

/** Test hook. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with tests and sibling modules
export function resetModelNameForTests(): void {
  model = null
}

/** The composer row the button joins (one thread is on screen at a time). */
function composerRow(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-aiui-thread] form textarea[aria-label="Message"]')?.parentElement ?? null
}

export function ModelButton({ name }: { name: string }): JSX.Element {
  return (
    <button
      type="button"
      data-composer-model=""
      aria-label={`Model: ${name}. Change model`}
      title="Change the model in Settings"
      onClick={() => navigate('config')}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect width="16" height="16" x="4" y="4" rx="2" />
        <rect width="6" height="6" x="9" y="9" rx="1" />
        <path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2" />
      </svg>
      <span>{name}</span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden data-chevron="">
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  )
}

export function ComposerModel(): JSX.Element | null {
  const [name, setName] = useState<string | null>(null)
  const [row, setRow] = useState<HTMLElement | null>(null)
  useEffect(() => {
    let alive = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM (or a lazy module) after mount; one update, no loop
    setRow(composerRow())
    void loadModelName().then((n) => alive && setName(n))
    return () => {
      alive = false
    }
  }, [])
  return name && row ? createPortal(<ModelButton name={name} />, row) : null
}
