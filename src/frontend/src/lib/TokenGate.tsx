/**
 * The sign-in prompt: asks for the server's access token, checks it against
 * GET /api/auth/status and stores it (lib/auth). The app shell shows it
 * before its manifest loads (shell/BootScreen); the legacy React App shows it
 * when the server keeps a page's content behind auth (legacy-app-entry).
 */
import { useId, useState, type FormEvent } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { verifyAndStoreToken } from '@/lib/auth'

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
