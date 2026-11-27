/**
 * Incremental NDJSON reader for streaming `@aiui.register_page_action` handlers
 * (`yield aiui.layout([...])` over `application/x-ndjson`).
 */

export function isNdjsonContentType(contentType: string | null): boolean {
  if (!contentType) return false
  const mime = contentType.split(';')[0]?.trim().toLowerCase()
  return mime === 'application/x-ndjson' || mime === 'application/ndjson'
}

function parseLine(line: string): unknown {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

/**
 * Read a `ReadableStream<Uint8Array>` of newline-delimited JSON frames and
 * invoke `onFrame` for each parsed frame as it arrives. Stops cleanly on abort.
 */
export async function readNdjsonStream(
  body: ReadableStream<Uint8Array>,
  onFrame: (frame: unknown) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const onAbort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) break
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl = buffer.indexOf('\n')
      while (nl !== -1) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        const parsed = parseLine(line)
        if (parsed !== undefined) onFrame(parsed)
        nl = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (!signal?.aborted && buffer.trim()) {
      const parsed = parseLine(buffer)
      if (parsed !== undefined) onFrame(parsed)
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
