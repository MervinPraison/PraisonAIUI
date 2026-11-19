// "Listen to page" (docs/PageActions.tsx): the browser's own speech synthesis reads
// the article aloud. A lazy chunk, loaded on the first click; it imports nothing.

/** Elements whose text is read, one after the other (code blocks, icons and buttons are skipped). */
const BLOCKS = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,th,td,figcaption'
const SKIP = 'pre,svg,button,script,style,[aria-hidden="true"],.sr-only,[data-print="hide"]'

/** The article's text in reading order: the innermost text blocks, whitespace collapsed. */
export function articleBlocks(root: Element): string[] {
    const copy = root.cloneNode(true) as Element
    copy.querySelectorAll(SKIP).forEach((el) => el.remove())
    const out: string[] = []
    copy.querySelectorAll(BLOCKS).forEach((el) => {
        if (el.querySelector(BLOCKS)) return // its inner blocks are read instead
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
        if (text) out.push(text)
    })
    return out
}

/**
 * The blocks cut into utterances of at most `max` characters, at sentence ends
 * where possible: some engines stop on a long utterance without telling anyone.
 */
export function speechChunks(blocks: string[], max = 220): string[] {
    const out: string[] = []
    for (const block of blocks) {
        let current = ''
        for (const sentence of block.match(/[^.!?;:]+[.!?;:]*\s*|.+$/g) ?? [block]) {
            const parts = sentence.length > max ? sentence.match(new RegExp(`.{1,${max}}(\\s|$)|.{1,${max}}`, 'g')) ?? [sentence] : [sentence]
            for (const part of parts) {
                if (current && current.length + part.length > max) {
                    out.push(current.trim())
                    current = ''
                }
                current += part
            }
        }
        if (current.trim()) out.push(current.trim())
    }
    return out
}

export interface Reader {
    pause(): void
    resume(): void
    stop(): void
}

/** Read the chunks aloud in `lang`; `onEnd` runs once, after the last one or a stop. */
export function readAloud(chunks: string[], onEnd: () => void, lang = document.documentElement.lang): Reader {
    const synth = window.speechSynthesis
    let ended = false
    const end = () => {
        if (!ended) {
            ended = true
            onEnd()
        }
    }
    synth.cancel()
    if (!chunks.length) end()
    chunks.forEach((text, i) => {
        const u = new SpeechSynthesisUtterance(text)
        if (lang) u.lang = lang
        if (i === chunks.length - 1) u.onend = end
        u.onerror = (e) => {
            if (ended || e.error === 'interrupted' || e.error === 'canceled') return
            synth.cancel()
            end()
        }
        synth.speak(u)
    })
    return {
        pause: () => synth.pause(),
        resume: () => synth.resume(),
        stop: () => {
            ended = true // a stop is the caller's own; no onEnd
            synth.cancel()
        },
    }
}
