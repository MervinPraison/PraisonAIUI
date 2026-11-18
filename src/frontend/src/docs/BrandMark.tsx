/** The docs brand tile: the configured logo (with `darkSrc`, one per mode, swapped by CSS), or the site name's initial on the accent (as the Pro shell's brand tile). */
export function BrandMark({ name, src, darkSrc, size }: { name: string; src?: string | null; darkSrc?: string | null; size?: 'sm' }) {
    if (src && darkSrc) {
        return (
            <>
                <img src={src} alt="" className="aiui-docs-mark" data-size={size} data-mode="light" />
                <img src={darkSrc} alt="" className="aiui-docs-mark" data-size={size} data-mode="dark" />
            </>
        )
    }
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
