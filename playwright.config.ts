import { defineConfig } from '@playwright/test';

// BASE_URL runs the tests against a deployed copy instead of the dev server.
const remote = process.env.BASE_URL;
const port = 5199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: {
    baseURL: remote ?? `http://localhost:${port}/`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    screenshot: 'only-on-failure',
  },
  webServer: remote
    ? undefined
    : { command: `npm run dev -- --port ${port} --strictPort`, url: `http://localhost:${port}/`, reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
});
