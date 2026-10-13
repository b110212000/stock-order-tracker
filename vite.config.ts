import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '.',
        name: 'OrderLead · 台股投資管理',
        short_name: 'OrderLead',
        description: '訂單領先選股與個人投資管理',
        theme_color: '#142039',
        background_color: '#f5f7fb',
        display: 'standalone',
        scope: '.',
        start_url: '.',
        lang: 'zh-TW',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: { navigateFallback: 'index.html', globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'] }
    })
  ]
})
