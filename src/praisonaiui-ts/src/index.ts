/**
 * PraisonAIUI - YAML-driven website generator
 * TypeScript runtime and Next.js adapter
 */

export { createAIUI, type AIUIInstance, type AIUIConfig } from "./runtime";
export {
    resolveTemplate,
    SlotRegistry,
    type TemplateMatch,
} from "./runtime/resolver";
export type { Config, UIConfig, NavTree, RouteManifest } from "./types";
