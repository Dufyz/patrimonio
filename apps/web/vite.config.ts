import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // A api responde em /api; no deploy é um subdomínio do mesmo domínio raiz.
    proxy: { '/api': { target: 'http://localhost:3333', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
});
