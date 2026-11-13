/**
 * What the shell shows before it has a manifest: a layout-shaped skeleton,
 * an error with Retry, or, when the server enforces auth and no token is
 * stored yet, a token prompt (the same token the legacy onboarding stores).
 */
import { useId, useState, type FormEvent } from 'react'
import { CircleAlert, KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { verifyAndStoreToken } from './auth'
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

export function TokenGate({ onAuthenticated }: { onAuthenticated: () => void }) {
  const inputId = useId()
  const errorId = useId()
  const [token, setToken] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim() || pending) return
    setPending(true)
    setError('')
    const ok = await verifyAndStoreToken(token)
    setPending(false)
    if (ok) onAuthenticated()
    else setError('The server did not accept this token.')
  }

  return (
    <div className="aiui-app flex min-h-dvh w-full items-center justify-center bg-background px-4" data-aiui-boot="auth">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4" aria-labelledby={`${inputId}-title`}>
        <div className="flex flex-col items-center gap-2 text-center">
          <KeyRound aria-hidden="true" className="size-6 text-muted-foreground" />
          <h1 id={`${inputId}-title`} className="text-base font-medium text-foreground">
            Sign in to this server
          </h1>
          <p className="text-sm text-muted-foreground">Enter the gateway token printed when the server started.</p>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium text-foreground">
            Access token
          </label>
          <Input
            id={inputId}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          {error && (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" disabled={!token.trim() || pending}>
          {pending ? 'Checking…' : 'Continue'}
        </Button>
      </form>
    </div>
  )
}
