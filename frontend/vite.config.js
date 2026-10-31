import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Static SPA output. Netlify publishes frontend/dist (see ../netlify.toml).
// For local full-stack dev use the Vite proxy below (FastAPI on :8000), or
// set VITE_API_URL to point the built SPA at a remote API.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
});
