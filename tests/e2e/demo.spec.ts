/**
 * The demo with Chromium's fake camera (TASKS.md C5, I2). The fake video is
 * the S2 render of the demo board along a known camera path; each frame
 * carries its index, so every pose is compared with the ground truth of the
 * frame it was computed from.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';

interface DebugEvent {
  frameId: number;
  t: number;
  index: number | null;
  tags: number;
  pose: number[] | null;
  worker: string;
  w: number;
  h: number;
  fx: number;
}
interface DebugState {
  events: DebugEvent[];
  errors: string[];
  states: string[];
}

const truth = JSON.parse(readFileSync('tests/out/fake-camera.json', 'utf8')) as {
  width: number;
  height: number;
  frames: number;
  boardFromCamera: number[][];
};

async function startDemo(page: Page, query: string): Promise<Request[]> {
  const requests: Request[] = [];
  page.on('request', (r) => requests.push(r));
  await page.goto(`/?debug${query}`);
  await page.getByRole('button', { name: 'Start' }).click();
  return requests;
}

async function waitForEvents(page: Page, n: number): Promise<DebugState> {
  await page.waitForFunction(
    (count) =>
      ((window as unknown as { __matar?: DebugState }).__matar?.events.length ?? 0) >= count,
    n,
    { timeout: 60_000 },
  );
  return page.evaluate(() => (window as unknown as { __matar: DebugState }).__matar);
}

/** Camera position error (mm) and rotation error (degrees), column-major 4 × 4. */
function poseError(a: number[], b: number[]): { mm: number; deg: number } {
  const mm = Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!);
  let tr = 0;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) tr += a[c * 4 + r]! * b[c * 4 + r]!;
  return { mm, deg: (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI };
}

function checkPrivacy(requests: Request[], origin: string): void {
  const foreign = requests.filter(
    (r) =>
      new URL(r.url()).origin !== origin &&
      !r.url().startsWith('data:') &&
      !r.url().startsWith('blob:'),
  );
  expect(foreign.map((r) => r.url())).toEqual([]);
  const withBody = requests.filter((r) => r.postDataBuffer() !== null);
  expect(withBody.map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
}

test('tracks the fake camera with the module worker; poses match the ground truth (I2)', async ({
  page,
  baseURL,
}) => {
  const requests = await startDemo(page, '');
  const state = await waitForEvents(page, 75);
  expect(state.errors).toEqual([]);
  expect(state.states).toContain('running');
  const events = state.events;
  expect(events.every((e) => e.worker === 'module')).toBe(true);
  expect(events[0]!.w).toBe(truth.width);
  expect(events[0]!.h).toBe(truth.height);

  // the frame path works end to end: the test video's frame index comes through
  const indices = events.map((e) => e.index).filter((i): i is number => i !== null);
  expect(indices.length).toBeGreaterThan(events.length * 0.9);
  expect(new Set(indices).size).toBeGreaterThan(30);

  // I2: after the first second, every pose within 2 mm / 0.5° of its frame's truth
  const t0 = events[0]!.t;
  const late = events.filter((e) => e.t - t0 > 1000 && e.index !== null && e.index < truth.frames);
  const withPose = late.filter((e) => e.pose);
  expect(withPose.length).toBeGreaterThan(late.length * 0.95);
  let worstMm = 0;
  let worstDeg = 0;
  for (const e of withPose) {
    const err = poseError(e.pose!, truth.boardFromCamera[e.index!]!);
    worstMm = Math.max(worstMm, err.mm);
    worstDeg = Math.max(worstDeg, err.deg);
  }
  console.log(
    `e2e: ${withPose.length}/${late.length} late frames with a pose, worst ${worstMm.toFixed(2)} mm / ${worstDeg.toFixed(3)}°, f ${events.at(-1)!.fx.toFixed(1)} px`,
  );
  expect(worstMm).toBeLessThan(2);
  expect(worstDeg).toBeLessThan(0.5);

  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('runs inline on request', async ({ page, baseURL }) => {
  const requests = await startDemo(page, '&inline');
  const state = await waitForEvents(page, 20);
  expect(state.errors).toEqual([]);
  expect(state.events.every((e) => e.worker === 'inline')).toBe(true);
  expect(state.events.filter((e) => e.pose).length).toBeGreaterThan(10);
  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('the live background runs too', async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await startDemo(page, '&bg=live');
  const state = await waitForEvents(page, 20);
  expect(state.errors).toEqual([]);
  expect(errors).toEqual([]);
  expect(state.events.filter((e) => e.pose).length).toBeGreaterThan(10);
  await expect(page.locator('#hud')).toContainText('bg live');
  checkPrivacy(requests, new URL(baseURL!).origin);
});
