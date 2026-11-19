// Printing a docs page: "Download as PDF" in the page actions, or the
// browser's own Print. The @media print block in docs.css lays out the
// article alone with every accordion, expandable and tab shown; this drops
// dark mode while the page prints, so paper (and the PDF) is always light.

type PrintWindow = Pick<Window, 'addEventListener' | 'removeEventListener'> & {
    document: { documentElement: { classList: Pick<DOMTokenList, 'add' | 'remove' | 'contains'> } }
}

/** Print light: lift `.dark` from <html> before printing and put it back after. Returns the cleanup. */
export function printLight(win: PrintWindow = window): () => void {
    const root = win.document.documentElement
    let lifted = false
    const before = () => {
        lifted = root.classList.contains('dark')
        if (lifted) root.classList.remove('dark')
    }
    const after = () => {
        if (lifted) root.classList.add('dark')
        lifted = false
    }
    win.addEventListener('beforeprint', before)
    win.addEventListener('afterprint', after)
    return () => {
        win.removeEventListener('beforeprint', before)
        win.removeEventListener('afterprint', after)
        after()
    }
}

/** The page action: print once the menu that asked has closed. */
export const printPage = (win: Pick<Window, 'print' | 'setTimeout'> = window) => void win.setTimeout(() => win.print(), 0)
