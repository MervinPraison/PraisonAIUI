import { createContext, useContext } from 'react'
import type { ShellManifest } from '@/sdk/manifest'

export interface ShellState {
  manifest: ShellManifest
  /** False while manifest plugins are still importing (late registerPage calls may follow). */
  pluginsSettled: boolean
}

export const ShellContext = createContext<ShellState | null>(null)

export function useShell(): ShellState {
  const state = useContext(ShellContext)
  if (!state) throw new Error('useShell() must be used inside the React shell')
  return state
}
