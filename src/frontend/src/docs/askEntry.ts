// Ask AI's entry points the docs App shares (App.tsx, Content.tsx); the panel is the lazy docs/AskAi.tsx.

/** Open Ask AI from anywhere: `window.dispatchEvent(new CustomEvent('aiui:docs-ask', { detail: { question, context } }))`. */
export const ASK_EVENT = 'aiui:docs-ask'

/** Where to ask: a static host's `endpoint`, or `aiui serve`'s own URL when it has a model (else no Ask AI). */
export function askEndpoint(a?: false | null | { url?: string; endpoint?: string; ai?: boolean }): string | undefined {
    return a ? a.endpoint || (a.ai ? a.url : undefined) : undefined
}
