/**
 * Small chat-local primitives.
 *
 * TODO(WP0b merge): replace Spinner and Kbd with components/ui/spinner and
 * components/ui/kbd once the design-system package lands (one primitive per
 * concern, DESIGN.md). They are kept API-compatible (className only) so the
 * swap is an import change.
 */
import type { ComponentProps } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Spinner({ className, ...props }: ComponentProps<'svg'>) {
  return (
    <LoaderCircle
      role="status"
      aria-label="Loading"
      className={cn('size-4 animate-spin motion-reduce:animate-none', className)}
      {...props}
    />
  )
}

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none',
        className,
      )}
      {...props}
    />
  )
}
