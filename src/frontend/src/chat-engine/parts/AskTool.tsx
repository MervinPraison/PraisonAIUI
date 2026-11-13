/**
 * run_paused "ask" prompt (lazy chunk), rendered through assistant-ui's tool
 * approval seam: approval.display is 'select' (options) or 'text' (free form).
 * Answers go back over the WebSocket (ask_response). A turn carried by SSE has
 * no answer channel, so the prompt says so and disables its controls.
 */
import { useState, type FC, type FormEvent } from 'react'
import { useAuiState, type ToolCallMessagePartProps } from '@assistant-ui/react'
import { MessageCircleQuestion, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { APPROVAL_ERROR, APPROVAL_PENDING } from '../protocol'
import { Spinner } from '../ui'

const AskTool: FC<ToolCallMessagePartProps> = ({ approval, respondToApproval, result, artifact }) => {
  const via = useAuiState((s) => (s.message.metadata.custom as { via?: string }).via)
  const [value, setValue] = useState('')
  const [clicked, setClicked] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  if (!approval) return null
  // In-flight and rejected answers are kept on the part by the store, so they survive a remount.
  const a = (artifact ?? {}) as Record<string, unknown>
  const partError = typeof a[APPROVAL_ERROR] === 'string' ? (a[APPROVAL_ERROR] as string) : null
  const busy = clicked || Boolean(a[APPROVAL_PENDING])
  const error = partError ?? localError
  const answered = approval.approved !== undefined
  const offline = via === 'sse'
  const disabled = offline || busy

  const respond = async (response: Parameters<typeof respondToApproval>[0]) => {
    setClicked(true)
    setLocalError(null)
    try {
      await respondToApproval(response)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'The answer could not be sent')
    } finally {
      setClicked(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = value.trim()
    if (text && !disabled) void respond({ text })
  }

  return (
    <div className="my-3 rounded-xl border border-border bg-background p-3 shadow-sm" data-tool="aiui_ask" data-ask-state={answered ? 'answered' : 'open'}>
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="min-w-0 flex-1 text-sm font-medium break-words text-foreground">{approval.prompt}</p>
      </div>
      {answered ? (
        <p className="mt-2 pl-6 text-sm text-muted-foreground">
          Answered: <span className="text-foreground">{String(result ?? approval.text ?? '')}</span>
        </p>
      ) : (
        <div className="mt-3 pl-6">
          {approval.options?.length ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Answers">
              {approval.options.map((o) => (
                <Button key={o.id} type="button" variant="outline" size="sm" disabled={disabled} onClick={() => void respond({ approved: true, optionId: o.id })}>
                  {o.label}
                </Button>
              ))}
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={submit}>
              <input
                className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
                value={value}
                disabled={disabled}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Type your response…"
                aria-label="Your response"
              />
              <Button type="submit" size="sm" disabled={disabled || !value.trim()}>
                {busy ? <Spinner /> : 'Send'}
              </Button>
            </form>
          )}
          {offline && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <WifiOff className="size-3.5" aria-hidden /> Answering needs a live connection. Reconnect and send your message again.
            </p>
          )}
          {error && (
            <p className="mt-2 text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export default AskTool
