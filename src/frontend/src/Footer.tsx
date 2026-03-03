// Footer component
import type { UIConfig } from './types'

export function Footer({ config }: { config: UIConfig }) {
    // Resolve footer component via template slot ref (e.g., footer_main)
    const footerSlot = config.templates?.docs?.slots?.footer
    const footerRef = footerSlot?.ref
    const footerComponent = footerRef
        ? config.components?.[footerRef]
        : config.components?.footer
    const footer = (footerComponent?.props || footerSlot?.props) as {
        text?: string
        links?: { label: string; href: string }[]
    } | undefined

    return (
        <footer className="border-t border-border/50 py-8 px-6 bg-muted/20">
            <div className="max-w-screen-2xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-gradient-to-br from-primary/60 to-primary flex items-center justify-center">
                        <span className="text-primary-foreground text-[8px] font-bold">AI</span>
                    </div>
                    <span>{footer?.text || `© ${new Date().getFullYear()} PraisonAIUI`}</span>
                </div>
                <nav className="flex items-center gap-6">
                    {footer?.links?.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            className="hover:text-foreground transition-colors"
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>
            </div>
        </footer>
    )
}
