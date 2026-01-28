/**
 * Doc content component - renders markdown content
 */

import React from "react";

export interface DocContentProps {
    html?: string;
    children?: React.ReactNode;
}

export function DocContent({ html, children }: DocContentProps) {
    if (html) {
        return (
            <article
                className="aiui-doc-content"
                dangerouslySetInnerHTML={{ __html: html }}
            />
        );
    }

    return <article className="aiui-doc-content">{children}</article>;
}
