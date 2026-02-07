import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime — cached separately, rarely changes
          "vendor-react": ["react", "react-dom"],
          // Radix UI primitives — large aggregate, shared across many pages
          "vendor-radix": [
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
            "@radix-ui/react-scroll-area",
            "@radix-ui/react-collapsible",
            "@radix-ui/react-switch",
            "@radix-ui/react-checkbox",
            "@radix-ui/react-progress",
            "@radix-ui/react-hover-card",
            "@radix-ui/react-separator",
            "@radix-ui/react-label",
            "@radix-ui/react-slot",
          ],
          // Markdown rendering (used only in Chat page)
          "vendor-markdown": ["react-markdown", "marked", "shiki"],
          // Flow diagrams (used only in pipeline visualizations)
          "vendor-xyflow": ["@xyflow/react"],
          // Animation library
          "vendor-motion": ["motion"],
        },
      },
    },
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
