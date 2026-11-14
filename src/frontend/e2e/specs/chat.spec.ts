/**
 * React chat in the app shell against the scripted provider
 * (fixtures/mock_server.py), on both transports:
 *
 *   WebSocket  the default (/api/chat/ws)
 *   SSE        POST /run, used when the socket cannot open. The tests get it
 *              the way a user does: the WebSocket is blocked.
 */
import { expect, test, type Locator, type Page, type WebSocketRoute } from '@playwright/test'
import { collectPageErrors, hasHorizontalOverflow } from './support'

const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const assistant = (page: Page) => page.locator('[data-role="assistant"]')
const stopButton = (page: Page) => page.getByRole('button', { name: 'Stop' })

async function openChat(page: Page, transport: 'ws' | 'sse') {
  if (transport === 'sse') {
    // A proxy that refuses WebSocket upgrades: the chat falls back to POST /run.
    await page.routeWebSocket(/\/api\/chat\/ws/, (ws) => ws.close({ code: 1011, reason: 'blocked by test' }))
  }
  await page.goto('/chat')
  await expect(composer(page)).toBeVisible()
  if (transport === 'ws') await expect(page.locator('[data-connection="open"]')).toBeVisible()
}

async function send(page: Page, text: string) {
  await composer(page).fill(text)
  await composer(page).press('Enter')
}

/** The run is over when the composer offers Send again. */
async function waitForRunEnd(page: Page) {
  await expect(stopButton(page)).toHaveCount(0, { timeout: 30_000 })
}

/** Frames the page sent on the chat socket, parsed. */
function recordSentFrames(page: Page): Record<string, unknown>[] {
  const frames: Record<string, unknown>[] = []
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/chat/ws')) return
    ws.on('framesent', (frame) => {
      try {
        frames.push(JSON.parse(String(frame.payload)))
      } catch {
        /* not JSON */
      }
    })
  })
  return frames
}

function recordPosts(page: Page): string[] {
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(new URL(r.url()).pathname)
  })
  return posts
}

async function expectFullTurn(page: Page, reply: Locator, text: string) {
  await expect(page.locator('[data-role="user"]')).toHaveText(text)
  await expect(reply).toContainText(`You said: ${text}`)
  await waitForRunEnd(page)
  // text: markdown, not raw asterisks
  await expect(reply.locator('strong, [data-streamdown="strong"]', { hasText: text })).toBeVisible()
  await expect(reply).not.toContainText('**')
  // reasoning: collapsed row
  await expect(reply.locator('[data-part="reasoning"]')).toContainText(/Thought/)
  // tool call: one card, finished
  await expect(reply.locator('[data-tool="web_search"]')).toHaveCount(1)
  await expect(reply.locator('[data-tool="web_search"]')).not.toHaveAttribute('data-state', 'running')
  // element from the tool result
  const image = reply.locator('[data-element="image"] img')
  await expect(image).toBeVisible()
  expect(await image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), 'image loaded').toBe(true)
  // references
  await expect(reply.locator('[data-part="references"]')).toContainText('doc.md')
  // code block rendered by the markdown renderer
  await expect(reply.locator('[data-streamdown="code-block"]')).toContainText('print(1)')
}

