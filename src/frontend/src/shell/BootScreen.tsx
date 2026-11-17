/**
 * What the shell shows before it has a manifest: a layout-shaped skeleton,
 * an error with Retry, or, when the server enforces auth and no token is
 * stored yet, the token prompt (lib/TokenGate; the same token the legacy
 * onboarding stores).
 */
import { CircleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, PageSkeleton } from './primitives'

export function BootSkeleton() {
  return (
    <div
      className="aiui-app flex h-dvh w-full overflow-hidden bg-background"
      role="status"
      aria-label="Loading"
      data-aiui-boot="loading"
    >
      <div className="hidden h-full w-60 shrink-0 flex-col gap-2 border-r border-sidebar-border bg-sidebar p-3 md:flex">
        <Skeleton className="mb-4 h-6 w-32" />
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-7 w-full" />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b border-border px-4">
          <Skeleton className="h-5 w-40" />
        </div>
        <div className="px-4 py-4 md:px-8 md:py-6 lg:px-10 lg:py-8">
          <PageSkeleton />
        </div>
      </div>
    </div>
  )
}

export function BootError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="aiui-app flex min-h-dvh w-full items-center justify-center bg-background" data-aiui-boot="error">
      <EmptyState role="alert" icon={<CircleAlert />} title="Could not load the app" description={message}>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </EmptyState>
    </div>
  )
}

// The sign-in prompt, shared with the legacy React App (AuthGate.tsx).
export { TokenGate } from '@/lib/TokenGate'
