/**
 * "@" in the composer (a layout's meta.chat.composerTool; Chat + Canvas,
 * Canvas.dc.html, CanvasPhone.dc.html): reference one of this chat's
 * artifacts, from the frame's `artifacts` feed (useLayoutData). The button
 * ("Reference an artifact"), or typing @ in the message, opens a list of the
 * chat's artifacts; a choice puts a plain-text mention, @"Model table", in
 * the message, so the agent reads which artifact is meant. No server
 * protocol: the mention is part of the text.
 *
 * While a chat is open it also sets the composer's placeholder ("Ask a
 * follow-up, or type @ to edit an artifact"; a phone: "Ask a follow-up") and
 * adds "@ artifact" to the composer's key hints. The presentation host
 * renders it with the composer's footer; the button and the hint are
 * portals into the composer, the text goes in through `aiui:prefill-composer`.
 *
 * It needs only the SDK's artifacts feed (no artifacts-feature code), so it
 * is a lazy chunk of its own beside the other presentation pieces, fetched
 * only by a layout that names it; with no feed the list is empty.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLayoutData } from '@/sdk/layouts'
import type { Artifact } from '@/sdk/layoutTypes'
import { insertMention, mentionTitles } from './mentionText'

const PROMPT = 'Ask a follow-up, or type @ to edit an artifact'
const PROMPT_PHONE = 'Ask a follow-up'
const INPUT = '[data-aiui-thread] form textarea[aria-label="Message"]'
const NONE: readonly Artifact[] = []
const none = () => NONE
const noSubscribe = () => () => {}

const messageBox = () => document.querySelector<HTMLTextAreaElement>(INPUT)

export default function ArtifactMention({ sessionId, viewport }: { sessionId: string | null; viewport: string }): JSX.Element | null {
  const feed = useLayoutData('artifacts')
  const source = useMemo(() => feed?.forSession(sessionId) ?? null, [feed, sessionId])
  const versions = useSyncExternalStore(source?.subscribe ?? noSubscribe, source?.get ?? none, source?.get ?? none)
  const items = useMemo(() => mentionTitles(versions), [versions])
  const [row, setRow] = useState<HTMLElement | null>(null)
  const [hint, setHint] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const typed = useRef(false)
  const list = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const box = messageBox()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads the DOM after mount; one update, no loop
    setRow(box?.parentElement ?? null)
    const p = box?.closest('form')?.nextElementSibling
    setHint(p instanceof HTMLParagraphElement ? p : null)
    // Typing @ opens the list, a space closes it, ArrowDown moves into it.
    const inBox = (e: Event) => !!(e.target as Element).matches?.(INPUT)
    const onInput = (e: Event) => {
      const data = (e as InputEvent).data
      if (!inBox(e) || !data) return
      if (data === '@') {
        typed.current = true
        setOpen(true)
      } else if (/\s/.test(data)) {
        typed.current = false
        setOpen(false)
      }
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!inBox(e)) return
      if (e.key === 'Escape') {
        typed.current = false
        setOpen(false)
      }
      const first = list.current?.querySelector('button')
      if (e.key === 'ArrowDown' && first) {
        e.preventDefault()
        first.focus()
      }
    }
    const onDown = (e: PointerEvent) => !(e.target as Element).closest?.('[data-artifact-mention]') && setOpen(false)
    document.addEventListener('input', onInput)
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('input', onInput)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [])

  // The design's placeholder while a chat is open; the default comes back after.
  useEffect(() => {
    const box = messageBox()
    if (!box || !sessionId) return
    const before = box.placeholder
    box.placeholder = viewport === 'phone' ? PROMPT_PHONE : PROMPT
    return () => {
      box.placeholder = before
    }
  }, [sessionId, viewport])

  const close = (refocus: boolean) => {
    setOpen(false)
    typed.current = false
    if (refocus) messageBox()?.focus()
  }

  const pick = (title: string) => {
    const box = messageBox()
    if (!box) return
    const next = insertMention(box.value, box.selectionStart, box.selectionEnd, title, typed.current)
    close(false)
    window.dispatchEvent(new CustomEvent('aiui:prefill-composer', { detail: { text: next.text } }))
    requestAnimationFrame(() => {
      box.focus()
      box.setSelectionRange(next.caret, next.caret)
    })
  }

  const onListKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const buttons = [...(list.current?.querySelectorAll('button') ?? [])]
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
      buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
    }
  }

  if (!row) return null
  return (
    <>
      {createPortal(
        <div className="relative order-0" data-artifact-mention="">
          <button
            type="button"
            aria-label="Reference an artifact"
            aria-expanded={open}
            title="Reference an artifact (@)"
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:size-11"
            onClick={() => (open ? close(true) : setOpen(true))}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4">
              <circle cx="12" cy="12" r="4" />
              <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
            </svg>
          </button>
          {open && (
            <ul
              ref={list}
              aria-label="This chat's artifacts"
              className="absolute bottom-full left-0 z-20 m-0 mb-1 flex max-h-64 min-w-56 list-none flex-col overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
              onKeyDown={onListKey}
            >
              {items.length === 0 ? (
                <li className="px-2 py-1.5 text-sm text-muted-foreground">No artifacts in this chat yet</li>
              ) : (
                items.map((a) => (
                  <li key={a.key}>
                    <button
                      type="button"
                      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent max-sm:min-h-11"
                      onClick={() => pick(a.title)}
                    >
                      <span className="min-w-0 truncate">{a.title}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>,
        row,
      )}
      {hint &&
        createPortal(
          <span className="contents" data-artifact-mention-hint="">
            <span aria-hidden> · </span>
            <kbd className="rounded-xs border border-input px-1 font-sans text-2xs">@</kbd> artifact
          </span>,
          hint,
        )}
    </>
  )
}
