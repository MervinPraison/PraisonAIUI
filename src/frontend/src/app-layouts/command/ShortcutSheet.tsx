/**
 * ⌘/ "All shortcuts": a dialog listing every key of the Command Deck. Lazy
 * (its own chunk inside `layout-command`), so the dialog code loads on the
 * first open only.
 */
import type { JSX } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import type { ShortcutRow } from './model'

export interface ShortcutSheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  sections: { title: string; rows: ShortcutRow[] }[]
}

export default function ShortcutSheet({ open, onOpenChange, sections }: ShortcutSheetProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-command-shortcuts="">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys work anywhere except while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
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
      </DialogContent>
    </Dialog>
  )
}
