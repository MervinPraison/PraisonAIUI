import { useEffect, useState, useCallback } from 'react'

export function useSessionSearch() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check for Ctrl+K (Windows/Linux) or Cmd+K (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const onOpenChange = useCallback((open: boolean) => {
    setOpen(open)
  }, [])

  return {
    open,
    setOpen,
    onOpenChange,
  }
}