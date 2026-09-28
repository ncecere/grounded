import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// In development the Go server runs on :8080 and Vite proxies API and auth
// routes to it, so the browser sees a single origin.
const backend = "http://localhost:8080";

export default defineConfig({
  plugins: [react()],
  // "@/…" is src/ (bitop-ui components are installed under src/components/ui by the shadcn CLI).
  resolve: { alias: [{ find: /^@\//, replacement: "/src/" }] },
  server: {
    port: 5173,
    proxy: {
      "/v1": { target: backend, changeOrigin: true },
      "/auth": { target: backend, changeOrigin: true },
      "/healthz": { target: backend, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Pages are split by route (router.tsx). Libraries the shell needs go
        // into their own chunks, which change rarely and cache well.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            { name: "base-ui", test: /node_modules[\\/](@base-ui|@floating-ui|tabbable)[\\/]/, priority: 20 },
            { name: "tanstack", test: /node_modules[\\/]@tanstack[\\/]/, priority: 20 },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // Headroom for loaded CI runners (2 vCPUs, jsdom): heavy admin pages
    // took over the 5 s default there. A limit, not a delay.
    testTimeout: 20_000,
  },
});
