/**
 * CONTRACT STUB (WP0a). WP1 replaces this file with the lazy Streamdown
 * renderer. Contract (ADR-0001 §5):
 *   export function Markdown(p: { children: string; variant?: 'chat'|'docs'; streaming?: boolean;
 *     className?: string; components?: Record<string, ComponentType<any>> })
 *   export const preloadMarkdown
 */
import type { ComponentType } from 'react'
import { cn } from '@/lib/utils'

export interface MarkdownProps {
  children: string
  variant?: 'chat' | 'docs'
  streaming?: boolean
  className?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  components?: Record<string, ComponentType<any>>
}

/** Plain-text rendering until WP1 lands. */
export function Markdown({ children, variant = 'chat', className }: MarkdownProps) {
  return (
    <div className={cn('aiui-markdown whitespace-pre-wrap', className)} data-variant={variant}>
      {children}
    </div>
  )
}

/** Start fetching the renderer chunk before it is needed. */
// eslint-disable-next-line react-refresh/only-export-components -- contract export (ADR §5)
export const preloadMarkdown = (): Promise<void> => Promise.resolve()
