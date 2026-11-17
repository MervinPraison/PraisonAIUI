/**
 * The small status and tile pieces the app pages draw in the PraisonAI Pro
 * tokens. Kept apart from ./shared (helpers and hooks) so each module exports
 * either components or plain functions, which is what Fast Refresh needs.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Tone } from './shared'

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
  idle: 'bg-muted-foreground/50',
  info: 'bg-info',
}

/** A 6px dot and a 12px muted label: how every app page says a status. */
export function StatusDot({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground', className)}>
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      <span className="truncate">{children}</span>
    </span>
  )
}

const PILL: Record<Tone, string> = {
  ok: 'bg-success-soft text-success',
  warn: 'bg-warning-soft text-warning',
  bad: 'bg-danger-soft text-destructive',
  idle: 'bg-muted text-muted-foreground',
  info: 'bg-info-soft text-info',
}

/** A status pill (Running, Idle, Failed…). */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-medium whitespace-nowrap', PILL[tone])}>{children}</span>
}

/** A titled card section of a page. */
export function Section({
  title,
  meta,
  action,
  children,
  className,
}: {
  title: string
  meta?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-label={title} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-h-7 items-center gap-2">
        <h2 className="m-0 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
        {meta && <span className="min-w-0 truncate text-xs text-tier-3">{meta}</span>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  )
}

/** Page body: the reading width and the Pro page padding. */
export function PageBody({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn('mx-auto flex w-full min-w-0 flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6', wide ? 'max-w-[1200px]' : 'max-w-[1040px]', className)}>{children}</div>
}
