/**
 * Docs sidebar component
 */

import React from "react";
import type { NavItem } from "../../types";

export interface DocsSidebarProps {
    items?: NavItem[];
    source?: string;
    showSearch?: boolean;
    collapsible?: boolean;
}

export function DocsSidebar({
    items = [],
    showSearch = false,
    collapsible = true,
}: DocsSidebarProps) {
    return (
        <aside className="aiui-sidebar">
            {showSearch && (
                <div className="aiui-sidebar-search">
                    <input type="search" placeholder="Search..." />
                </div>
            )}

            <nav className="aiui-sidebar-nav">
                {items.map((item) => (
                    <NavItemComponent key={item.path} item={item} collapsible={collapsible} />
                ))}
            </nav>
        </aside>
    );
}

interface NavItemComponentProps {
    item: NavItem;
    collapsible: boolean;
    depth?: number;
}

function NavItemComponent({ item, collapsible, depth = 0 }: NavItemComponentProps) {
    const [isOpen, setIsOpen] = React.useState(true);
    const hasChildren = item.children && item.children.length > 0;

    return (
        <div className="aiui-nav-item" style={{ paddingLeft: depth * 12 }}>
            <div className="aiui-nav-item-header">
                <a href={item.path}>{item.title}</a>
                {hasChildren && collapsible && (
                    <button onClick={() => setIsOpen(!isOpen)} className="aiui-nav-toggle">
                        {isOpen ? "−" : "+"}
                    </button>
                )}
            </div>

            {hasChildren && isOpen && (
                <div className="aiui-nav-children">
                    {item.children!.map((child) => (
                        <NavItemComponent
                            key={child.path}
                            item={child}
                            collapsible={collapsible}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
