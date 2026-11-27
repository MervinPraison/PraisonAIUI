import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindSurfaceChrome } from './viewportGuard'

test('bindSurfaceChrome mounts closed shadow root with decoded link and heals tampering', () => {
  assert.doesNotThrow(() => bindSurfaceChrome(null)())

  const shadowNodes: unknown[] = []
  let shadowMode = ''
  const obs: { cb: (() => void) | null } = { cb: null }
  let disconnected = false

  type MockEl = {
    tag: string
    parentNode: MockEl | null
    children: MockEl[]
    hidden: boolean
    style: { cssText: string }
    attrs: Record<string, string>
    href?: string
    target?: string
    rel?: string
    textContent: string
    parts: unknown[]
    appendChild(child: MockEl): MockEl
    append(...items: unknown[]): void
    remove(): void
    getAttribute(k: string): string | null
    removeAttribute(k: string): void
    attachShadow(opts: { mode: string }): { append(...items: unknown[]): void }
  }

  const mk = (tag: string): MockEl => {
    const el: MockEl = {
      tag,
      parentNode: null,
      children: [],
      hidden: false,
      style: { cssText: '' },
      attrs: {},
      textContent: '',
      parts: [],
      appendChild(child) {
        child.parentNode = el
        el.children.push(child)
        return child
      },
      append(...items) {
        el.parts.push(...items)
      },
      remove() {
        if (el.parentNode) {
          el.parentNode.children = el.parentNode.children.filter((c) => c !== el)
          el.parentNode = null
        }
      },
      getAttribute(k) {
        return el.attrs[k] ?? null
      },
      removeAttribute(k) {
        delete el.attrs[k]
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

  const prevDoc = globalThis.document
  const prevMo = globalThis.MutationObserver
  try {
    ;(globalThis as unknown as { document: { createElement: (t: string) => MockEl } }).document = {
      createElement: mk,
    }
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
      constructor(cb: () => void) {
        obs.cb = cb
      }
      observe() {}
      disconnect() {
        disconnected = true
      }
    }

    const parent = mk('div')
    const cleanup = bindSurfaceChrome(parent as unknown as HTMLElement)

    assert.equal(shadowMode, 'closed')
    assert.equal(parent.children.length, 1)
    const host = parent.children[0]
    const anchor = shadowNodes[1] as MockEl
    assert.equal(anchor.href, 'https://ui.praison.ai')
    assert.equal(anchor.target, '_blank')
    assert.equal(anchor.rel, 'noopener noreferrer')
    const renderedText = `${String(anchor.parts[0])}${(anchor.parts[1] as MockEl).textContent}`
    assert.equal(renderedText, 'Made with PraisonAI UI')

    host.remove()
    host.hidden = true
    host.style.cssText = 'display:none'
    host.attrs.class = 'hidden'
    assert.equal(parent.children.length, 0)

    obs.cb?.()
    assert.equal(parent.children.length, 1)
    assert.equal(host.hidden, false)
    assert.equal(host.style.cssText, '')
    assert.equal(host.getAttribute('class'), null)

    cleanup()
    assert.equal(disconnected, true)
    assert.equal(parent.children.length, 0)
  } finally {
    ;(globalThis as unknown as { document: unknown }).document = prevDoc
    ;(globalThis as unknown as { MutationObserver: unknown }).MutationObserver = prevMo
  }
})
