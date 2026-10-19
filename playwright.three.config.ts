/**
 * Playwright config for the real-three `matar/three` tests (T3-2): Chromium
 * with WebGL, the fixture page under tests/e2e/three served by Vite. Kept
 * separate from playwright.config.ts (camera/demo e2e) until the lead merges
 * them. Run: `pnpm exec playwright test -c playwright.three.config.ts`.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 5191;

export default defineConfig({
  testDir: 'tests/e2e/three',
  testMatch: '*.spec.ts',
  outputDir: 'test-results/three',
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // software WebGL where there is no GPU (CI); a no-op where there is one
        launchOptions: {
          args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: {
    command: `pnpm exec vite tests/e2e/three --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
