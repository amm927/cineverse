import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Estrategia injectManifest: inyecta el precache manifest en nuestro sw.js personalizado
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectRegister: false, // Gestionamos el registro manualmente en main.jsx
      manifest: {
        name: 'CineVerse & CineMatch',
        short_name: 'CineVerse',
        description: 'Encuentra películas y juega en pareja o con amigos en tiempo real.',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      // Workbox config para injectManifest
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: true,          // Activar el SW también en desarrollo para poder probar push
        type: 'module',
      }
    })
  ],
  server: {
    port: 5173,
    allowedHosts: true,
    watch: {
      usePolling: true,
    },
  },
})

