/**
 * Lazy chunk of docs/CustomBlock.tsx: imports a site component's module through
 * the plugin loader (sdk/loadPlugins.ts) and returns the block it registered.
 * The module registers the tag with `registerBlock` from `@aiui/sdk`, or
 * exports a component under the tag's name. Same-origin modules only.
 */
import { installSdk } from '@/sdk/install'
import { loadPluginModules } from '@/sdk/loadPlugins'
import { getBlock, type BlockComponent } from '@/sdk/registry'
import type { ShellManifest } from '@/sdk/manifest'

export async function loadBlock(tag: string, src: string): Promise<BlockComponent | null> {
    if (new URL(src, document.baseURI).origin !== window.location.origin) {
        console.warn(`[aiui docs] <${tag}>: ${src} is not on this site`)
        return null
    }
    installSdk()
    const manifest = { pages: [], blocks: [{ type: tag, module: src, export: tag, source: 'site:components' }], toolRenderers: [] }
    // A failure is logged and fired as `aiui:plugin-error`; the page shows the tag's children.
    await loadPluginModules(manifest as unknown as ShellManifest, { onError: () => undefined })
    return getBlock(tag) ?? null
}
