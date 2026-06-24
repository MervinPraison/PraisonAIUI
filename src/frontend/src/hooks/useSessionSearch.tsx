import { useEffect, useState, useCallback } from 'react'

export function useSessionSearch(enabled: boolean = true) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+K (Windows/Linux) or Cmd+K (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled])

  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
  }, [])

  return {
    open,
    setOpen,
    onOpenChange,
  }
}