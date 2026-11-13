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
