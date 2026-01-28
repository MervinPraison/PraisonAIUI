/**
 * Footer component
 */

import React from "react";

export interface FooterProps {
    text?: string;
    links?: Array<{
        label: string;
        href: string;
    }>;
}

export function Footer({ text, links = [] }: FooterProps) {
    return (
        <footer className="aiui-footer">
            <div className="aiui-footer-content">
                {text && <span className="aiui-footer-text">{text}</span>}

                {links.length > 0 && (
                    <nav className="aiui-footer-links">
                        {links.map((link) => (
                            <a key={link.href} href={link.href}>
                                {link.label}
                            </a>
                        ))}
                    </nav>
                )}
            </div>
        </footer>
    );
}
