/**
 * The `html` block's frame document. App HTML runs in an iframe with
 * `sandbox="allow-scripts"` and no `allow-same-origin`: its scripts get an
 * opaque origin, so they cannot read the app's DOM, cookies or storage, and a
 * Content-Security-Policy <meta> (default: no network) limits what they load.
 *
 * A small script added after the app's HTML reports the content height to the
 * parent (which checks the sender is its own frame) and applies the theme
 * variables the parent sends when light/dark changes.
 */

/** No network: inline styles and scripts, data: and https: images, data: fonts. */
export const DEFAULT_CSP =
  "default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'"

/** The public theme variables (styles/theme.css) copied into the frame. */
export const THEME_VARS = [
  '--aiui-fg',
  '--aiui-muted',
  '--aiui-border',
  '--aiui-bg',
  '--aiui-surface',
  '--aiui-accent',
  '--aiui-success',
  '--aiui-warning',
  '--aiui-danger',
  '--aiui-info',
  '--aiui-font',
  '--aiui-font-mono',
] as const

export type ThemeVars = Record<string, string>
export type Scheme = 'light' | 'dark'

/** Message types between the page and the frame. */
export const MSG_HEIGHT = 'aiui-html:height'
export const MSG_THEME = 'aiui-html:theme'
/** Upper bound for a reported height, so a frame cannot grow the page without limit. */
export const MAX_FRAME_HEIGHT = 20000

/** The live values of THEME_VARS on `el` (empty outside a browser). */
export function readThemeVars(el?: Element | null): ThemeVars {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return {}
  const style = getComputedStyle(el ?? document.documentElement)
  const out: ThemeVars = {}
  for (const name of THEME_VARS) {
    const v = style.getPropertyValue(name).trim()
    if (v) out[name] = v
  }
  return out
}

export function currentScheme(): Scheme {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/** A declaration value cannot close the <style> element or the rule. */
function cssValue(v: string): string {
  return v.replace(/[<>{};]/g, '')
}

function attr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Runs inside the frame. Plain ES5 so it works whatever the app's HTML does.
const FRAME_SCRIPT = `(function(){
var last=-1;
function size(){var b=document.body;if(!b)return;var h=Math.ceil(b.getBoundingClientRect().height);if(h!==last){last=h;parent.postMessage({type:'${MSG_HEIGHT}',height:h},'*');}}
addEventListener('message',function(e){if(e.source!==parent)return;var d=e.data;if(!d||d.type!=='${MSG_THEME}')return;var s=document.documentElement.style;var v=d.vars||{};for(var k in v){if(k.indexOf('--aiui-')===0&&typeof v[k]==='string')s.setProperty(k,v[k]);}s.colorScheme=d.scheme==='dark'?'dark':'light';});
if(window.ResizeObserver){new ResizeObserver(size).observe(document.body);}
addEventListener('load',size);size();
})();`

export interface FrameOptions {
  csp?: string
  vars?: ThemeVars
  scheme?: Scheme
}

/** The full `srcdoc` for app HTML `content`. */
export function buildSrcdoc(content: string, { csp, vars = {}, scheme = 'light' }: FrameOptions = {}): string {
  const policy = (csp ?? '').trim() || DEFAULT_CSP
  const decls = Object.entries(vars)
    .filter(([k]) => k.startsWith('--aiui-'))
    .map(([k, v]) => `${k}:${cssValue(v)}`)
    .join(';')
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${attr(policy)}">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>:root{${decls};color-scheme:${scheme === 'dark' ? 'dark' : 'light'}}` +
    'html,body{margin:0;padding:0;background:transparent}' +
    'body{color:var(--aiui-fg,CanvasText);font-family:var(--aiui-font,system-ui,sans-serif);font-size:14px;line-height:1.5;overflow-wrap:anywhere}' +
    '</style></head><body>' +
    content +
    `<script>${FRAME_SCRIPT}</script></body></html>`
  )
}

/** A height message from the frame, or null when `data` is anything else. */
export function frameHeight(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as { type?: unknown; height?: unknown }
  if (d.type !== MSG_HEIGHT || typeof d.height !== 'number' || !Number.isFinite(d.height)) return null
  return Math.min(MAX_FRAME_HEIGHT, Math.max(0, Math.ceil(d.height)))
}

/** Normalises the `height` prop: a number is pixels; a CSS length passes through. */
export function fixedHeight(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return `${Math.round(v)}px`
  if (typeof v === 'string' && /^\s*\d+(\.\d+)?(px|rem|em|vh|%)?\s*$/.test(v)) {
    const s = v.trim()
    return /\d$/.test(s) ? `${s}px` : s
  }
  return undefined
}