for (const transport of ['ws', 'sse'] as const) {
  test.describe(`chat over ${transport.toUpperCase()}`, () => {
    test('streams a full turn and restores it after a reload', async ({ page }) => {
      const errors = collectPageErrors(page)
      const posts = recordPosts(page)
      const frames = recordSentFrames(page)
      await openChat(page, transport)

      await send(page, 'hello there')
      const reply = assistant(page).last()
      await expectFullTurn(page, reply, 'hello there')
      expect(await hasHorizontalOverflow(page)).toBe(false)

      if (transport === 'sse') expect(posts).toContain('/run')
      else expect(frames.some((f) => f.type === 'chat')).toBe(true)

      // The session is in the URL, so a reload restores the conversation.
      await expect(page).toHaveURL(/[?&]session=/)
      await page.reload()
      await expect(page.locator('[data-role="user"]')).toHaveText('hello there')
      await expect(assistant(page).last()).toContainText('You said: hello there')
      await expect(assistant(page).last().locator('[data-tool="web_search"]')).toHaveCount(1)
      expect(errors.pageErrors).toEqual([])
    })

    test('Stop ends a streaming run', async ({ page }) => {
      const posts = recordPosts(page)
      const frames = recordSentFrames(page)
      await openChat(page, transport)

      await send(page, 'slow one')
      const reply = assistant(page).last()
      await expect(reply).toContainText('w3 ')
      await stopButton(page).click()
      await waitForRunEnd(page)

      const stoppedAt = await reply.innerText()
      await page.waitForTimeout(1_000)
      expect(await reply.innerText(), 'no tokens after Stop').toBe(stoppedAt)
      expect(stoppedAt).not.toContain('w299')
      if (transport === 'sse') expect(posts).toContain('/cancel')
      else expect(frames.some((f) => f.type === 'chat_abort')).toBe(true)

      // The chat is usable again.
      await send(page, 'plain after stop')
      await expect(assistant(page).last()).toContainText('You said: plain after stop')
    })

    test('an approval can be decided in the thread', async ({ page }) => {
      await openChat(page, transport)
      await send(page, 'apok now')
      const reply = assistant(page).last()
      const approve = reply.getByRole('button', { name: 'Approve' })
      await expect(approve).toBeVisible()
      await expect(reply.getByRole('button', { name: 'Deny' })).toBeVisible()
      await approve.click()
      await expect(approve).toHaveCount(0)
      const seen = await (await page.request.get('/__e2e/approval-posts')).json()
      expect(seen.posts).toContain('POST /api/approvals/ap_ok/approve')
    })

    test('a failed approval keeps the gate and says why', async ({ page }) => {
      await openChat(page, transport)
      await send(page, 'ap500 now')
      const reply = assistant(page).last()
      await reply.getByRole('button', { name: 'Approve' }).click()
      await expect(reply.getByRole('alert')).toBeVisible()
      await expect(reply.getByRole('button', { name: 'Approve' })).toBeEnabled()
    })
  })
}

test('WebSocket: a question from the agent can be answered', async ({ page }) => {
  const frames = recordSentFrames(page)
  await openChat(page, 'ws')
  await send(page, 'ask me')
  const ask = page.locator('[data-tool="aiui_ask"]')
  await expect(ask).toContainText('Pick one')
  await ask.getByRole('group', { name: 'Answers' }).getByRole('button', { name: 'A', exact: true }).click()
  await expect(ask).toHaveAttribute('data-ask-state', 'answered')
  const answer = frames.find((f) => f.type === 'ask_response')
  expect(answer, 'ask_response frame').toBeTruthy()
  expect(JSON.stringify(answer)).toContain('A')
})

test('SSE: a question explains that answering needs a live connection', async ({ page }) => {
  const errors = collectPageErrors(page)
  await openChat(page, 'sse')
  await send(page, 'ask me')
  const ask = page.locator('[data-tool="aiui_ask"]')
  await expect(ask).toContainText('Pick one')
  await expect(ask).toContainText('Answering needs a live connection')
  for (const option of await ask.getByRole('group', { name: 'Answers' }).getByRole('button').all()) {
    await expect(option).toBeDisabled()
  }
  expect(errors.pageErrors).toEqual([])
})

