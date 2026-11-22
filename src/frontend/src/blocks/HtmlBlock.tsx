/**
 * The `html` block (and `html_embed`, its older name): app HTML and SVG.
 *
 * Default: a sandboxed iframe (htmlFrame.ts). Scripts run, but in an opaque
 * origin with no network, so they cannot reach the app, its cookies or its
 * API. The frame sizes itself to its content and follows light/dark.
 *
 * `trusted: true`: inline in the page through the sanitised Markdown
 * pipeline (rehype-sanitize). No scripts, event handlers, `style` or SVG
 * survive; use it for simple markup that should flow with the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Markdown } from '@/markdown/LazyMarkdown'
import type { BlockNode } from '@/sdk/registry'
import { str } from './normalize'
import { buildSrcdoc, currentScheme, fixedHeight, frameHeight, MSG_THEME, readThemeVars } from './htmlFrame'

type Props = { node: BlockNode }

function HtmlFrame({ content, csp, height, title }: { content: string; csp: string; height?: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [auto, setAuto] = useState<number | null>(null)
  // The first frame carries the theme in its <style>; later flips are posted
  // to it, so a theme change never reloads the app's HTML.
  const srcDoc = useMemo(
    () => buildSrcdoc(content, { csp, vars: readThemeVars(), scheme: currentScheme() }),
    [content, csp],
  )

  useEffect(() => {
    if (height) return
    const onMessage = (e: MessageEvent) => {
      // Only this frame's own window may size it.
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const h = frameHeight(e.data)
      if (h !== null) setAuto(h)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [height])

  // The frame's origin is opaque, so '*' is the only target that reaches it;
  // the message holds nothing but public theme colours.
  const postTheme = () =>
    ref.current?.contentWindow?.postMessage({ type: MSG_THEME, vars: readThemeVars(ref.current), scheme: currentScheme() }, '*')
  // Light/dark and theme presets change <html> class, style or data-theme.
  useEffect(() => {
    const obs = new MutationObserver(() => postTheme())
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- postTheme reads the ref
  }, [])

  return (
    <iframe
      ref={ref}
      title={title}
      sandbox="allow-scripts"
      srcDoc={srcDoc}
      referrerPolicy="no-referrer"
      loading="lazy"
      data-aiui-html="frame"
      onLoad={postTheme}
      className="block w-full min-w-0 border-0 bg-transparent"
      style={{ height: height ?? (auto !== null ? `${auto}px` : '2rem') }}
    />
  )
}

export function HtmlBlock({ node }: Props) {
  const p = node.props ?? {}
  const content = str(p.content ?? p.html, typeof node.children === 'string' ? node.children : '')
  if (p.trusted === true) {
    return (
      <div data-aiui-html="inline" className="min-w-0">
        <Markdown variant="docs" className="min-w-0 text-sm">{content}</Markdown>
      </div>
    )
  }
  return <HtmlFrame content={content} csp={str(p.csp)} height={fixedHeight(p.height)} title={str(p.title, 'Embedded content')} />
}
