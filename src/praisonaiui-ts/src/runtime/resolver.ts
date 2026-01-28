/**
 * Template resolver and slot registry
 */

import type { RouteEntry, RouteManifest, SlotRef, TemplateConfig } from "../types";

export interface TemplateMatch {
    template: string;
    layout: string;
    slots: Record<string, SlotRef | null>;
    slotOverrides?: Record<string, SlotRef | null>;
}

/**
 * Resolve a template for a given path.
 */
export function resolveTemplate(
    path: string,
    manifest: RouteManifest,
    templates: Record<string, TemplateConfig>
): TemplateMatch | null {
    // Sort routes by priority (higher first)
    const sortedRoutes = [...manifest.routes].sort((a, b) => b.priority - a.priority);

    for (const route of sortedRoutes) {
        if (matchPattern(path, route.pattern)) {
            const template = templates[route.template];
            if (!template) {
                console.warn(`Template "${route.template}" not found`);
                return null;
            }

            return {
                template: route.template,
                layout: template.layout,
                slots: template.slots,
                slotOverrides: route.slotOverrides,
            };
        }
    }

    return null;
}

/**
 * Match a path against a glob pattern.
 * Supports * (single segment) and ** (multiple segments).
 */
function matchPattern(path: string, pattern: string): boolean {
    // Normalize paths
    const normalizedPath = path.replace(/^\/+|\/+$/g, "");
    const normalizedPattern = pattern.replace(/^\/+|\/+$/g, "");

    // Convert glob pattern to regex
    const regexPattern = normalizedPattern
        .replace(/\*\*/g, "{{GLOB}}")
        .replace(/\*/g, "[^/]+")
        .replace(/\{\{GLOB\}\}/g, ".*");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
}

/**
 * Slot component registry for custom components.
 */
export class SlotRegistry {
    private static components: Map<string, React.ComponentType<any>> = new Map();

    /**
     * Register a custom component for a slot type.
     */
    static register(type: string, component: React.ComponentType<any>): void {
        this.components.set(type, component);
    }

    /**
     * Get a component by type.
     */
    static get(type: string): React.ComponentType<any> | undefined {
        return this.components.get(type);
    }

    /**
     * Check if a component is registered.
     */
    static has(type: string): boolean {
        return this.components.has(type);
    }

    /**
     * Clear all registered components.
     */
    static clear(): void {
        this.components.clear();
    }
}