test('chat markdown: highlighted code, table, math, diagram, safe links and images', async ({ page }) => {
  const remoteImageRequests: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('images.example.invalid')) remoteImageRequests.push(r.url())
  })
  await openChat(page, 'ws')
  await send(page, 'markdown plain')
  const reply = assistant(page).last()
  await waitForRunEnd(page)
  await expect(reply.getByRole('heading', { name: 'Markdown sample' })).toBeVisible()
  // Shiki tokens carry both themes; the dark colour is a CSS variable.
  await expect(reply.locator('[data-streamdown="code-block"] [style*="--shiki-dark"]').first()).toBeVisible()
  await expect(reply.locator('table')).toContainText('alpha')
  await expect(reply.locator('.katex').first()).toBeVisible()
  await expect(reply.locator('svg[aria-roledescription^="flowchart"]')).toBeVisible({ timeout: 30_000 })
  // External links open in a new tab and do not leak the opener or referrer rank.
  const link = reply.getByRole('link', { name: 'link' })
  await expect(link).toHaveAttribute('href', 'https://example.com/docs')
  await expect(link).toHaveAttribute('target', '_blank')
  const rel = (await link.getAttribute('rel')) || ''
  for (const token of ['noopener', 'noreferrer', 'nofollow']) expect(rel.split(/\s+/)).toContain(token)
  // A remote image is not fetched until the reader asks for it (a model can
  // be talked into embedding a URL that leaks the conversation); the
  // placeholder names the host.
  await expect(reply).toContainText('images.example.invalid')
  await expect(reply.locator('img[src*="images.example.invalid"]')).toHaveCount(0)
  expect(remoteImageRequests).toEqual([])
  expect(await hasHorizontalOverflow(page)).toBe(false)
})

test('WebSocket: a dropped connection reconnects (closed, then open) and the next turn works', async ({ page }) => {
  // Pass the socket through, so the test can drop it like a server restart would.
  const routes: WebSocketRoute[] = []
  await page.routeWebSocket(/\/api\/chat\/ws/, (ws) => {
    ws.connectToServer()
    routes.push(ws)
  })
  await openChat(page, 'ws')
  await page.evaluate(() => {
    const w = window as unknown as { __conn: string[] }
    w.__conn = []
    const badge = () => document.querySelector('[data-connection]')
    new MutationObserver(() => w.__conn.push(badge()?.getAttribute('data-connection') ?? '')).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-connection'],
    })
  })
  const before = routes.length
  await routes[routes.length - 1].close({ code: 1012, reason: 'service restart' })
  await expect.poll(() => routes.length, { timeout: 20_000 }).toBeGreaterThan(before)
  await expect(page.locator('[data-connection="open"]')).toBeVisible({ timeout: 20_000 })
  const seen = await page.evaluate(() => (window as unknown as { __conn: string[] }).__conn)
  expect(seen, 'the badge left "open" while the socket was down').toEqual(expect.arrayContaining(['closed']))
  await send(page, 'plain after reconnect')
  await expect(assistant(page).last()).toContainText('You said: plain after reconnect')
  await waitForRunEnd(page)
})

test('two tabs on one session: each tab shows its own reply, and Stop stops only its own run', async ({ page, context }) => {
  await openChat(page, 'ws')
  await send(page, 'slow from tab one')
  await expect(assistant(page).last()).toContainText('w3 ')
  const url = page.url()
  expect(url).toMatch(/[?&]session=/)

  const tab2 = await context.newPage()
  const frames2 = recordSentFrames(tab2)
  await tab2.goto(url)
  await expect(composer(tab2)).toBeVisible()
  await expect(tab2.locator('[data-connection="open"]')).toBeVisible()
  await send(tab2, 'plain from tab two')
  const reply2 = assistant(tab2).last()
  await expect(reply2).toContainText('You said: plain from tab two')
  await waitForRunEnd(tab2)
  await expect(reply2).not.toContainText('w5 ')
  // Tab one is still streaming its own reply: tab two's run did not end it or
  // write into it. Tab two's reply shows in tab one as a separate, read-only message.
  const own = assistant(page).filter({ hasText: 'You said: slow from tab one' })
  await expect(own).toHaveCount(1)
  await expect(own).not.toContainText('plain from tab two')
  await expect(assistant(page).filter({ hasText: 'You said: plain from tab two' })).toHaveCount(1)
  await expect(stopButton(page)).toBeVisible()

  // Tab two's chat frame named its turn; tab one's Stop aborts tab one's run.
  expect(frames2.find((f) => f.type === 'chat')?.client_turn_id, 'client_turn_id on the chat frame').toBeTruthy()
  await stopButton(page).click()
  await waitForRunEnd(page)
  await tab2.close()
})

