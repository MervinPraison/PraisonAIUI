/**
 * The Command Deck's command bar (Command.dc.html header): "@Agent  Ask or
 * run a command…". A launcher, not a second palette:
 *   - typing `/` (or `>`) first opens the one cmdk palette, with what follows
 *     typed in; ⌘K in the bar opens it with the bar's text;
 *   - Enter asks: the text goes to the chat (onAsk; the frame sends it);
 *   - `/` anywhere outside a text field focuses the bar.
 * A lazy chunk (`lf-command-bar`): the frame imports it with import(). The
 * frame hands it the platform and its typing check (the kit's): a feature
 * that imported the kit itself would split the kit into one more chunk for
 * every layout.
 */
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { barIntent } from './bar'

export interface CommandBarProps {
  /** LayoutChrome.openPalette */
  openPalette(opts?: { query?: string }): void
  /** Enter on plain text: send it to the chat. */
  onAsk(text: string): void
  /** The agent the bar talks to (the chip); none hides it. */
  agent?: string
  size?: 'default' | 'touch'
  /** Apple keys (⌘) rather than Ctrl. */
  mac: boolean
  /** True for a target the viewer types in (the `/` key is theirs there). */
  isTypingTarget(target: EventTarget | null): boolean
  className?: string
}

export default function CommandBar({ openPalette, onAsk, agent, size = 'default', mac, isTypingTarget, className }: CommandBarProps): JSX.Element {
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const touch = size === 'touch'

  // `/` outside a text field focuses the bar (the key is not typed).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return
      if ((e.target as Element | null)?.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isTypingTarget])

  const toPalette = (query: string) => {
    setValue('')
    input.current?.blur()
    openPalette({ query })
  }

  // While `/…` is typed the bar keeps the text and the focus and hands every
  // change to the palette: keys typed before the palette has mounted and
  // taken the focus are not lost. Once it has the focus the bar empties.
  const onChange = (next: string) => {
    setValue(next)
    const intent = barIntent(next)
    if (intent.kind === 'palette') openPalette({ query: intent.query })
  }
  const onBlur = () => {
    if (barIntent(value).kind === 'palette') setValue('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key.toLowerCase() === 'k' && (mac ? e.metaKey : e.ctrlKey) && !e.altKey) {
      // The shell's own ⌘K would open the palette empty: hand it the text instead.
      e.preventDefault()
      e.stopPropagation()
      toPalette(value.trim())
      return
    }
    if (e.key === 'Escape' && value) {
      e.preventDefault()
      setValue('')
      return
    }
    if (e.key !== 'Enter' || e.shiftKey) return
    const intent = barIntent(value)
    if (intent.kind === 'none') return
    e.preventDefault()
    if (intent.kind === 'palette') toPalette(intent.query)
    else {
      setValue('')
      onAsk(intent.text)
    }
  }

  return (
    <div
      role="search"
      data-command-bar=""
      className={cn(
        'flex min-w-0 items-center gap-2 border border-input bg-muted pr-1.5 pl-2.5 focus-within:ring-2 focus-within:ring-ring',
        touch ? 'h-11 rounded-lg' : 'h-10 rounded-md',
        className,
      )}
    >
      {/* The terminal prompt glyph, drawn here: the chat route's lucide Terminal would become a shared chunk. */}
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="size-4 shrink-0 text-tier-3">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" x2="20" y1="19" y2="19" />
      </svg>
      {agent && !touch && (
        <span className="max-w-40 shrink-0 truncate rounded-xs bg-accent-soft px-1.5 font-mono text-2xs leading-5 font-medium text-link" data-command-bar-agent>
          @{agent}
        </span>
      )}
      <label htmlFor={id} className="sr-only">
        Ask or run a command
      </label>
      <input
        ref={input}
        id={id}
        type="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="send"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        placeholder="Ask or run a command…"
        aria-keyshortcuts="/"
        data-command-bar-input=""
        className={cn(
          'h-full min-w-0 flex-1 border-0 bg-transparent text-foreground outline-none placeholder:text-tier-3',
          touch ? 'text-base' : 'text-sm',
        )}
      />
      <span aria-hidden className="flex shrink-0 items-center gap-1 text-2xs text-tier-3">
        <Kbd>/</Kbd>
        {!touch && (
          <>
            <span>run</span>
            <Kbd>{mac ? '⌘K' : 'Ctrl K'}</Kbd>
          </>
        )}
      </span>
    </div>
  )
}
