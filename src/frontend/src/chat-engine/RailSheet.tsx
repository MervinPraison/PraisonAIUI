/**
 * Lazy chunk: the phone session rail in a radix Dialog sheet
 * (components/ui/sheet, the same chunks the shell's MobileNav loads).
 * The Dialog moves focus into the rail, traps Tab inside it, closes on
 * Escape or a tap outside, exposes role=dialog with aria-modal (the page
 * behind is hidden from assistive tech) and hands focus back to the button
 * that opened it.
 */
import { useEffect, type RefObject } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { SessionRail, type SessionRailProps } from './SessionRail'

/** The desktop layout shows the docked rail (lg:flex): the sheet is phone-only. */
const DESKTOP_QUERY = '(min-width: 1024px)'

export interface RailSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  rail: Omit<SessionRailProps, 'onClose' | 'className'>
  /** Where focus goes when the sheet closes (the "Show chats" button). */
  returnFocus?: RefObject<HTMLElement | null>
}

export default function RailSheet({ open, onOpenChange, rail, returnFocus }: RailSheetProps) {
  // Widening to the desktop layout shows the docked rail: drop the sheet.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => {
      if (mq.matches) onOpenChange(false)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [open, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        showCloseButton={false}
        aria-describedby={undefined}
        // radix hides the rest of the page from assistive tech; say so on the dialog too.
        aria-modal="true"
        data-aiui-chat-rail-sheet=""
        className="w-72 max-w-[85%] gap-0 p-0 lg:hidden"
        // Start on the open chat's row rather than on the first button.
        onOpenAutoFocus={(e) => {
          const current = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('[aria-current="true"]')
          if (!current) return
          e.preventDefault()
          current.focus({ preventScroll: true })
          current.scrollIntoView?.({ block: 'nearest' })
        }}
        onCloseAutoFocus={(e) => {
          const target = returnFocus?.current
          if (!target || !target.isConnected) return
          e.preventDefault()
          target.focus({ preventScroll: true })
        }}
      >
        <SheetTitle className="sr-only">Chats</SheetTitle>
        <SessionRail {...rail} onClose={() => onOpenChange(false)} className="w-full" />
      </SheetContent>
    </Sheet>
  )
}
