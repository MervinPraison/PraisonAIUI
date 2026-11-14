/**
 * Lazy chunk: the phone navigation sheet (radix Dialog via components/ui/sheet).
 * Loaded on the first tap (or hover/focus) of the header menu button, so the
 * Sheet never sits on the boot path.
 */
import { useEffect, useMemo, useState } from 'react'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import type { ShellManifest } from '@/sdk/manifest'
import { createFocusReturn } from './focusReturn'
import { navGroups } from './nav'
import { SidebarBrand, SidebarNav } from './Sidebar'

const DESKTOP_QUERY = '(min-width: 768px)'

export default function MobileNav({
  open,
  onOpenChange,
  manifest,
  activeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  manifest: ShellManifest
  activeId: string
}) {
  const groupConfig = useMemo(() => navGroups(manifest), [manifest])
  // No Dialog.Trigger: closing returns focus to the menu button (or wherever
  // it was), or to the new page's main region after choosing a page.
  const [focus] = useState(createFocusReturn)
  // Widening to the desktop layout shows the real sidebar: drop the sheet.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia(DESKTOP_QUERY)
    const onChange = () => {
      if (mq.matches) onOpenChange(false)
    }
    // Back/forward while the sheet is open lands on another page: close it.
    const onPop = () => onOpenChange(false)
    mq.addEventListener('change', onChange)
    window.addEventListener('popstate', onPop)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('popstate', onPop)
    }
  }, [open, onOpenChange])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        aria-describedby={undefined}
        // Start on the current page's link rather than the close button.
        onOpenAutoFocus={(e) => {
          focus.capture()
          const current = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>('a[aria-current="page"]')
          if (!current) return
          e.preventDefault()
          current.focus({ preventScroll: true })
          current.scrollIntoView?.({ block: 'nearest' })
        }}
        onCloseAutoFocus={focus.restore}
        data-aiui-mobile-nav=""
        className="w-72 max-w-[85vw] gap-0 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <div className="flex h-12 shrink-0 items-center px-4 pr-12">
          <SheetTitle asChild>
            <div className="min-w-0 flex-1">
              <SidebarBrand manifest={manifest} />
            </div>
          </SheetTitle>
        </div>
        <SidebarNav
          pages={manifest.pages}
          groupConfig={groupConfig}
          activeId={activeId}
          onNavigate={() => {
            focus.toMain()
            onOpenChange(false)
          }}
        />
      </SheetContent>
    </Sheet>
  )
}
