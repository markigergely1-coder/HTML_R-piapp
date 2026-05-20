import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'app-icon.svg',
        'icons.svg',
        'apple-touch-icon-180x180.png',
        'pwa-64x64.png',
      ],
      manifest: {
        name: 'Röpi App Pro',
        short_name: 'Röpi',
        description: 'Röplabda jelenlét, elszámolás és tagság-kezelés egy app-ban.',
        theme_color: '#059669',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'hu',
        scope: '/',
        start_url: '/',
        categories: ['sports', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png',  sizes: '64x64',   type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Új SW azonnal aktiválódjon, NE várjon hogy minden tab bezárulj.
        // Ez kritikus telepített PWA-knál — egyébként napokig stale chunk-okat
        // szolgálna ki és „TypeError: 'text/html' is not a valid JavaScript MIME type"
        // hibát kapnánk amikor egy lazy-imported page chunk hash-e megváltozik.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // App héj cache-elése — minden static asset
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        // NE cache-elje a Firebase és Google API-kat (azokat a Firestore SDK maga kezeli)
        navigateFallback: '/index.html',
        // navigateFallback NE szolgálja ki a JS/CSS chunk request-eket (különben
        // text/html-t kapunk és MIME error). Csak HTML-navigációra szóljon.
        navigateFallbackDenylist: [
          /^\/__\/auth\//,
          /^\/api\//,
          /\.(?:js|mjs|css|map|json|woff2?|png|jpg|jpeg|svg|ico)$/i,
          /^\/assets\//,
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
