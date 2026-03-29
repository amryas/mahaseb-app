import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/xlsx') || id.includes('node_modules/jszip')) return 'xlsx';
          if (id.includes('node_modules/jspdf')) return 'jspdf';
          if (id.includes('node_modules/html2canvas')) return 'html2canvas';
        },
      },
    },
    chunkSizeWarningLimit: 1200,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    include: ['src/**/*.test.js', 'src/**/*.test.jsx'],
    coverage: { provider: 'v8', reporter: ['text', 'html'], exclude: ['node_modules/', 'src/test/'] },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'محاسب مشروعي',
        short_name: 'محاسب',
        description: 'إدارة الحسابات والمبيعات والمخزون',
        theme_color: '#0d9488',
        background_color: '#0f172a',
        display: 'standalone',
        dir: 'rtl',
        lang: 'ar',
        start_url: '/?v=2',
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        // App shell + fonts: omit very large lazy chunks (xlsx, jspdf, etc.) from precache — they load when online.
        globPatterns: ['**/*.{js,css,html,ico,woff2}'],
        globIgnores: ['**/xlsx-*.js', '**/recharts-*.js', '**/jspdf-*.js', '**/html2canvas-*.js'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts', expiration: { maxEntries: 4, maxAgeSeconds: 365 * 24 * 60 * 60 } },
          },
        ],
      },
    }),
  ],
})
