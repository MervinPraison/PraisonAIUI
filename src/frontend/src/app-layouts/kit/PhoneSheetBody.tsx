/**
 * Lazy part of PhoneSheet: the radix sheet itself (components/ui/sheet). It
 * loads on the first open, so a desktop frame never downloads the dialog
 * code. Pro spec: 320 px, sidebar colours, 44 px targets (the close button
 * too). The dialog is named by `title`; `header` (the brand) is shown.
 * Closes on back/forward; focus starts on the current page's link.
 */
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { PhoneSheetProps } from './PhoneSheet'

export default function PhoneSheetBody({ open, onOpenChange, title, header, children }: PhoneSheetProps) {
  useEffect(() => {
    if (!open) return
    const onPop = () => onOpenChange(false)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [open, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        aria-describedby={undefined}
        data-aiui-phone-sheet=""
        onOpenAutoFocus={(e) => {
          const current = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-current="page"]')
          if (!current) return
          e.preventDefault()
          current.focus({ preventScroll: true })
        }}
        showCloseButton={false}
        className="w-80 max-w-[85vw] gap-4 border-sidebar-border bg-sidebar p-3 pt-2 text-sidebar-foreground"
      >
        <div className="flex h-12 shrink-0 items-center gap-2 pl-1">
          {header ? (
            <>
              <div className="min-w-0 flex-1">{header}</div>
              <SheetTitle className="sr-only">{title}</SheetTitle>
            </>
          ) : (
            <SheetTitle className="min-w-0 flex-1 text-base">{title}</SheetTitle>
          )}
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="size-11 shrink-0" aria-label={`Close ${title.toLowerCase()}`}>
              <X className="size-5" />
            </Button>
          </SheetClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">{children}</div>
      </SheetContent>
    </Sheet>
  )
}
