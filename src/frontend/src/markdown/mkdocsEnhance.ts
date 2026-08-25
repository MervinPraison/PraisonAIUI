import { isMkdocsTabHeading, mkdocsTabTitle } from './mkdocsPreprocess'

/** Post-render DOM fixes for MkDocs-style content (tabs, feature cards). */
export function enhanceMkdocsDom(root: HTMLElement): void {
    const articles = new Set<HTMLElement>()
    if (root.matches('article.prose, main .prose, .prose, main.flex-1, #main-content')) {
        articles.add(root)
    }
    root.querySelectorAll<HTMLElement>('article.prose, main .prose, .prose').forEach((el) => articles.add(el))

    for (const article of articles) {
        removeRawDivParagraphs(article)
        enhanceFeatureGrid(article)
        enhanceTabs(article)
    }
}

function removeRawDivParagraphs(article: HTMLElement): void {
    for (const p of article.querySelectorAll('p')) {
        const text = p.textContent?.trim() ?? ''
        if (/^<\/?div[\s>]/.test(text) || text === '</div>') {
            p.remove()
        }
    }
}

function enhanceFeatureGrid(article: HTMLElement): void {
    for (const ul of article.querySelectorAll('ul')) {
        if (ul.classList.contains('aiui-feature-grid')) continue

        const firstLi = ul.querySelector('li')
        const looksLikeCards = Boolean(
            firstLi?.textContent?.includes('YAML-Driven')
            || firstLi?.textContent?.includes('Component Slots')
            || firstLi?.querySelector('strong'),
        )
        if (!looksLikeCards) continue

        ul.classList.add(
            'aiui-feature-grid',
            'grid',
            'grid-cols-1',
            'md:grid-cols-2',
            'gap-4',
            'my-6',
            'list-none',
            'pl-0',
        )

        for (const li of ul.querySelectorAll('li')) {
            li.classList.add('border', 'border-border', 'rounded-lg', 'p-4', 'bg-card')
        }
    }
}

interface TabSection {
    heading: HTMLHeadingElement
    title: string
    nodes: Node[]
}

function enhanceTabs(article: HTMLElement): void {
    if (article.querySelector('[data-aiui-tabs]')) return

    const tabHeadings = Array.from(article.querySelectorAll<HTMLHeadingElement>('h3')).filter((h3) =>
        isMkdocsTabHeading(h3.textContent?.trim() ?? ''),
    )
    if (tabHeadings.length < 2) return

    const sections: TabSection[] = tabHeadings.map((heading) => {
        const title = mkdocsTabTitle(heading.textContent?.trim() ?? '')
        const nodes: Node[] = []
        let sibling = heading.nextSibling

        while (sibling) {
            if (sibling.nodeType === Node.ELEMENT_NODE) {
                const el = sibling as HTMLElement
                if (el.tagName === 'H3' && isMkdocsTabHeading(el.textContent?.trim() ?? '')) break
                if (['H1', 'H2'].includes(el.tagName)) break
            }
            const next = sibling.nextSibling
            nodes.push(sibling)
            sibling = next
        }

        return { heading, title, nodes }
    })

    const wrapper = document.createElement('div')
    wrapper.className = 'aiui-tabs my-6 border border-border rounded-lg overflow-hidden'
    wrapper.dataset.aiuiTabs = 'true'

    const buttons = document.createElement('div')
    buttons.className = 'aiui-tab-buttons flex flex-wrap gap-0 border-b border-border bg-muted/30'
    wrapper.appendChild(buttons)

    const panels = document.createElement('div')
    panels.className = 'aiui-tab-panels'
    wrapper.appendChild(panels)

    sections.forEach((section, index) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = [
            'aiui-tab-button px-4 py-2 text-sm font-medium transition-colors',
            index === 0
                ? 'bg-background text-foreground border-b-2 border-primary'
                : 'text-muted-foreground hover:text-foreground',
        ].join(' ')
        btn.textContent = section.title
        btn.dataset.tabIndex = String(index)
        buttons.appendChild(btn)

        const panel = document.createElement('div')
        panel.className = index === 0 ? 'aiui-tab-panel p-4 block' : 'aiui-tab-panel p-4 hidden'
        panel.dataset.tabPanel = String(index)
        for (const node of section.nodes) {
            panel.appendChild(node)
        }
        panels.appendChild(panel)
    })

    const insertPoint = sections[0].heading
    article.insertBefore(wrapper, insertPoint)

    for (const section of sections) {
        section.heading.remove()
    }

    buttons.addEventListener('click', (event) => {
        const target = (event.target as HTMLElement).closest<HTMLButtonElement>('.aiui-tab-button')
        if (!target) return
        const index = target.dataset.tabIndex ?? '0'

        for (const btn of buttons.querySelectorAll<HTMLButtonElement>('.aiui-tab-button')) {
            const active = btn.dataset.tabIndex === index
            btn.classList.toggle('bg-background', active)
            btn.classList.toggle('text-foreground', active)
            btn.classList.toggle('border-b-2', active)
            btn.classList.toggle('border-primary', active)
            btn.classList.toggle('text-muted-foreground', !active)
        }

        for (const panel of panels.querySelectorAll<HTMLElement>('.aiui-tab-panel')) {
            panel.classList.toggle('hidden', panel.dataset.tabPanel !== index)
            panel.classList.toggle('block', panel.dataset.tabPanel === index)
        }
    })
}
