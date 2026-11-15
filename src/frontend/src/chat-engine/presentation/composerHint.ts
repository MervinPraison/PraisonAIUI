/**
 * The composer's "Enter to send · Shift + Enter for a new line" hint inside a
 * layout is for a first-time user: after three sends in this browser it is
 * never shown again (composer.css hides it on data-composer-hint="off"; until
 * then it shows only while the composer is focused and empty).
 *
 * A send is Enter (without Shift, not while composing) in a layout composer
 * that holds text, or a press of its Send button while enabled.
 * The count is a per-viewer convenience in localStorage; without storage the
 * hint simply keeps its focused-and-empty rule.
 */
import { useEffect } from 'react'

export const HINT_KEY = 'aiui-composer-sends'
export const HINT_SENDS = 3

export function readSends(): number {
  try {
    const n = Number(localStorage.getItem(HINT_KEY))
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

/** Count one send; returns the new total. */
export function noteSend(): number {
  const n = readSends() + 1
  try {
    localStorage.setItem(HINT_KEY, String(n))
  } catch {
    /* per-viewer convenience only */
  }
  return n
}

export const hintOff = (sends: number) => sends >= HINT_SENDS

/** True when this key or click sends the layout composer's text. */
export function isSendGesture(
  e: { type: string; key?: string; shiftKey?: boolean; isComposing?: boolean },
  text: string,
  onSendButton: boolean,
): boolean {
  if (e.type === 'click') return onSendButton
  return e.type === 'keydown' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && text.trim() !== ''
}

const COMPOSER = '[data-variant] form'

function markOff(): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-variant]')) el.setAttribute('data-composer-hint', 'off')
}

/** Mounted once per layout thread (host `Pinned`): marks the thread when the hint has had its three sends. */
export function useComposerHint(): void {
  useEffect(() => {
    if (hintOff(readSends())) {
      markOff()
      return
    }
    const onEvent = (e: Event) => {
      const target = e.target as HTMLElement | null
      const form = target?.closest?.(COMPOSER)
      if (!form) return
      const send = target?.closest?.<HTMLButtonElement>('button[aria-label="Send"]')
      const text = form.querySelector('textarea')?.value ?? ''
      if (!isSendGesture(e as KeyboardEvent, text, !!send && !send.disabled)) return
      if (hintOff(noteSend())) markOff()
    }
    document.addEventListener('keydown', onEvent, true)
    document.addEventListener('click', onEvent, true)
    return () => {
      document.removeEventListener('keydown', onEvent, true)
      document.removeEventListener('click', onEvent, true)
    }
  }, [])
}
