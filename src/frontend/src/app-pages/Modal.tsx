/**
 * The app pages' modal (confirm Delete, Clear, Rename): radix Dialog with
 * the look of components/ui/dialog, closed by its own Cancel button and
 * Esc. Drawn here without that component's close icon: an icon module the
 * chat route also uses would be split into a chunk of its own and add a
 * request to the chat's first screen (R10).
 */
import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  onOpenAutoFocus,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: ReactNode
  /** The body and the actions row. */
  children?: ReactNode
  /** Where focus goes on open (default: the first focusable control); call preventDefault and focus your own. */
  onOpenAutoFocus?: (event: Event) => void
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className="fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border border-hairline bg-background p-6 shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg">
          <div className="flex flex-col gap-2">
            <DialogPrimitive.Title className="m-0 text-lg leading-none font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="m-0 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
            )}
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** The actions row of a modal: right-aligned, stacked on a phone. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{children}</div>
}
