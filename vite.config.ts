import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// WEB_PORT / API_PORT let a second copy run side by side (for example a throwaway test instance).
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: false },
});
