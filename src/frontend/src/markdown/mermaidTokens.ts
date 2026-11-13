/**
 * Mermaid theme derived from the live CSS tokens (shadcn vars), so diagrams
 * follow whatever theme.css / preset is active, in light and dark.
 *
 * Mermaid's colour parser (khroma) cannot read `var()`, `oklch()` or
 * `color-mix()`, so every token is resolved to rgb() through a probe element
 * and a 1×1 canvas.
 *
 * Tokens are full colours (`--background: color-mix(...)`, theme.css). A
 * bare HSL triple (`--background: 0 0% 100%`, the pre-theme.css format still
 * emitted by older themes and custom CSS) is wrapped in hsl() first.
 */
let ctx: CanvasRenderingContext2D | null = null

const HSL_TRIPLE = /^-?\d*\.?\d+(deg|rad|turn)?\s+-?\d*\.?\d+%\s+-?\d*\.?\d+%(\s*\/\s*\d*\.?\d+%?)?$/

/**
 * Resolve any CSS colour expression to `rgb()`/`rgba()`. With `over` (an
 * already resolved opaque colour), translucent tokens such as the alpha
 * fill tiers are composited onto it, so mermaid gets an opaque colour it can
 * derive contrast from.
 */
export function resolveCssColor(cssExpr: string, fallback = '#888888', over?: string): string {
    if (typeof document === 'undefined' || !document.body) return fallback
    const probe = document.createElement('span')
    probe.style.display = 'none'
    probe.style.color = cssExpr
    if (!probe.style.color) return fallback // the browser rejected the expression
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    if (!computed) return fallback
    ctx ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
    if (!ctx) return computed
    ctx.clearRect(0, 0, 1, 1)
    if (over) {
        ctx.fillStyle = over
        ctx.fillRect(0, 0, 1, 1)
    }
    ctx.fillStyle = '#000'
    ctx.fillStyle = computed // canvas normalises any CSS colour (oklch, color(), color-mix result)
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`
}

/** The CSS expression for a shadcn token: `var(--x)`, or `hsl(var(--x))` for a legacy triple. */
export function tokenExpression(name: string): string | null {
    if (typeof document === 'undefined') return null
    const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
    if (!raw) return null
    return HSL_TRIPLE.test(raw) ? `hsl(var(--${name}))` : `var(--${name})`
}

function tok(name: string, fallback: string, over?: string): string {
    const expr = tokenExpression(name)
    return expr ? resolveCssColor(expr, fallback, over) : fallback
}

/** Values the mermaid config depends on; a change means diagrams must re-render. */
export const MERMAID_TOKENS = [
    'background', 'foreground', 'muted', 'muted-foreground', 'border', 'primary',
    'primary-foreground', 'secondary', 'accent', 'card',
] as const

export function mermaidConfigFromTokens(dark: boolean) {
    // Fallbacks only apply when no theme defines the token at all.
    const [paper, ink, grey] = dark ? ['#0c0c0e', '#f4f4f5', '#71717a'] : ['#ffffff', '#18181b', '#a1a1aa']
    const bg = tok('background', paper, paper)
    const fg = tok('foreground', ink, bg)
    const muted = tok('muted', bg, bg)
    const mutedFg = tok('muted-foreground', grey, bg)
    const border = tok('border', grey, bg)
    const primary = tok('primary', fg, bg)
    const primaryFg = tok('primary-foreground', bg, primary)
    const secondary = tok('secondary', muted, bg)
    const accent = tok('accent', muted, bg)
    const card = tok('card', bg, bg)
    return {
        theme: 'base',
        darkMode: dark,
        fontFamily: 'inherit',
        themeVariables: {
            darkMode: dark,
            background: bg,
            fontFamily: 'inherit',
            primaryColor: muted,
            primaryTextColor: fg,
            primaryBorderColor: primary,
            secondaryColor: secondary,
            secondaryTextColor: fg,
            secondaryBorderColor: border,
            tertiaryColor: accent,
            tertiaryTextColor: fg,
            tertiaryBorderColor: border,
            mainBkg: muted,
            nodeBorder: primary,
            nodeTextColor: fg,
            textColor: fg,
            titleColor: fg,
            lineColor: mutedFg,
            defaultLinkColor: mutedFg,
            edgeLabelBackground: card,
            clusterBkg: card,
            clusterBorder: border,
            actorBkg: muted,
            actorBorder: primary,
            actorTextColor: fg,
            actorLineColor: mutedFg,
            signalColor: fg,
            signalTextColor: fg,
            noteBkgColor: accent,
            noteTextColor: fg,
            noteBorderColor: border,
            activationBkgColor: muted,
            activationBorderColor: primary,
            sequenceNumberColor: primaryFg,
        },
        flowchart: { htmlLabels: true, curve: 'basis' },
        sequence: { wrap: true },
    }
}
