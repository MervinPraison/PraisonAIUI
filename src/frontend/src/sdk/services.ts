/**
 * Shell services of the browser SDK: what a page or feature needs from the
 * app around it, as an explicit contract instead of implicit globals
 * (a patched window.fetch, the history API, CSS variables).
 *
 *   navigate, fetchJson, useManifest, registerCommand, onActivate,
 *   getPageId / usePageId, useThemeMode
 *   (notify lives in ./notify)
 *
 * Dependency direction: the SDK never imports the shell. The shell *provides*
 * its implementations at boot (provideShellHost, activateShell) and *reads*
 * what plugins registered (getCommands). Without a shell (dev harnesses,
 * tests) every service has a working default.
 *
 * Everything reads `window` at call time, never at import.
 */
import { useSyncExternalStore, type ComponentType } from 'react'
import type { ShellManifest } from './manifest'

// ── host (provided by the shell) ─────────────────────────────────────

export interface NavigateOptions {
  /** Replace the current history entry instead of adding one (redirects). */
  replace?: boolean
}

export interface ShellHost {
  /** Go to a page by id. */
  navigate(pageId: string, opts?: NavigateOptions): void
  /** The gateway token to send with same-origin requests, or ''. */
  getToken(): string
  /** The id of the page on screen ('' at `/`), as the shell's router reads the URL. */
  getPageId(): string
  /** Call `cb` on every URL change; returns the unsubscribe function. */
  subscribeLocation(cb: () => void): () => void
}

/** `aiui:locationchange`: the shell's router dispatches it on push/replaceState. */
const LOCATION_CHANGE_EVENT = 'aiui:locationchange'

const defaultHost: ShellHost = {
  navigate(pageId, opts) {
    const path = `/${encodeURIComponent(pageId)}`
    if (window.location.pathname === path) return
    if (opts?.replace) window.history.replaceState({ pageId }, '', path)
    else window.history.pushState({ pageId }, '', path)
  },
  getToken: () => '',
  getPageId() {
    const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0] || ''
    try {
      return decodeURIComponent(seg)
    } catch {
      return seg
    }
  },
  subscribeLocation(cb) {
    window.addEventListener('popstate', cb)
    window.addEventListener(LOCATION_CHANGE_EVENT, cb)
    return () => {
      window.removeEventListener('popstate', cb)
      window.removeEventListener(LOCATION_CHANGE_EVENT, cb)
    }
  },
}

let host: ShellHost = defaultHost

/** Called by the shell at mount, before any plugin module is imported. */
export function provideShellHost(impl: Partial<ShellHost>): void {
  host = { ...host, ...impl }
}

// ── navigate ─────────────────────────────────────────────────────────

/**
 * Go to a page of the app by id (`navigate('logs')` → `/logs`). A no-op when
 * that page is already on screen.
 */
export function navigate(pageId: string, opts: NavigateOptions = {}): void {
  if (typeof pageId !== 'string' || !pageId) {
    throw new TypeError(`[aiui sdk] navigate: expected a non-empty page id, got ${String(pageId)}`)
  }
  host.navigate(pageId, opts)
}

// ── current page + colour mode ───────────────────────────────────────

/**
 * The id of the page on screen ('' at `/`), read the way the shell's router
 * reads it, so a plugin never parses the URL itself.
 */
export function getPageId(): string {
  return host.getPageId()
}

function subscribePageId(cb: () => void): () => void {
  return host.subscribeLocation(cb)
}

const noPageId = () => ''

/** React hook: the current page id; re-renders when the user moves to another page. */
export function usePageId(): string {
  return useSyncExternalStore(subscribePageId, getPageId, noPageId)
}

export type ThemeMode = 'light' | 'dark'

