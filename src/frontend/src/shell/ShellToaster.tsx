/**
 * Lazy chunk: the sonner Toaster, mounted by the shell on the first notify().
 * Colours come from the theme tokens; sonner's own CSS reads the --normal-*
 * variables set here.
 */
import type { CSSProperties } from 'react'
import { useTheme } from 'next-themes'
import { Toaster } from 'sonner'

const toasterStyle = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--border-radius': 'calc(var(--radius) + 4px)',
  zIndex: 'var(--z-toast, 80)',
} as CSSProperties

export default function ShellToaster() {
  const { resolvedTheme } = useTheme()
  return (
    <Toaster
      theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
      position="bottom-right"
      closeButton
      visibleToasts={4}
      style={toasterStyle}
      toastOptions={{
        classNames: {
          toast: 'font-sans shadow-lg',
          title: 'text-sm font-medium',
          description: 'text-xs text-muted-foreground',
        },
      }}
    />
  )
}
