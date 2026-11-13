/**
 * Post-render class-only fixes for MkDocs-style content. No DOM moves: React
 * owns the tree. (Feature-card lists are rendered by the docs `ul` component,
 * see docsComponents.tsx, so they survive re-renders.)
 */
export function enhanceMkdocsDom(root: HTMLElement): void {
    const articles = new Set<HTMLElement>()
    if (root.matches('article.aiui-doc, article.prose, #main-content article')) {
        articles.add(root)
    }
    root.querySelectorAll<HTMLElement>('article.aiui-doc, article.prose, #main-content article').forEach((el) => articles.add(el))

    for (const article of articles) {
        hideRawDivParagraphs(article)
    }
}

/** Hide MkDocs artefact paragraphs; never remove nodes React may still own. */
function hideRawDivParagraphs(article: HTMLElement): void {
    for (const p of article.querySelectorAll('p')) {
        const text = p.textContent?.trim() ?? ''
        if (/^<\/?div[\s>]/.test(text) || text === '</div>') {
            p.classList.add('hidden')
        }
    }
}
