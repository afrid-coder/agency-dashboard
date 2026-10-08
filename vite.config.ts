import { copyFileSync, existsSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE: the path the app is served from, e.g. /agency-dashboard/ on GitHub Pages.
const base = process.env.VITE_BASE ?? '/';

/**
 * GitHub Pages has no server-side routing: unknown paths get 404.html. Making
 * that the app itself lets deep links and refreshes (…/app/tasks) load.
 */
const spaFallback = (): Plugin => ({
  name: 'lumera-spa-fallback',
  apply: 'build',
  closeBundle() {
    if (base !== '/' && existsSync('dist/index.html')) copyFileSync('dist/index.html', 'dist/404.html');
  },
});

// WEB_PORT / API_PORT let a second copy run side by side (for example a throwaway test instance).
export default defineConfig({
  base,
  plugins: [react(), spaFallback()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
