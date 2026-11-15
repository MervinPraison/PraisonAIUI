/**
 * An artifact's versions: the version menu in the panel header
 * ("v2 · edited by Researcher") and the History list beside the viewer, with
 * Restore on every version that is not the latest.
 */
import { useEffect, useId, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import { ChevronDown, History } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DerivedArtifact } from './derive'
import { clockTime, describeVersion } from './format'

const byLine = (a: DerivedArtifact) => (a.edited ? 'edited by you' : a.version > 1 ? `edited by ${a.agent ?? 'the agent'}` : `by ${a.agent ?? 'the agent'}`)

export interface VersionsProps {
  /** Every version of the key, oldest first. */
  versions: readonly DerivedArtifact[]
  shown: DerivedArtifact
  onShow(version: number): void
  onRestore(version: number): void
}

/**
 * The version button and its list: a disclosure (not a Radix menu, whose
 * popper and focus scope would triple this feature's size). Escape, a click
 * outside or a choice closes it and gives focus back to the button.
 */
export function VersionMenu({ versions, shown, onShow }: Omit<VersionsProps, 'onRestore'>): JSX.Element {
  const latest = versions[versions.length - 1]
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const listId = useId()
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])
  const close = () => {
    setOpen(false)
    button.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close()
    } else if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[data-version-item]') ?? [])]
      const i = items.indexOf(document.activeElement as HTMLButtonElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }
  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown}>
      <Button
        ref={button}
        variant="outline"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`Version ${shown.version} of ${versions.length}. Show another version`}
        onClick={() => setOpen((o) => !o)}
      >
        <History className="text-tier-2" />
        <span className="font-semibold">v{shown.version}</span>
        <span className="hidden text-tier-3 sm:inline">· {byLine(shown)}</span>
        <ChevronDown className="size-3.5 text-tier-3" />
      </Button>
      {open && (
        <ul id={listId} aria-label="Versions" className="absolute top-full right-0 z-20 m-0 mt-1 flex min-w-52 list-none flex-col rounded-lg border border-border bg-popover p-1 shadow-md">
          {[...versions].reverse().map((v) => (
            <li key={v.version}>
              <button
                type="button"
                data-version-item
                aria-current={v === shown ? 'true' : undefined}
                onClick={() => {
                  onShow(v.version)
                  close()
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent',
                  v === shown && 'bg-row-active',
                )}
              >
                <span className="font-semibold">v{v.version}</span>
                <span className="text-tier-3">
                  {v === latest ? 'Current · ' : ''}
                  {clockTime(v.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function HistoryList({ versions, shown, onShow, onRestore, className }: VersionsProps & { className?: string }): JSX.Element {
  const latest = versions[versions.length - 1]
  return (
    <aside aria-label="History" className={cn('flex flex-col gap-2.5', className)}>
      <h3 className="m-0 text-xs font-semibold text-tier-3">History</h3>
      <ol className="m-0 flex list-none flex-col gap-3 p-0">
        {[...versions].reverse().map((v, i, all) => {
          const current = v === latest
          return (
            <li key={v.version} className="flex gap-2.5">
              <span
                aria-hidden
                className={cn('mt-1.5 shrink-0 rounded-full', current ? 'size-2.5 bg-primary' : 'size-2 border border-tier-3', v === shown && !current && 'bg-tier-3')}
              />
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={() => onShow(v.version)}
                  aria-current={v === shown ? 'true' : undefined}
                  className="rounded-sm text-left text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-semibold">v{v.version}</span>
                  {current && <span className="text-xs font-semibold text-link"> · Current</span>}
                  {v === shown && !current && <span className="text-xs text-tier-3"> · Showing</span>}
                </button>
                <div className="text-xs text-tier-2">{describeVersion(v, all[i + 1])}</div>
                <div className="text-xs text-tier-3">
                  {clockTime(v.updatedAt)}
                  {!current && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        onClick={() => onRestore(v.version)}
                        className="rounded-sm font-semibold text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`Restore version ${v.version}`}
                      >
                        Restore
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
