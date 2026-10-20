/**
 * Playwright e2e (TASKS.md C5, I2; T3-2): Chromium only.
 *
 * - `demo`: the demo app with Chromium's fake camera fed by the S2 video
 *   (`tests/out/fake-camera.y4m`, made by the global setup if missing).
 * - `three`: the real-three texture-ring readback test (tests/e2e/three).
 *
 * Both pages are served by Vite on localhost (a secure context, plain HTTP).
 */
import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const DEMO_PORT = 5180;
const THREE_PORT = 5191;
const Y4M = resolve('tests/out/fake-camera.y4m');
const reuse = !process.env.CI;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  reporter: 'list',
  forbidOnly: !!process.env.CI,
  globalSetup: './tests/e2e/global-setup.ts',
  projects: [
    {
      name: 'demo',
      testMatch: 'demo.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${DEMO_PORT}`,
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-video-capture=${Y4M}`,
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
    {
      name: 'three',
      testMatch: 'three/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${THREE_PORT}`,
        // software WebGL where there is no GPU (CI); a no-op where there is one
        launchOptions: {
          args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite demo --port ${DEMO_PORT} --strictPort`,
      url: `http://localhost:${DEMO_PORT}`,
      env: { MATAR_E2E: '1' },
      reuseExistingServer: reuse,
    },
    {
      command: `pnpm exec vite tests/e2e/three --port ${THREE_PORT} --strictPort`,
      url: `http://localhost:${THREE_PORT}`,
      reuseExistingServer: reuse,
    },
  ],
});
