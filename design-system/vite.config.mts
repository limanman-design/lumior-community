import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export default defineConfig({
  root: fileURLToPath(new URL('./', import.meta.url)),
  base: './',
  publicDir: false,
  envDir: fileURLToPath(new URL('./', import.meta.url)),
  plugins: [react()],
  resolve: { alias: { '@': root } },
  css: { postcss: { plugins: [tailwindcss()] } },
  server: { host: '127.0.0.1', port: 42829, strictPort: true, fs: { allow: [root] } },
  build: { outDir: '../output/design-system/site', emptyOutDir: true },
});
