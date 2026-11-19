// Ask AI's panel (AskAi.tsx) before a question: starter questions as buttons,
// a labelled field and an icon-only send button with a name.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { AskPage } from './AskAi'

test('the panel offers the starters and names its controls', () => {
    const html = renderToStaticMarkup(<AskPage url="/api/docs/ask" starters={['How do I install it?', 'Themes?']} onNavigate={() => {}} />)
    assert.match(html, /role="group" aria-label="Suggested questions"><button type="button">How do I install it\?<\/button><button type="button">Themes\?<\/button>/)
    assert.match(html, /aria-label="Your question"/)
    assert.match(html, /aria-label="Ask"[^>]*disabled=""|disabled=""[^>]*aria-label="Ask"/)
    assert.match(html, /role="log" aria-live="polite"/)
})
