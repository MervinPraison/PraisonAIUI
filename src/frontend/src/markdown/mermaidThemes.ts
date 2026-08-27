/** Mermaid theme config — aligned with plugins/mermaid.js */

export const MERMAID_DARK_THEME = {
    theme: 'base' as const,
    themeVariables: {
        background: 'transparent',
        mainBkg: '#0d9488',
        primaryColor: '#0d9488',
        primaryBorderColor: '#14b8a6',
        primaryTextColor: '#ffffff',
        secondaryColor: '#6366f1',
        secondaryBorderColor: '#818cf8',
        secondaryTextColor: '#ffffff',
        tertiaryColor: '#e11d48',
        tertiaryBorderColor: '#fb7185',
        tertiaryTextColor: '#ffffff',
        textColor: '#f1f5f9',
        labelTextColor: '#f1f5f9',
        lineColor: '#94a3b8',
        arrowheadColor: '#cbd5e1',
        nodeBorder: '#14b8a6',
        clusterBkg: 'rgba(13, 148, 136, 0.08)',
        clusterBorder: 'rgba(20, 184, 166, 0.4)',
        defaultLinkColor: '#94a3b8',
        edgeLabelBackground: 'rgba(15, 23, 42, 0.85)',
        nodeTextColor: '#ffffff',
        actorBkg: '#0d9488',
        actorBorder: '#14b8a6',
        actorTextColor: '#ffffff',
        actorLineColor: '#64748b',
        signalColor: '#cbd5e1',
        signalTextColor: '#f1f5f9',
        activationBorderColor: '#14b8a6',
        activationBkgColor: 'rgba(13, 148, 136, 0.2)',
        sequenceNumberColor: '#ffffff',
        noteBkgColor: 'rgba(99, 102, 241, 0.2)',
        noteBorderColor: '#818cf8',
        noteTextColor: '#f1f5f9',
        titleColor: '#f8fafc',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        fontSize: '14px',
    },
}

export const MERMAID_LIGHT_THEME = {
    theme: 'base' as const,
    themeVariables: {
        background: 'transparent',
        mainBkg: '#0d9488',
        primaryColor: '#0d9488',
        primaryBorderColor: '#0f766e',
        primaryTextColor: '#ffffff',
        secondaryColor: '#6366f1',
        secondaryBorderColor: '#4f46e5',
        secondaryTextColor: '#ffffff',
        tertiaryColor: '#e11d48',
        tertiaryBorderColor: '#be123c',
        tertiaryTextColor: '#ffffff',
        textColor: '#1e293b',
        labelTextColor: '#334155',
        lineColor: '#94a3b8',
        arrowheadColor: '#64748b',
        nodeBorder: '#0f766e',
        clusterBkg: 'rgba(13, 148, 136, 0.06)',
        clusterBorder: 'rgba(15, 118, 110, 0.3)',
        defaultLinkColor: '#94a3b8',
        edgeLabelBackground: 'rgba(255, 255, 255, 0.9)',
        nodeTextColor: '#ffffff',
        actorBkg: '#0d9488',
        actorBorder: '#0f766e',
        actorTextColor: '#ffffff',
        actorLineColor: '#cbd5e1',
        signalColor: '#64748b',
        signalTextColor: '#1e293b',
        noteBkgColor: 'rgba(99, 102, 241, 0.1)',
        noteBorderColor: '#6366f1',
        noteTextColor: '#1e293b',
        titleColor: '#0f172a',
        fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
        fontSize: '14px',
    },
}

export function isDarkMode(): boolean {
    return document.documentElement.classList.contains('dark')
}

export function getMermaidConfig(dark: boolean) {
    const theme = dark ? MERMAID_DARK_THEME : MERMAID_LIGHT_THEME
    return {
        startOnLoad: false,
        securityLevel: 'strict' as const,
        ...theme,
    }
}
