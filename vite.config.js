import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Keep the browser's Host header (127.0.0.1:5173) so the API builds the right
      // Google sign-in redirect address.
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false }
    }
  }
});
