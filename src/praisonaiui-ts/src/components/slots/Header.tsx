/**
 * Header component
 */

import React from "react";

export interface HeaderProps {
    logoText?: string;
    logoImage?: string;
    links?: Array<{
        label: string;
        href: string;
        external?: boolean;
    }>;
    cta?: {
        label: string;
        href: string;
    };
}

export function Header({ logoText, logoImage, links = [], cta }: HeaderProps) {
    return (
        <header className="aiui-header">
            <div className="aiui-header-content">
                <div className="aiui-header-logo">
                    {logoImage && <img src={logoImage} alt={logoText || "Logo"} />}
                    {logoText && <span>{logoText}</span>}
                </div>

                <nav className="aiui-header-nav">
                    {links.map((link) => (
                        <a
                            key={link.href}
                            href={link.href}
                            target={link.external ? "_blank" : undefined}
                            rel={link.external ? "noopener noreferrer" : undefined}
                        >
                            {link.label}
                        </a>
                    ))}
                </nav>

                {cta && (
                    <a href={cta.href} className="aiui-header-cta">
                        {cta.label}
                    </a>
                )}
            </div>
        </header>
    );
}
