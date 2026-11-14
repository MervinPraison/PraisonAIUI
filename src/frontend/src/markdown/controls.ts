/**
 * Streamdown controls per variant (owner decision 9): chat keeps code copy
 * and download, table copy and mermaid pan/zoom/fullscreen; docs keeps code
 * copy and mermaid zoom only.
 *
 * Streamdown reports a failed copy only through `onError` (navigator.clipboard
 * is undefined outside a secure context, e.g. plain http to a LAN address), so
 * the reader is told instead of the button doing nothing. `notify` loads
 * sonner lazily, so it does not enter the Streamdown chunk.
 */
import type { ControlsConfig } from 'streamdown'
import { notify } from '@/sdk/notify'

export const COPY_FAILED = 'Could not copy: the clipboard needs HTTPS or localhost'

export function reportCopyError(): void {
    void notify(COPY_FAILED, { type: 'error' })
}

const COPY = { onError: reportCopyError }

export const CHAT_CONTROLS: ControlsConfig = {
    code: { copy: COPY, download: true },
    table: { copy: true, download: false, fullscreen: false },
    mermaid: { panZoom: true, fullscreen: true, download: false, copy: false },
    image: false,
}

export const DOCS_CONTROLS: ControlsConfig = {
    code: { copy: COPY, download: false },
    table: false,
    mermaid: { panZoom: true, fullscreen: false, download: false, copy: false },
    image: false,
}
