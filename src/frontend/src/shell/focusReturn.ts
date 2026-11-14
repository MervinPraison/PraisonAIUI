/**
 * Where focus goes when a shell dialog closes (the command palette, the
 * mobile nav sheet). Neither has a radix Dialog.Trigger (they open from a
 * shortcut, the header or window.aiui), so radix would focus a null trigger
 * and focus would fall to <body>, dropping the keystrokes of someone who was
 * typing in the composer. Instead:
 *
 *   onOpenAutoFocus  → capture()   remember the element focused before opening
 *   (navigated away) → toMain()    land on the new page's <main id="aiui-main">
 *   onCloseAutoFocus → restore(e)  focus it again (and stop radix's default)
 */
export const MAIN_ID = 'aiui-main'

export interface FocusReturn {
  capture(): void
  toMain(): void
  restore(event: Event): void
}

export function createFocusReturn(doc: Document | undefined = globalThis.document): FocusReturn {
  let target: HTMLElement | null = null
  return {
    capture() {
      const active = doc?.activeElement as HTMLElement | null | undefined
      target = active && active !== doc?.body && typeof active.focus === 'function' ? active : null
    },
    toMain() {
      target = doc?.getElementById(MAIN_ID) ?? null
    },
    restore(event) {
      event.preventDefault()
      const next = target
      target = null
      if (next?.isConnected) next.focus({ preventScroll: true })
    },
  }
}
