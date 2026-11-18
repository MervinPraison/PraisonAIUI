// Video embeds a docs page may show (<iframe src> in Markdown, docs/DocsMedia.tsx).
// Only these providers play inside the page, from their privacy-friendly
// players (youtube-nocookie, Vimeo with dnt=1); any other iframe becomes a link.

export interface EmbedTarget {
    /** The player URL, loaded only when the reader presses play. */
    play: string
    provider: 'YouTube' | 'Vimeo' | 'Loom'
}

const ID = /^[\w-]{6,}$/

/** The player for a YouTube, Vimeo or Loom URL (watch, share or embed form); null for anything else. */
export function embedTarget(src?: string): EmbedTarget | null {
    let url: URL
    try {
        url = new URL(src ?? '')
    } catch {
        return null
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '')
    const parts = url.pathname.split('/').filter(Boolean)
    const q = url.searchParams
    if (host === 'youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
        const id = host === 'youtu.be' ? parts[0] : parts[0] === 'watch' ? q.get('v') : ['embed', 'shorts', 'live'].includes(parts[0]) ? parts[1] : null
        if (!id || !ID.test(id)) return null
        const start = Number.parseInt(q.get('start') ?? q.get('t') ?? '', 10)
        const list = q.get('list')
        const extra = (start > 0 ? `&start=${start}` : '') + (list && ID.test(list) ? `&list=${list}` : '')
        return { play: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1${extra}`, provider: 'YouTube' }
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
        const [id, hash] = parts[0] === 'video' ? parts.slice(1) : parts
        if (!/^\d+$/.test(id ?? '')) return null
        const h = q.get('h') ?? (hash && /^\w+$/.test(hash) ? hash : null)
        return { play: `https://player.vimeo.com/video/${id}?autoplay=1&dnt=1${h && /^\w+$/.test(h) ? `&h=${h}` : ''}`, provider: 'Vimeo' }
    }
    if (host === 'loom.com' && ['share', 'embed'].includes(parts[0]) && ID.test(parts[1] ?? '')) {
        return { play: `https://www.loom.com/embed/${parts[1]}?autoplay=1`, provider: 'Loom' }
    }
    return null
}
