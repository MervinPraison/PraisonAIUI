/**
 * CONTRACT STUB (WP0a). WP4 replaces this file with the loader that imports
 * /plugins/dashboard.js once and calls its initHostRuntime().
 * Contract (ADR-0001 §5):
 *   ensureLegacyRuntime(): Promise<{ pages: unknown[]; mountView(id, el, {page, signal}): Promise<() => void> }>
 *   preloadLegacyRuntime(): void
 *   setLegacyNavigator(fn: (id: string) => void): void
 */
import type { ShellPage } from '../sdk/manifest'

export interface LegacyMountOptions {
  page?: ShellPage
  signal?: AbortSignal
}

export interface LegacyRuntime {
  pages: unknown[]
  mountView(pageId: string, el: HTMLElement, opts: LegacyMountOptions): Promise<() => void>
}

export function ensureLegacyRuntime(): Promise<LegacyRuntime> {
  return Promise.reject(new Error('legacy runtime is not available in this build (WP4 stub)'))
}

/** Warm the runtime import ahead of navigation. No-op in the stub. */
export function preloadLegacyRuntime(): void {}

/** The shell installs its router here; legacy selectPage() calls go through it. */
export function setLegacyNavigator(fn: (pageId: string) => void): void {
  void fn
}
