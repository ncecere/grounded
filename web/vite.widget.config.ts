import { defineConfig } from "vite";

// The embeddable widget loader (web/widget), built on its own into
// dist/widget.js after the app: one small IIFE with no dependencies.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    lib: { entry: "widget/widget.ts", formats: ["iife"], name: "GroundedWidget", fileName: () => "widget.js" },
  },
});
