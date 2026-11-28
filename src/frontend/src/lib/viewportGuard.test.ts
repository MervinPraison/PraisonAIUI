import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindSurfaceChrome } from './viewportGuard'

type MockEl = {
  tag: string
  parentNode: MockEl | null
  children: MockEl[]
  nextSibling: MockEl | null
  hidden: boolean
  style: { cssText: string }
  attrs: Record<string, string>
  href?: string
  target?: string
  rel?: string
  textContent: string
  parts: unknown[]
  queries: Record<string, MockEl | null>
  appendChild(child: MockEl): MockEl
  insertBefore(child: MockEl, ref: MockEl | null): MockEl
  append(...items: unknown[]): void
  remove(): void
  getAttribute(k: string): string | null
  removeAttribute(k: string): void
  querySelector(sel: string): MockEl | null
  closest(sel: string): MockEl | null
  attachShadow(opts: { mode: string }): { append(...items: unknown[]): void }
}

function makeHarness() {
  const shadowNodes: unknown[] = []
  let shadowMode = ''
  const obs: { cb: (() => void) | null } = { cb: null }
  let disconnected = false

  const relink = (parent: MockEl) => {
    parent.children.forEach((c, i) => {
      c.nextSibling = parent.children[i + 1] ?? null
    })
  }

  const mk = (tag: string): MockEl => {
    const el: MockEl = {
      tag,
      parentNode: null,
      children: [],
      nextSibling: null,
      hidden: false,
      style: { cssText: '' },
      attrs: {},
      textContent: '',
      parts: [],
      queries: {},
      appendChild(child) {
        if (child.parentNode) child.remove()
        child.parentNode = el
        el.children.push(child)
        relink(el)
        return child
      },
      insertBefore(child, ref) {
        if (child.parentNode) child.remove()
        child.parentNode = el
        const idx = ref ? el.children.indexOf(ref) : -1
        if (idx >= 0) el.children.splice(idx, 0, child)
        else el.children.push(child)
        relink(el)
        return child
      },
      append(...items) {
        el.parts.push(...items)
      },
      remove() {
        if (el.parentNode) {
          const p = el.parentNode
          p.children = p.children.filter((c) => c !== el)
          el.parentNode = null
          el.nextSibling = null
          relink(p)
        }
      },
      getAttribute(k) {
        return el.attrs[k] ?? null
      },
      removeAttribute(k) {
        delete el.attrs[k]
      },
      querySelector(sel) {
        return el.queries[sel] ?? null
      },
      closest() {
        return null
      },
      attachShadow(opts) {
        shadowMode = opts.mode
        return {
          append(...items) {
            shadowNodes.push(...items)
          },
        }
      },
    }
    return el
  }

  return { mk, shadowNodes, getShadowMode: () => shadowMode, obs, isDisconnected: () => disconnected, setDisconnected: (v: boolean) => { disconnected = v } }
}

test('bindSurfaceChrome mounts closed shadow root with decoded link and heals tampering', () => {
  assert.doesNotThrow(() => bindSurfaceChrome(null)())
  const h = makeHarness()
  const prevDoc = globalThis.document
  const prevMo = globalThis.MutationObserver
  try {
    const body = h.mk('body')
    ;(globalThis as unknown as { document: { body: MockEl; createElement: (t: string) => MockEl } }).document = {
      body,
      createElement: h.mk,
    }
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
      constructor(cb: () => void) {
        h.obs.cb = cb
      }
      observe() {}
      disconnect() {
        h.setDisconnected(true)
      }
    }

    const parent = h.mk('div')
    const cleanup = bindSurfaceChrome(parent as unknown as HTMLElement)

    assert.equal(h.getShadowMode(), 'closed')
    assert.equal(parent.children.length, 1)
    const host = parent.children[0]
    const style = h.shadowNodes[0] as MockEl
    const anchor = h.shadowNodes[1] as MockEl
    assert.match(style.textContent, /justify-content:flex-end/)
    assert.equal(anchor.href, 'https://ui.praison.ai')
    assert.equal(anchor.target, '_blank')
    assert.equal(anchor.rel, 'noopener noreferrer')
    assert.equal(`${String(anchor.parts[0])}${(anchor.parts[1] as MockEl).textContent}`, 'Made with PraisonAI UI')

    host.remove()
    host.hidden = true
    host.style.cssText = 'display:none'
    host.attrs.class = 'hidden'
    assert.equal(parent.children.length, 0)

    h.obs.cb?.()
    assert.equal(parent.children.length, 1)
    assert.equal(host.hidden, false)
    assert.equal(host.style.cssText, '')
    assert.equal(host.getAttribute('class'), null)

    cleanup()
    assert.equal(h.isDisconnected(), true)
    assert.equal(parent.children.length, 0)
  } finally {
    ;(globalThis as unknown as { document: unknown }).document = prevDoc
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = prevMo
  }
})

test('bindSurfaceChrome docks inline inside .aiui-docs-footer-bottom before socials and falls back if footer disappears', () => {
  const h = makeHarness()
  const prevDoc = globalThis.document
  const prevMo = globalThis.MutationObserver
  try {
    const body = h.mk('body')
    const footerRow = h.mk('div')
    const brand = h.mk('span')
    const socials = h.mk('ul')
    footerRow.appendChild(brand)
    footerRow.appendChild(socials)
    footerRow.queries['.aiui-docs-socials'] = socials
    body.queries['.aiui-docs-footer-bottom'] = footerRow

    ;(globalThis as unknown as { document: { body: MockEl; createElement: (t: string) => MockEl } }).document = {
      body,
      createElement: h.mk,
    }
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
      constructor(cb: () => void) {
        h.obs.cb = cb
      }
      observe() {}
      disconnect() {}
    }

    const cleanup = bindSurfaceChrome(body as unknown as HTMLElement)
    const style = h.shadowNodes[0] as MockEl
    assert.match(style.textContent, /display:inline-flex!important/)
    assert.equal(footerRow.children.length, 3)
    assert.equal(footerRow.children[0], brand)
    assert.equal(footerRow.children[2], socials)
    const host = footerRow.children[1]

    // If the docs footer is removed, it falls back cleanly to body bar mode.
    body.queries['.aiui-docs-footer-bottom'] = null
    h.obs.cb?.()
    assert.equal(host.parentNode, body)
    assert.match(style.textContent, /justify-content:flex-end/)

    cleanup()
  } finally {
    ;(globalThis as unknown as { document: unknown }).document = prevDoc
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = prevMo
  }
})
