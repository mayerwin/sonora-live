import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;
/** the tests over simulated networks: their own project (and CI job), long and timing-sensitive */
const NETWORK = ['**/latency.spec.ts', '**/network.spec.ts'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_URL ?? `http://localhost:${PORT}/`,
    trace: 'retain-on-failure',
    permissions: ['camera', 'microphone'],
    launchOptions: {
      // a local Chromium can be used instead of Playwright's download (PW_CHROMIUM=/path/to/chrome)
      executablePath: process.env.PW_CHROMIUM || undefined,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    // the lesson itself
    {
      name: 'chromium',
      testIgnore: NETWORK,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } },
    },
    // over simulated networks (server/netsim.ts): delay, jitter, loss; timing measured by ear
    {
      name: 'network',
      testMatch: NETWORK,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 860 } },
    },
    // the lesson in Firefox, on request (E2E_FIREFOX=1, after `npx playwright install firefox`)
    ...(process.env.E2E_FIREFOX
      ? [
          {
            name: 'firefox',
            testIgnore: NETWORK,
            use: {
              ...devices['Desktop Firefox'],
              viewport: { width: 1360, height: 860 },
              // Firefox does not take Chromium's permissions: its own fake camera and microphone, no prompt
              permissions: [],
              launchOptions: {
                firefoxUserPrefs: {
                  'media.navigator.streams.fake': true,
                  'media.navigator.permission.disabled': true,
                  'media.autoplay.default': 0,
                  'media.autoplay.block-webaudio': false,
                  'permissions.default.microphone': 1,
                  'permissions.default.camera': 1,
                },
              },
            },
          },
        ]
      : []),
  ],
  webServer: process.env.E2E_URL
    ? undefined
    : {
        command: `npx vite --port ${PORT} --strictPort`,
        url: `http://localhost:${PORT}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
