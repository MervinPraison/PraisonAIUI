// lib/auth: the stored token goes out on same-origin requests, and a 401 on
// page content (not /api) tells the sign-in prompt to show.
import { test } from 'node:test'
import assert from 'node:assert/strict'

type Call = { url: string; auth: string | null }
const calls: Call[] = []
const statusFor = new Map<string, number>()
const store = new Map<string, string>()

const g = globalThis as unknown as Record<string, unknown>
g.window = globalThis
g.location = { href: 'http://site.test/docs/a', origin: 'http://site.test' }
g.sessionStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
}
g.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  calls.push({ url, auth: new Headers(init?.headers).get('Authorization') })
  return new Response('x', { status: statusFor.get(url) ?? 200 })
}

const { installAuthFetch, onAuthRequired, TOKEN_STORAGE_KEY } = await import('@/lib/auth')
installAuthFetch()
installAuthFetch() // idempotent

test('same-origin requests carry the stored token; other origins never do', async () => {
  calls.length = 0
  store.set(TOKEN_STORAGE_KEY, 'tok')
  await fetch('/docs/a.md')
  await fetch('/search-index.json')
  await fetch('https://cdn.example/x.js')
  assert.deepEqual(calls, [
    { url: '/docs/a.md', auth: 'Bearer tok' },
    { url: '/search-index.json', auth: 'Bearer tok' },
    { url: 'https://cdn.example/x.js', auth: null },
  ])
  store.clear()
})

test('a 401 on page content asks for sign-in; /api, POST and other origins do not', async () => {
  const seen: string[] = []
  const off = onAuthRequired((url) => seen.push(url))
  for (const url of ['/docs/a.md', '/api/sessions', 'https://cdn.example/a.md']) statusFor.set(url, 401)
  await fetch('/docs/a.md')
  await fetch('/api/sessions')
  await fetch('/docs/a.md', { method: 'POST' })
  await fetch('https://cdn.example/a.md')
  await fetch('/docs/ok.md')
  assert.deepEqual(seen, ['/docs/a.md'])
  off()
  await fetch('/docs/a.md')
  assert.deepEqual(seen, ['/docs/a.md'], 'unsubscribed')
  statusFor.clear()
})
