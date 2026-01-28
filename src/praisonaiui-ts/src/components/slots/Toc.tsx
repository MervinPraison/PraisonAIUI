/**
 * Table of Contents component
 */

import React from "react";

export interface TocProps {
    headings?: Array<{
        id: string;
        text: string;
        level: number;
    }>;
    minLevel?: number;
    maxLevel?: number;
}

export function Toc({ headings = [], minLevel = 2, maxLevel = 4 }: TocProps) {
    const filteredHeadings = headings.filter(
        (h) => h.level >= minLevel && h.level <= maxLevel
    );

    if (filteredHeadings.length === 0) {
        return null;
    }

    return (
        <aside className="aiui-toc">
            <h4 className="aiui-toc-title">On this page</h4>
            <nav className="aiui-toc-nav">
                {filteredHeadings.map((heading) => (
                    <a
                        key={heading.id}
                        href={`#${heading.id}`}
                        className="aiui-toc-link"
                        style={{ paddingLeft: (heading.level - minLevel) * 12 }}
                    >
                        {heading.text}
                    </a>
                ))}
            </nav>
        </aside>
    );
}
