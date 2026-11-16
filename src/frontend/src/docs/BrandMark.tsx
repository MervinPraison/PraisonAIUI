/** The docs brand tile: the configured logo, or the site name's initial on the accent (as the Pro shell's brand tile). */
export function BrandMark({ name, src, size }: { name: string; src?: string | null; size?: 'sm' }) {
    if (src) {
        return <img src={src} alt="" className="aiui-docs-mark" data-size={size} />
    }
    const initial = name.trim().charAt(0) || 'A'
    return (
        <span className="aiui-docs-mark" data-size={size} aria-hidden="true">
            {initial}
        </span>
    )
}
