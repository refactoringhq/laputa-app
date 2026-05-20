import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single-file build: a self-contained `dist/index.html` that the
// `note_item` crate loads via `wry::WebViewBuilder::with_html`.  All
// JS + CSS is inlined into one file; no separate fetch traffic, no
// asset-server complexity.
//
// `vite-plugin-singlefile` folds JS modules into a `<script>` block
// and CSS into a `<style>` block, producing a true single-file
// payload that `include_str!()` can embed at the Rust call site.
//
// Phase 8.24 swaps the textarea MVP for a real BlockNote editor; the
// bundle size jumps from ~4 kB to several hundred kB (BlockNote core
// + React + ProseMirror + emoji-mart data).  That growth is expected
// and recorded in the Phase 8.24 commit body.
export default defineConfig({
    base: "./",
    plugins: [react(), viteSingleFile()],
    build: {
        outDir: "dist",
        emptyOutDir: true,
        assetsInlineLimit: 100_000_000,
        cssCodeSplit: false,
        rollupOptions: {
            output: {
                inlineDynamicImports: true,
            },
        },
    },
    define: {
        // Lock React into production mode so `vite build` strips the
        // dev-only warning machinery (saves ~80 kB minified + tree).
        "process.env.NODE_ENV": JSON.stringify("production"),
    },
    test: {
        environment: "happy-dom",
        globals: false,
        include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    },
});
