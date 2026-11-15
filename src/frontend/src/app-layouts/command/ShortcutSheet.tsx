/**
 * ⌘/ "All shortcuts": every key of the Command Deck in a native modal
 * <dialog> (focus kept inside, Esc closes, the page behind is inert). Native
 * on purpose: the radix dialog would add 12 kB to this layout's budget.
 */
import { useEffect, useRef, type JSX } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import type { ShortcutRow } from './model'

export interface ShortcutSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  sections: { title: string; rows: ShortcutRow[] }[]
}

export default function ShortcutSheet({ open, onOpenChange, sections }: ShortcutSheetProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal()
      else d.setAttribute('open', '')
    } else if (!open && d.open) {
      d.close()
    }
  }, [open])
  return (
    <dialog
      ref={ref}
      aria-labelledby="aiui-command-shortcuts-h"
      data-command-shortcuts=""
      // The browser puts focus back where it was when the dialog opened.
      onClose={() => onOpenChange(false)}
      // A click on the backdrop (the dialog element itself, outside its box) closes it.
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close()
      }}
      className="m-auto max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-lg backdrop:bg-(--ui-scrim)"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 id="aiui-command-shortcuts-h" className="m-0 text-lg font-semibold">Keyboard shortcuts</h2>
            <p className="m-0 text-sm text-muted-foreground">Keys work anywhere except while you type in a field.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => ref.current?.close()}>
            Close <Kbd>Esc</Kbd>
          </Button>
        </div>
        {sections
          .filter((s) => s.rows.length)
          .map((s) => (
            <section key={s.title} className="flex flex-col gap-1">
              <h3 className="m-0 text-2xs font-semibold tracking-[0.06em] text-muted-foreground uppercase">{s.title}</h3>
              <dl className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 text-sm">
                {s.rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt>{r.label}</dt>
                    <dd className="m-0 flex items-center justify-end gap-1">
                      {r.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
      </div>
    </dialog>
  )
}
