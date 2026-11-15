/** Holds back media from another host until the viewer asks for it (exfiltration guard). */
import { useState, type JSX, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

export function ClickToLoad({ trusted, label, children }: { trusted: boolean; label: string; children: ReactNode }): JSX.Element {
  const [allowed, setAllowed] = useState(trusted)
  if (allowed) return <>{children}</>
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-tier-3" data-blocked-media>
      <span className="min-w-0 truncate">{label}</span>
      <Button type="button" variant="outline" size="xs" onClick={() => setAllowed(true)}>
        Load
      </Button>
    </div>
  )
}
