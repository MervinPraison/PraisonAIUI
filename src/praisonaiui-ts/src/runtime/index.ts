/**
 * Runtime module - template resolution and slot registry
 */

import type { RouteManifest, TemplateConfig, UIConfig } from "../types";

export interface AIUIConfig {
    configPath: string;
}

export interface AIUIInstance {
    config: UIConfig | null;
    nav: import("../types").NavTree | null;
    routes: RouteManifest | null;
    load: () => Promise<void>;
}

/**
 * Create an AIUI runtime instance.
 */
export function createAIUI(options: AIUIConfig): AIUIInstance {
    const instance: AIUIInstance = {
        config: null,
        nav: null,
        routes: null,

        async load() {
            // Load manifests from the config path
            const basePath = options.configPath;

            try {
                const [uiConfig, navTree, routeManifest] = await Promise.all([
                    loadJSON<UIConfig>(`${basePath}/ui-config.json`),
                    loadJSON<import("../types").NavTree>(`${basePath}/docs-nav.json`),
                    loadJSON<RouteManifest>(`${basePath}/route-manifest.json`),
                ]);

                instance.config = uiConfig;
                instance.nav = navTree;
                instance.routes = routeManifest;
            } catch (error) {
                console.error("Failed to load AIUI manifests:", error);
                throw error;
            }
        },
    };

    return instance;
}

/**
 * Load and parse a JSON file.
 */
async function loadJSON<T>(path: string): Promise<T> {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`Failed to load ${path}: ${response.statusText}`);
    }
    return response.json();
}

export { resolveTemplate, SlotRegistry, type TemplateMatch } from "./resolver";
