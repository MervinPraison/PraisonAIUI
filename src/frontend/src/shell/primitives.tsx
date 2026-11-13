/**
 * Shell-local presentational primitives: Kbd, EmptyState, PageSkeleton.
 *
 * WP0b adds the shared shadcn `kbd`, `empty` and `spinner` components in
 * parallel with this package, so the shell cannot import them yet. These are
 * deliberately tiny and API-compatible in spirit; once WP0b is merged they
 * should be swapped for @/components/ui/kbd and @/components/ui/empty (see the
 * WP6 cross-file request) so there is one primitive per concern.
 */
import type { ComponentProps, ReactNode } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 select-none items-center justify-center gap-0.5 rounded-md border border-border bg-muted px-1 font-sans text-xs font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function EmptyState({
  icon,
  title,
  description,
  children,
  className,
  role,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div
      data-slot="empty"
      role={role}
      className={cn('mx-auto flex max-w-md flex-col items-center gap-2 px-4 py-16 text-center', className)}
    >
      {icon && <div className="mb-2 text-muted-foreground [&_svg]:size-6">{icon}</div>}
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      {description && <p className="text-sm text-balance text-muted-foreground">{description}</p>}
      {children && <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{children}</div>}
    </div>
  )
}

/** Suspense fallback for a page body. */
export function PageSkeleton({ fill = false }: { fill?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading page"
      data-aiui-skeleton="page"
      className={cn('flex w-full flex-col gap-4', fill ? 'p-4 md:p-8' : '')}
    >
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full max-w-xl" />
      <Skeleton className="h-4 w-full max-w-lg" />
      <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </div>
  )
}
