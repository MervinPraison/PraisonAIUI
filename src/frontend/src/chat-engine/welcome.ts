/**
 * The app's greeting (`@aiui.welcome`, or `welcome:` in a chat YAML), shown
 * on an empty thread. `POST /welcome` runs the callback and streams what it
 * says as server-sent events: `{type:'message', content}` per `aiui.say`,
 * `{type:'token', token}` per streamed token, then `{type:'end'}`. An app
 * without a welcome callback answers with `end` alone.
 */

/** The greeting text in a `/welcome` event stream ('' when there is none). */
export function parseWelcomeStream(body: string): string {
  const parts: string[] = []
  let streamed = ''
  let streamId: unknown
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    let ev: unknown
    try {
      ev = JSON.parse(line.slice(5).trim())
    } catch {
      continue
    }
    if (!ev || typeof ev !== 'object') continue
    const { type, content, token, message_id: id } = ev as Record<string, unknown>
    if (type === 'message' && typeof content === 'string' && content.trim()) {
      // A streamed Message ends with a `message` of its full text: it replaces the tokens.
      if (streamed && (id === undefined || id !== streamId)) parts.push(streamed)
      streamed = ''
      parts.push(content)
    } else if (type === 'token' && typeof token === 'string') {
      if (streamed && id !== streamId) {
        parts.push(streamed)
        streamed = ''
      }
      streamId = id
      streamed += token
    }
  }
  if (streamed) parts.push(streamed)
  return parts.join('\n\n').trim()
}

let pending: Promise<string> | null = null

/** The greeting, fetched once per page load (the callback runs on the server). */
export function fetchWelcome(): Promise<string> {
  pending ??= fetch('/welcome', { method: 'POST', credentials: 'same-origin', headers: { Accept: 'text/event-stream' } })
    .then((res) => (res.ok ? res.text() : ''))
    .then(parseWelcomeStream)
    .catch(() => '')
  return pending
}

/** Tests only: forget the fetched greeting. */
export function resetWelcomeForTests(): void {
  pending = null
}
