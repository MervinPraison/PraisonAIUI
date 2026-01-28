import { defineConfig } from "tsup";

export default defineConfig({
    entry: {
        index: "src/index.ts",
        "runtime/index": "src/runtime/index.ts",
        "next/index": "src/next/index.ts",
        "components/index": "src/components/index.ts",
        "cli/index": "src/cli/index.ts",
    },
    format: ["esm"],
    dts: true,
    splitting: true,
    clean: true,
    sourcemap: true,
    external: ["react", "react-dom", "next"],
});
