/** Post-render class-only fixes for MkDocs-style content. No DOM moves — React owns the tree. */
export function enhanceMkdocsDom(root: HTMLElement): void {
    const articles = new Set<HTMLElement>()
    if (root.matches('article.prose, #main-content article')) {
        articles.add(root)
    }
    root.querySelectorAll<HTMLElement>('article.prose, #main-content article').forEach((el) => articles.add(el))

    for (const article of articles) {
        hideRawDivParagraphs(article)
        enhanceFeatureGrid(article)
    }
}

/** Hide MkDocs artefact paragraphs — never remove nodes React may still own. */
function hideRawDivParagraphs(article: HTMLElement): void {
    for (const p of article.querySelectorAll('p')) {
        const text = p.textContent?.trim() ?? ''
        if (/^<\/?div[\s>]/.test(text) || text === '</div>') {
            p.classList.add('hidden')
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

/** No-op — React article must not receive foreign plugin nodes. */
export function teardownMkdocsEnhancements(_root: HTMLElement): void {}
