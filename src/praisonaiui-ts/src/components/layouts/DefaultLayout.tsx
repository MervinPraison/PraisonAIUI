/**
 * Default Layout - header, main, footer
 */

import React from "react";

export interface DefaultLayoutProps {
    header?: React.ReactNode;
    hero?: React.ReactNode;
    main?: React.ReactNode;
    footer?: React.ReactNode;
}

export function DefaultLayout({
    header,
    hero,
    main,
    footer,
}: DefaultLayoutProps) {
    return (
        <div className="aiui-layout aiui-layout-default">
            {header && <div className="aiui-layout-header">{header}</div>}
            {hero && <div className="aiui-layout-hero">{hero}</div>}
            <main className="aiui-layout-main">{main}</main>
            {footer && <div className="aiui-layout-footer">{footer}</div>}
        </div>
    );
}