/** The colour mode in effect: the `dark` class on <html> (next-themes and the legacy path set it). */
export function getThemeMode(): ThemeMode {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribeThemeMode(cb: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const observer = new MutationObserver(cb)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

const lightMode = (): ThemeMode => 'light'

/** React hook: 'light' or 'dark', updated when the viewer (or the OS, in system mode) switches. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribeThemeMode, getThemeMode, lightMode)
}

// ── fetchJson ────────────────────────────────────────────────────────

export interface FetchJsonOptions extends Omit<RequestInit, 'body'> {
  /**
   * Request body. A plain object or array is sent as JSON (and the method
   * defaults to POST); strings, FormData, Blob, URLSearchParams and buffers
   * are sent as they are.
   */
  body?: unknown
}

/** Rejection of fetchJson(): a non-2xx response, or a body that is not JSON. */
export class FetchJsonError extends Error {
  /** HTTP status (0 when the response never arrived as JSON). */
  status: number
  url: string
  /** The parsed error body when the server sent JSON, else its text. */
  body: unknown

  constructor(message: string, status: number, url: string, body: unknown) {
    super(message)
    this.name = 'FetchJsonError'
    this.status = status
    this.url = url
    this.body = body
  }
}

function isSameOrigin(url: string): boolean {
  try {
    return new URL(url, window.location.href).origin === window.location.origin
  } catch {
    return true // relative or opaque URLs are same-origin
  }
}

function isRawBody(body: unknown): body is BodyInit {
  if (typeof body === 'string') return true
  if (typeof body !== 'object' || body === null) return false
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) return true
  const g = globalThis as Record<string, unknown>
  return ['FormData', 'Blob', 'URLSearchParams', 'ReadableStream'].some((name) => {
    const ctor = g[name]
    return typeof ctor === 'function' && body instanceof (ctor as new () => object)
  })
}

function errorMessage(body: unknown, status: number, url: string): string {
  if (typeof body === 'object' && body !== null) {
    for (const key of ['error', 'detail', 'message']) {
      const v = (body as Record<string, unknown>)[key]
      if (typeof v === 'string' && v) return v
    }
  }
  return `Request to ${url} failed (${status})`
}

/**
 * fetch() for the app's JSON APIs.
 *
 *  - Same-origin requests carry the session's gateway token
 *    (`Authorization: Bearer …`) and cookies; cross-origin requests never get
 *    the token.
 *  - A plain-object `body` is JSON-encoded; the response is JSON-decoded.
 *  - A non-2xx response rejects with an Error that has `status`, `url` and
 *    the decoded `body`; its message is the server's `error`/`detail` text
 *    when there is one.
 *  - An empty response (204, or no body) resolves to `undefined`.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  if (typeof url !== 'string' || !url) {
    throw new TypeError(`[aiui sdk] fetchJson: expected a URL string, got ${String(url)}`)
  }
  const { body, headers: rawHeaders, ...rest } = opts
  const headers = new Headers(rawHeaders)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  const init: RequestInit = { ...rest, headers }
  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      init.body = body
    } else {
      init.body = JSON.stringify(body)
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    }
    if (!init.method) init.method = 'POST'
  }
  if (isSameOrigin(url)) {
    const token = host.getToken()
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    if (!init.credentials) init.credentials = 'same-origin'
  }

  const res = await window.fetch(url, init)
  const text = res.status === 204 || res.status === 205 ? '' : await res.text()
  let data: unknown = undefined
  let parsed = text === ''
  if (!parsed) {
    try {
      data = JSON.parse(text)
      parsed = true
    } catch {
      data = text
    }
  }
  if (!res.ok) throw new FetchJsonError(errorMessage(data, res.status, url), res.status, url, data)
  if (!parsed) throw new FetchJsonError(`Response from ${url} is not JSON`, res.status, url, data)
  return data as T
}

// ── manifest + activation ────────────────────────────────────────────

export interface ActivateContext {
  /** The shell manifest: pages, plugins, site and layout settings. */
  readonly manifest: ShellManifest
}

export type ActivateHook = (ctx: ActivateContext) => void

let manifest: ShellManifest | null = null
let activated = false
const pendingHooks: ActivateHook[] = []
const manifestListeners = new Set<() => void>()

function runHook(fn: ActivateHook, ctx: ActivateContext) {
  try {
    fn(ctx)
  } catch (err) {
    console.error('[aiui sdk] an onActivate hook failed', err)
  }
}

/**
 * Run `fn` once the app is ready: the manifest is known and nothing has
 * rendered yet (or right now, when the app is already running, which is the
 * usual case for a plugin module). Use it for work that depends on what this
 * server exposes: register a page only when it is listed, start a listener,
 * add a command. Returns a function that cancels a hook that has not run.
 *
 * Hooks run in registration order; one that throws is logged and does not
 * stop the others.
 */
