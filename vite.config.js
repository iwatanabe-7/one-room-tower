import { defineConfig } from 'vite';

// base を相対パスにしておくと、dist をどこに置いても（GitHub Pages / itch.io）動く
export default defineConfig({
  base: './',
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 1200 },
  server: { host: true },
});
