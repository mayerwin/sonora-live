import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { attachRelay } from './server/relay.ts';

/** The local publish/subscribe relay (server/relay.ts) on the dev and preview servers, for `?relay=local`. */
function localRelay(): Plugin {
  return {
    name: 'sonora-local-relay',
    configureServer(server) {
      if (server.httpServer) attachRelay(server.httpServer as Server);
    },
    configurePreviewServer(server) {
      if (server.httpServer) attachRelay(server.httpServer as Server);
    },
  };
}

function gitVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

const BRAND = '#0f0e13';

export default defineConfig({
  // relative URLs: the same build works on GitHub Pages (/sonora-live/), a custom domain or a sub-folder
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '1.0.0'),
    __APP_COMMIT__: JSON.stringify(gitVersion()),
  },
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  plugins: [
    localRelay(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Sonora Live',
        short_name: 'Sonora',
        description:
          'Remote music lessons, peer to peer: pure instrument sound, low-latency video and two-way MIDI between teacher and student.',
        lang: 'en',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: BRAND,
        theme_color: BRAND,
        categories: ['education', 'music', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        screenshots: [
          { src: 'social/screenshot-wide.webp', sizes: '1600x900', type: 'image/webp', form_factor: 'wide', label: 'A piano lesson' },
          { src: 'social/screenshot-narrow.webp', sizes: '780x1688', type: 'image/webp', form_factor: 'narrow', label: 'The lesson on a phone' },
        ],
      },
      workbox: {
        // the app shell is precached; the piano samples (tens of MB) are cached the first time they are used
        globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}', 'icons/*.png', 'emoji/*.json'],
        globIgnores: ['piano/**', 'social/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/piano/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'sonora-piano-v1',
              expiration: { maxEntries: 500 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    watch: { ignored: ['**/test-results/**', '**/dist/**', '**/tmp/**'] },
  },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
    assetsInlineLimit: 4096,
  },
});
