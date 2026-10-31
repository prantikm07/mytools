import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build output goes straight into backend/static so FastAPI serves the SPA.
export default defineConfig({
  plugins: [react()],
  build: { outDir: '../backend/static', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8000' },
  },
});