export function onActivate(fn: ActivateHook): () => void {
  if (typeof fn !== 'function') throw new TypeError('[aiui sdk] onActivate: expected a function')
  if (activated && manifest) {
    runHook(fn, { manifest })
    return () => {}
  }
  pendingHooks.push(fn)
  return () => {
    const i = pendingHooks.indexOf(fn)
    if (i >= 0) pendingHooks.splice(i, 1)
  }
}

/**
 * Called by the shell when it has the manifest, before it renders. Publishes
 * the manifest to useManifest() and runs the queued onActivate hooks (first
 * call only). Calling it again with the same manifest is a no-op.
 */
export function activateShell(next: ShellManifest): void {
  if (manifest !== next) {
    manifest = next
    for (const fn of [...manifestListeners]) fn()
  }
  if (activated) return
  activated = true
  const ctx: ActivateContext = { manifest: next }
  // A hook may register further hooks: those run immediately (activated is set).
  for (const fn of pendingHooks.splice(0)) runHook(fn, ctx)
}

/** The manifest the shell booted with, or null before the shell is ready. */
export function getManifest(): ShellManifest | null {
  return manifest
}

function subscribeManifest(fn: () => void) {
  manifestListeners.add(fn)
  return () => {
    manifestListeners.delete(fn)
  }
}

/**
 * React hook: the shell manifest (pages, plugins, `site`, `layout`). It is
 * null only outside a running shell (a test, a dev harness).
 */
export function useManifest(): ShellManifest | null {
  return useSyncExternalStore(subscribeManifest, getManifest, getManifest)
}

// ── commands ─────────────────────────────────────────────────────────

export interface ShellCommand {
  /** Unique id, by convention `<plugin>.<action>` (e.g. `hello.greet`). */
  id: string
  /** Label shown in the command palette. */
  title: string
  /** Runs when the command is chosen. A rejection or throw is reported as a toast. */
  run: () => void | Promise<void>
  /** Palette section heading. Defaults to "Commands". */
  group?: string
  /** Extra search terms. */
  keywords?: readonly string[]
  /** Icon component (receives `className`). */
  icon?: ComponentType<{ className?: string }>
}

const commands = new Map<string, ShellCommand>()
const commandListeners = new Set<() => void>()
let commandsSnapshot: readonly ShellCommand[] = Object.freeze([])

function emitCommands() {
  commandsSnapshot = Object.freeze([...commands.values()])
  for (const fn of [...commandListeners]) {
    try {
      fn()
    } catch (err) {
      console.error('[aiui sdk] command listener failed', err)
    }
  }
}

/**
 * Add an entry to the command palette (Ctrl/Cmd+K). Registering an id again
 * replaces the earlier command. Returns a function that removes it.
 */
export function registerCommand(command: ShellCommand): () => void {
  if (typeof command !== 'object' || command === null) {
    throw new TypeError('[aiui sdk] registerCommand: expected a command object')
  }
  const { id, title, run } = command
  if (typeof id !== 'string' || !id) {
    throw new TypeError(`[aiui sdk] registerCommand: expected a non-empty string id, got ${String(id)}`)
  }
  if (typeof title !== 'string' || !title) {
    throw new TypeError(`[aiui sdk] registerCommand('${id}'): expected a non-empty title`)
  }
  if (typeof run !== 'function') {
    throw new TypeError(`[aiui sdk] registerCommand('${id}'): expected a run function`)
  }
  if (commands.has(id)) console.warn(`[aiui sdk] registerCommand('${id}') replaces an earlier registration`)
  const entry: ShellCommand = Object.freeze({ ...command })
  commands.set(id, entry)
  emitCommands()
  return () => {
    if (commands.get(id) !== entry) return
    commands.delete(id)
    emitCommands()
  }
}

/** Registered commands in registration order. The array identity changes only on a change. */
export function getCommands(): readonly ShellCommand[] {
  return commandsSnapshot
}

function subscribeCommands(fn: () => void) {
  commandListeners.add(fn)
  return () => {
    commandListeners.delete(fn)
  }
}

/** React hook for hosts (the command palette): the registered commands. */
export function useCommands(): readonly ShellCommand[] {
  return useSyncExternalStore(subscribeCommands, getCommands, getCommands)
}

/** Test hook: back to "no shell". */
export function resetServicesForTests(): void {
  host = defaultHost
  manifest = null
  activated = false
  pendingHooks.length = 0
  commands.clear()
  commandsSnapshot = Object.freeze([])
}
