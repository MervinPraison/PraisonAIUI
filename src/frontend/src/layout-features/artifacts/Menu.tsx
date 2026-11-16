/**
 * A small disclosure list under a button (the version menu, the canvas's
 * "+"): not a Radix menu, whose popper and focus scope would triple this
 * feature's size. Escape, a click outside or a choice closes it and gives
 * focus back to the button; arrow keys move between its items.
 */
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { cn } from '@/lib/utils'

export interface MenuButtonProps {
  ref: Ref<HTMLButtonElement>
  'aria-expanded': boolean
  'aria-controls'?: string
  onClick(): void
}

export const menuItemClass = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent'

export function Menu({ label, button, children, className }: {
  /** The list's accessible name. */
  label: string
  button(p: MenuButtonProps): ReactNode
  /** The items: buttons with data-menu-item (a click on one closes the menu). */
  children: ReactNode
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const close = () => {
    setOpen(false)
    btn.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-menu-item]') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }
  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      {button({ ref: btn, 'aria-expanded': open, 'aria-controls': open ? listId : undefined, onClick: () => setOpen((o) => !o) })}
      {open && (
        <ul
          id={listId}
          aria-label={label}
          className={cn('absolute top-full right-0 z-20 m-0 mt-1 flex min-w-52 list-none flex-col rounded-lg border border-border bg-popover p-1 shadow-md', className)}
          onClick={(e) => (e.target as Element).closest('[data-menu-item]') && close()}
        >
          {children}
        </ul>
      )}
    </div>
  )
}
