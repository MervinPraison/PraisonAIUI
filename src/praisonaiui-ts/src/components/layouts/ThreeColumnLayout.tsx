/**
 * Three Column Layout - header, left sidebar, main, right sidebar, footer
 */

import React from "react";

export interface ThreeColumnLayoutProps {
    header?: React.ReactNode;
    left?: React.ReactNode;
    main?: React.ReactNode;
    right?: React.ReactNode;
    footer?: React.ReactNode;
}

export function ThreeColumnLayout({
    header,
    left,
    main,
    right,
    footer,
}: ThreeColumnLayoutProps) {
    return (
        <div className="aiui-layout aiui-layout-three-column">
            {header && <div className="aiui-layout-header">{header}</div>}

            <div className="aiui-layout-body">
                {left && <div className="aiui-layout-left">{left}</div>}
                <main className="aiui-layout-main">{main}</main>
                {right && <div className="aiui-layout-right">{right}</div>}
            </div>

            {footer && <div className="aiui-layout-footer">{footer}</div>}
        </div>
    );
}
