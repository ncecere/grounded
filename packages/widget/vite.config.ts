import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

// Get build target from env or default to 'widget'
const buildTarget = process.env.BUILD_TARGET || 'widget';

const configs = {
  widget: {
    entry: resolve(__dirname, 'src/index.tsx'),
    name: 'GroundedWidget',
    fileName: () => 'widget.js',
  },
  'published-chat': {
    entry: resolve(__dirname, 'src/published-chat.tsx'),
    name: 'GroundedChat',
    fileName: () => 'published-chat.js',
  },
};

const config = configs[buildTarget as keyof typeof configs] || configs.widget;

export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: config.entry,
      name: config.name,
      fileName: config.fileName,
      formats: ['iife'],
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        // Ensure all CSS is inlined
        assetFileNames: '[name].[ext]',
      },
    },
    // Inline all assets including CSS
    cssCodeSplit: false,
    // Minify for production (use esbuild, which is bundled with Vite)
    minify: 'esbuild',
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});
