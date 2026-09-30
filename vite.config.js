import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { resolve } from 'node:path'

// base './' permite publicar en GitHub Pages bajo /nombre-repo/ sin cambios.
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), coordinator: resolve(__dirname, 'coordinator.html') },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'DMS · Monitor de conductor',
        short_name: 'DMS',
        description: 'Monitoreo de fatiga y distracción del conductor con alertas a coordinadores',
        lang: 'es',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#070b14',
        theme_color: '#070b14',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Incluye modelos de IA y wasm para trabajar 100 % sin internet
        globPatterns: ['**/*.{js,css,html,png,svg,wasm,task,tflite}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/coordinator\.html/],
      },
    }),
  ],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3001' } },
})
