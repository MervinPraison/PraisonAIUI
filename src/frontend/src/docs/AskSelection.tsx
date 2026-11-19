// "Ask about this": select a passage in a docs article and a chip under the
// selection opens Ask AI (docs/AskAi.tsx) with the passage quoted. App.tsx
// mounts it only when the site has Ask AI. Small on purpose: it ships with
// the docs App, the panel is a lazy chunk.
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

const MIN = 3, MAX = 4000

/** The selected text and where to draw the chip, when the selection is inside a docs article. */
function selectedPassage(): { text: string; top: number; left: number } | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const text = sel.toString().trim()
    const node = sel.getRangeAt(0).commonAncestorContainer
    const el = node instanceof Element ? node : node.parentElement
    if (text.length < MIN || !el?.closest('#main-content article.aiui-doc')) return null
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    return { text: text.slice(0, MAX), top: rect.bottom + 8, left: Math.min(Math.max(8, rect.left), window.innerWidth - 160) }
}

export function AskSelection({ onAsk }: { onAsk: (context: string) => void }) {
    const [chip, setChip] = useState<ReturnType<typeof selectedPassage>>(null)
    useEffect(() => {
        let timer = 0
        const check = () => {
            window.clearTimeout(timer)
            timer = window.setTimeout(() => setChip(selectedPassage()), 150)
        }
        const hide = () => setChip(null)
        document.addEventListener('selectionchange', check)
        window.addEventListener('scroll', hide, { passive: true })
        return () => {
            window.clearTimeout(timer)
            document.removeEventListener('selectionchange', check)
            window.removeEventListener('scroll', hide)
        }
    }, [])
    if (!chip) return null
    return (
        <button type="button" className="aiui-docs-ask-chip" style={{ top: chip.top, left: chip.left }}
            // Keep the selection while the button takes the click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
                onAsk(chip.text)
                setChip(null)
            }}>
            <Sparkles aria-hidden="true" />
            Ask about this
        </button>
    )
}