test('Regenerate replaces the answer: no duplicate turn after a reload', async ({ page }) => {
  await openChat(page, 'ws')
  await send(page, 'plain regen please')
  await expect(assistant(page).last()).toContainText('You said: plain regen please')
  await waitForRunEnd(page)
  await assistant(page).last().hover()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  await expect(assistant(page).last()).toContainText('You said: plain regen please')
  await waitForRunEnd(page)
  await page.reload()
  await expect(assistant(page).last()).toContainText('You said: plain regen please')
  await expect(page.locator('[data-role="user"]')).toHaveCount(1)
  await expect(assistant(page)).toHaveCount(1)
})

test('Regenerate is offered on the last answer only', async ({ page }) => {
  await openChat(page, 'ws')
  await send(page, 'plain alpha')
  await waitForRunEnd(page)
  await send(page, 'plain bravo')
  await expect(assistant(page).last()).toContainText('You said: plain bravo')
  await waitForRunEnd(page)
  const first = assistant(page).first()
  await first.hover()
  await expect(first.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await expect(first.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)
  await expect(assistant(page).last().getByRole('button', { name: 'Regenerate' })).toHaveCount(1)
})

test('SSE fallback: Regenerate is not offered (it would only resend the question)', async ({ page }) => {
  await openChat(page, 'sse')
  await send(page, 'plain sse regen')
  const reply = assistant(page).last()
  await expect(reply).toContainText('You said: plain sse regen')
  await waitForRunEnd(page)
  await reply.hover()
  await expect(reply.getByRole('button', { name: 'Copy', exact: true })).toBeVisible()
  await expect(reply.getByRole('button', { name: 'Regenerate' })).toHaveCount(0)
})

test('Copy and feedback on an earlier answer are reachable by keyboard', async ({ page }) => {
  await openChat(page, 'ws')
  await send(page, 'plain one')
  await waitForRunEnd(page)
  await send(page, 'plain two')
  await expect(assistant(page).last()).toContainText('You said: plain two')
  await waitForRunEnd(page)
  await page.mouse.move(0, 0)
  // Walk backwards from the composer until focus lands on the first answer's actions.
  await composer(page).focus()
  const reached = new Set<string>()
  for (let i = 0; i < 60 && reached.size < 3; i++) {
    await page.keyboard.press('Shift+Tab')
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      const first = document.querySelector('[data-role="assistant"]')
      return el && first?.contains(el) ? el.getAttribute('aria-label') : null
    })
    if (hit === 'Copy' || hit === 'Good response' || hit === 'Bad response') {
      reached.add(hit)
      // Focus inside the message reveals its actions.
      await expect
        .poll(() => page.evaluate(() => getComputedStyle((document.activeElement as HTMLElement).parentElement!).opacity))
        .toBe('1')
    }
  }
  expect([...reached].sort()).toEqual(['Bad response', 'Copy', 'Good response'])
})

