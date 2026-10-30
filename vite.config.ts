import { execSync } from 'node:child_process';
import type { Server } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { attachRelay } from './server/relay.ts';
import { versioning } from './tools/versioning.ts';

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
    versioning(),
    VitePWA({
      // registered by src/app/update.ts, which also decides when a page reloads (never during a lesson)
      registerType: 'autoUpdate',
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
          {
            src: 'social/screenshot-wide.webp',
            sizes: '1600x900',
            type: 'image/webp',
            form_factor: 'wide',
            label: 'A piano lesson',
          },
          {
            src: 'social/screenshot-narrow.webp',
            sizes: '780x1688',
            type: 'image/webp',
            form_factor: 'narrow',
            label: 'The lesson on a phone',
          },
        ],
      },
      workbox: {
        // the app's code is precached for offline use; pages are not (they come from the network first, below)
        globPatterns: ['**/*.{js,css,svg,woff2,webmanifest}', 'icons/*.png'],
        globIgnores: ['piano/**', 'social/**', 'emoji/**'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: null,
        // a new version takes over at once (the running page decides when to reload: src/app/update.ts)
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // the page: always the newest one online; the last one seen when offline
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'sonora-pages-v1',
              networkTimeoutSeconds: 5,
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 4 },
            },
          },
          {
            // emoji names in the language in use (the picker then keeps them in IndexedDB); ?v= changes with them
            urlPattern: ({ url }) => url.pathname.includes('/emoji/'),
            handler: 'CacheFirst',
            options: { cacheName: 'sonora-emoji-v1', expiration: { maxEntries: 4 } },
          },
          {
            // ?v= changes with the samples, so a cached sample is never outdated
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
