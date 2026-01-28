/**
 * Next.js adapter for PraisonAIUI
 */

import type { NextConfig } from "next";

export interface AIUINextConfig {
    configPath?: string;
}

/**
 * Wrap Next.js config with AIUI integration.
 */
export function withAIUI(
    nextConfig: NextConfig = {},
    aiuiConfig: AIUINextConfig = {}
): NextConfig {
    const configPath = aiuiConfig.configPath || "./aiui";

    return {
        ...nextConfig,

        // Add webpack configuration for manifest loading
        webpack(config, options) {
            // Add alias for AIUI config path
            config.resolve = config.resolve || {};
            config.resolve.alias = {
                ...config.resolve.alias,
                "@aiui": configPath,
            };

            // Call existing webpack config if present
            if (typeof nextConfig.webpack === "function") {
                return nextConfig.webpack(config, options);
            }

            return config;
        },

        // Configure page extensions
        pageExtensions: [
            ...(nextConfig.pageExtensions || ["tsx", "ts", "jsx", "js"]),
            "md",
            "mdx",
        ],
    };
}

/**
 * Create catch-all page props for docs routing.
 */
export async function getDocsPageProps(params: { slug?: string[] }) {
    const slug = params.slug?.join("/") || "";
    const path = `/docs/${slug}`.replace(/\/$/, "");

    return {
        props: {
            path,
            slug,
        },
    };
}

export default withAIUI;
