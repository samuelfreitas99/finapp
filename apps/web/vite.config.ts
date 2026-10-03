import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Portas 3000 e 5173 já são usadas por outros projetos no servidor.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'FinApp',
        short_name: 'FinApp',
        description: 'Controle financeiro: saldo, o que vence e o que vai sobrar.',
        lang: 'pt-BR',
        id: '/',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['finance'],
        background_color: '#F4F3EE',
        theme_color: '#1F3A68',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [{ name: 'Novo lançamento', short_name: 'Lançar', url: '/lancar' }],
      },
      workbox: {
        // Só a casca do app fica em cache; dados da API sempre vêm da rede.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Português só usa os subconjuntos latinos da fonte.
        globIgnores: ['**/*-{cyrillic,greek,vietnamese}-*.woff2'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // Recebe e mostra os Web Push (public/push-sw.js).
        importScripts: ['push-sw.js'],
      },
    }),
  ],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