test('Load earlier messages shows the older page', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = collectPageErrors(page)
  // 30 turns = 60 messages: the first page holds the last 50.
  const sid = `e2e-earlier-${Date.now()}`
  for (let i = 1; i <= 30; i++) {
    const res = await page.request.post('/run', { data: { message: `plain turn ${i}`, session_id: sid } })
    expect(res.ok()).toBe(true)
    await res.body()
  }
  const warnings: string[] = []
  page.on('console', (m) => {
    if (/duplicate message id/i.test(m.text())) warnings.push(m.text())
  })
  await page.goto(`/chat?session=${encodeURIComponent(sid)}`)
  const messages = page.locator('[data-role="user"], [data-role="assistant"]')
  await expect(messages).toHaveCount(50)
  await expect(page.locator('[data-role="user"]').first()).toHaveText('plain turn 6')
  // Hold the older page back a moment: while it loads, the button keeps
  // keyboard focus (it is not disabled) and shows a spinner.
  await page.route(/\/api\/chat\/history\/.*before=/, async (route) => {
    await new Promise((r) => setTimeout(r, 1_000))
    await route.continue()
  })
  const loadEarlier = page.locator('[data-load-earlier]')
  await loadEarlier.focus()
  await page.keyboard.press('Enter')
  await expect(loadEarlier.locator('[role="status"], svg').first()).toBeVisible()
  await expect(loadEarlier).toBeFocused()
  await expect(loadEarlier).toBeEnabled()
  await expect(messages).toHaveCount(60)
  await expect(page.locator('[data-role="user"]').first()).toHaveText('plain turn 1')
  await expect(page.locator('[data-load-earlier]')).toHaveCount(0)
  expect(warnings).toEqual([])
  expect(errors.pageErrors).toEqual([])
})

test('a default starter fills the composer instead of sending a fragment', async ({ page }) => {
  const frames = recordSentFrames(page)
  await openChat(page, 'ws')
  const card = page.locator('[data-thread-empty]').getByRole('button', { name: /Write code/ })
  await expect(card).toBeVisible()
  await card.click()
  await expect(composer(page)).toHaveValue('Write a small Python function that ')
  await expect(composer(page)).toBeFocused()
  await page.waitForTimeout(300)
  expect(frames.filter((f) => f.type === 'chat')).toEqual([])
  await expect(page.locator('[data-role="user"]')).toHaveCount(0)
})

test('a code element is highlighted like reply code, and copying without a clipboard does not throw', async ({ page }) => {
  const errors = collectPageErrors(page)
  // Plain http to a LAN address has no navigator.clipboard.
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }))
  await openChat(page, 'ws')
  await send(page, 'plain codeel')
  await waitForRunEnd(page)
  const block = assistant(page).last().locator('[data-element="code"] [data-streamdown="code-block"]')
  await expect(block).toBeVisible()
  await expect(block).toContainText('python')
  await expect(block.locator('[style*="--shiki-dark"]').first()).toBeVisible()
  await block.hover()
  await block.getByRole('button', { name: /copy/i }).first().click()
  // The failure is reported, not swallowed.
  await expect(page.getByText('Could not copy: the clipboard needs HTTPS or localhost')).toBeVisible()
  expect(errors.pageErrors).toEqual([])
})

test('mermaid fullscreen behaves as a modal: focus moves in, the page behind is inert, focus returns', async ({ page }) => {
  await openChat(page, 'ws')
  await send(page, 'markdown plain')
  await waitForRunEnd(page)
  const reply = assistant(page).last()
  await expect(reply.locator('svg[aria-roledescription^="flowchart"]')).toBeVisible({ timeout: 30_000 })
  const trigger = reply.getByRole('button', { name: 'View fullscreen' })
  await trigger.click()
  const dialog = page.locator('[data-streamdown="mermaid-fullscreen"]')
  await expect(dialog).toBeVisible()
  const focusInside = () => dialog.evaluate((el) => el.contains(document.activeElement))
  await expect.poll(focusInside).toBe(true)
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    expect(await focusInside(), `Tab ${i + 1} stays in the dialog`).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.querySelector('#root')?.hasAttribute('inert'))).toBe(false)
})

test('the chat page has one h1 (the shell header); the chat title is an h2', async ({ page }) => {
  await openChat(page, 'ws')
  await expect(page.locator('h1')).toHaveCount(1)
  await expect(page.locator('h2[data-chat-title]')).toHaveText('New chat')
})

