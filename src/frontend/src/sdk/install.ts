/**
 * CONTRACT STUB (WP0a). WP7 replaces this file: installSdk() sets
 * window.__AIUI_SDK__, loadManifestPlugins() imports plugin modules.
 * Contract (ADR-0001 §5):
 *   export function installSdk(): void
 *   export function loadManifestPlugins(m: ShellManifest): Promise<void>
 */
import type { ShellManifest } from './manifest'

export function installSdk(): void {}

export async function loadManifestPlugins(manifest: ShellManifest): Promise<void> {
  void manifest
}
