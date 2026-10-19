/**
 * T3-2 acceptance in Chromium (WebGL, real three.js): after every `update()` +
 * `render()`, the background read back from the canvas is frame N's colour
 * when pose N is applied, the cover crop cuts the side bands, the frame is
 * upright, and the overlay square sits at the board origin. Fixture and script:
 * fixture.ts, scenario.ts. Run: `pnpm exec playwright test -c playwright.three.config.ts`.
 */
import { expect, test } from '@playwright/test';
import { OVERLAY_RGB, nearestFrame, type Rgb, type Step, type Variant } from './scenario.js';

/** Max channel difference allowed: exact uploads vs. the video's YUV round trip. */
const TOLERANCE: Record<Variant, number> = {
  'canvas-frame': 3,
  'video-frame': 24,
  'video-video': 24,
  'video-null': 24,
};

const maxDiff = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - (b[i] ?? 0))));

for (const variant of Object.keys(TOLERANCE) as Variant[]) {
  test(`pose N shows frame N (${variant})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/');
    await page.waitForFunction(() => 'matarThreeFixture' in window);
    const steps: Step[] = await page.evaluate(
      (v) =>
        (
          window as unknown as { matarThreeFixture: { run(v: Variant): Promise<Step[]> } }
        ).matarThreeFixture.run(v),
      variant,
    );
    expect(errors).toEqual([]);
    expect(steps.length).toBeGreaterThan(10);
    let worst = 0;
    for (const s of steps) {
      const where = `${variant}, script op ${s.op}`;
      expect(s.result, where).toEqual({ tracking: true, frameId: s.expected });
      const c = nearestFrame(s.samples.centre);
      expect(c.frame, `${where}: background shows the wrong frame`).toBe(s.expected % 16);
      worst = Math.max(worst, c.diff);
      // cover crop: the black side bands are cut off, the edges show the frame colour
      for (const side of ['left', 'right'] as const) {
        const e = nearestFrame(s.samples[side]);
        expect(e.frame, `${where}: ${side} edge`).toBe(s.expected % 16);
        worst = Math.max(worst, e.diff);
      }
      // upright: the white band is at the top
      expect(Math.min(...s.samples.top), `${where}: top band`).toBeGreaterThan(230);
      // the overlay is drawn with pose N at the board origin
      expect(maxDiff(s.samples.overlay, OVERLAY_RGB), `${where}: overlay`).toBeLessThanOrEqual(3);
    }
    console.info(`${variant}: ${steps.length} renders, max background channel error ${worst} DN`);
    expect(worst).toBeLessThanOrEqual(TOLERANCE[variant]);
  });
}