test('tool and reasoning rows are disclosures: aria-controls names the panel they open', async ({ page }) => {
  await openChat(page, 'ws')
  await send(page, 'disclose this')
  await waitForRunEnd(page)
  const reply = assistant(page).last()
  for (const row of [reply.locator('[data-tool="web_search"]'), reply.locator('[data-part="reasoning"]')]) {
    const button = row.locator('button[aria-expanded]').first()
    await expect(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    await expect(button).toHaveAttribute('aria-expanded', 'true')
    const id = await button.getAttribute('aria-controls')
    expect(id, 'aria-controls').toBeTruthy()
    await expect(row.locator(`[id="${id}"]`)).toBeVisible()
  }
})

test('session rail rename and delete keep keyboard focus in the rail', async ({ page }) => {
  await openChat(page, 'ws')
  const title = `plain focus ${Date.now()}`
  await send(page, title)
  await waitForRunEnd(page)
  const rail = page.getByRole('navigation', { name: 'Chats' })
  // A second chat stays open, so the one under test is not the active chat.
  await rail.getByRole('button', { name: 'New chat' }).click()
  await send(page, `plain other ${Date.now()}`)
  await waitForRunEnd(page)
  const row = rail.locator('li', { hasText: title }).first()
  await expect(row).toBeVisible()
  const rowButton = row.locator('> button')
  const focusedLabel = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent?.trim() ?? '')

  // The actions show on focus: Tab from the row reaches Rename, then Delete.
  const toAction = async (name: 'Rename' | 'Delete') => {
    await rowButton.focus()
    await page.keyboard.press('Tab')
    if (name === 'Delete') await page.keyboard.press('Tab')
    await expect(row.getByRole('button', { name: new RegExp(`^${name} `) })).toBeFocused()
  }

  // Delete, then Cancel: focus goes to Cancel, then back to the row.
  await toAction('Delete')
  await page.keyboard.press('Enter')
  await expect(rail.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(rowButton).toBeFocused()

  // Rename, then Escape: back to the row.
  await toAction('Rename')
  await page.keyboard.press('Enter')
  await expect(rail.getByRole('textbox', { name: 'Chat title' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(rowButton).toBeFocused()

  // Delete for real: focus moves to a neighbour row or New chat, never <body>.
  await toAction('Delete')
  await page.keyboard.press('Enter')
  await rail.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(rail.locator('li', { hasText: title })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('nav[aria-label="Chats"]') !== null)).toBe(true)
  expect(await focusedLabel()).not.toContain(title)
})

test.describe('phone session rail', () => {
  test.use({ viewport: { width: 390, height: 800 } })

  test('opens as a modal dialog: focus moves in, Tab stays in, Escape closes and focus returns', async ({ page }) => {
    await openChat(page, 'ws')
    const show = page.getByRole('button', { name: 'Show chats' })
    await show.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Chats' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toHaveAttribute('aria-modal', 'true')
    const focusInside = () => dialog.evaluate((el) => el.contains(document.activeElement))
    await expect.poll(focusInside).toBe(true)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await focusInside(), `Tab ${i + 1} stays in the rail`).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(show).toBeFocused()

    // The close button also hands focus back.
    await show.click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: 'Close chats' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(show).toBeFocused()
  })
})

test.describe('session rail on a touch screen', () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true })

  test('Rename and Delete are visible without hover', async ({ page }) => {
    await openChat(page, 'ws')
    await send(page, 'plain touch rail')
    await waitForRunEnd(page)
    await page.getByRole('button', { name: 'Show chats' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Chats' })
    const row = dialog.locator('li', { hasText: /plain touch rail/i }).first()
    await expect(row.getByRole('button', { name: /^Rename / })).toBeVisible()
    await expect(row.getByRole('button', { name: /^Delete / })).toBeVisible()
    await row.getByRole('button', { name: /^Delete / }).tap()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
  })
})
