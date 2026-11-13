import { createContext, useContext } from 'react'
import type { ShellPage } from '@/sdk/manifest'

export interface BlockActionRequest {
  /** JSON body POSTed to the page's action endpoint. */
  body: Record<string, unknown>
  /** Label for notifications, e.g. the button text. */
  label?: string
}

export interface BlockContextValue {
  page?: ShellPage
  /**
   * POST to the page's action endpoint. A response carrying a block tree
   * replaces the page; otherwise its `message`/`error` is shown as a toast.
   * Resolves true on success.
   */
  runAction(req: BlockActionRequest): Promise<boolean>
}

const noPage: BlockContextValue = {
  async runAction() {
    console.warn('[aiui blocks] action ignored: the block is not rendered inside a BlockPage')
    return false
  },
}

export const BlockContext = createContext<BlockContextValue>(noPage)

export function useBlockContext(): BlockContextValue {
  return useContext(BlockContext)
}

/**
 * True inside a framed block (card, table, expander, accordion). A framed
 * block nested in another frame renders flat (no border, no extra padding):
 * the design system groups with whitespace and one hairline, never
 * card-in-card.
 */
export const InFrameContext = createContext(false)

export function useInFrame(): boolean {
  return useContext(InFrameContext)
}
