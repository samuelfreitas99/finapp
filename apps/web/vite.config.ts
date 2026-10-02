import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Portas 3000 e 5173 já são usadas por outros projetos no servidor.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
