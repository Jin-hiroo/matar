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

async function startDemo(
  page: Page,
  query: string,
  beforeStart?: () => Promise<void>,
): Promise<Request[]> {
  const requests: Request[] = [];
  page.on('request', (r) => requests.push(r));
  await page.goto(`/?debug${query}`);
  await beforeStart?.();
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

test('the report finds the fake camera’s focal length from a wrong prior (?fov=40)', async ({
  page,
  context,
  baseURL,
}) => {
  // the fake video: 640 × 480, 68° along the width, f = 474.4 px, tilted 34–45°;
  // ?fov=40 puts f in use at 879 px, so the truth is 0.54 × it
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await startDemo(page, '&fov=40');
  await waitForEvents(page, 40);
  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  const fit =
    /fit {6}(\d+) px best \((\d+)–(\d+) over (\d+) tilted frames; long-side FOV ([\d.]+)°, \?fov=[\d.]+\), err ([\d.]+) px with it, ([\d.]+) px with the f in use/.exec(
      report,
    );
  expect(fit, report).not.toBeNull();
  console.log(`e2e focal fit: ${fit![0]}`);
  expect(Math.abs(Number(fit![1]) / 474.4 - 1), report).toBeLessThan(0.02);
  expect(Math.abs(Number(fit![5]) - 68), report).toBeLessThan(1.5);
  expect(Number(fit![6]), report).toBeLessThan(0.5);
  // the fake video is tilted 34–45°, noise-free: every keyframe candidate fits well
  const calib =
    /calib {4}(\d+) frames with ≥ 6 tags at ≥ 20° tilt \(homography fit [\d.]+ \/ [\d.]+ px, [\d.]+ \/ [\d.]+ mm on the paper\), (\d+) of them under 1 px or 1 mm, from (\d+) directions ≥ 10° apart \((\d+) since Start; it needs 3\)/.exec(
      report,
    );
  expect(calib, report).not.toBeNull();
  expect(Number(calib![1])).toBeGreaterThan(20);
  expect(Number(calib![2])).toBe(Number(calib![1]));
  expect(Number(calib![3])).toBeGreaterThanOrEqual(1);
  expect(Number(calib![4])).toBeGreaterThanOrEqual(Number(calib![3]));
  console.log(`e2e ${/calib {4}.*/.exec(report)![0]}`); // `!`: matched above
  // split by board speed: noise-free frames give the truth alone, at any speed
  const bands = [
    ...report.matchAll(/(?:< 100 px\/s|100–300|≥ 300) ([\d.]+) px, f (\d+) \((\d+)\)/g),
  ];
  expect(bands.length, report).toBeGreaterThanOrEqual(1);
  for (const b of bands) expect(Math.abs(Number(b[2]) / 474.4 - 1), b[0]).toBeLessThan(0.02);
  // the timeline: the camera and the 40° prior at the first frame (the truth is
  // outside the self-calibration's window from it, so no estimate follows)
  const history = /history {2}(.*)/.exec(report);
  expect(history, report).not.toBeNull();
  expect(history![1]).toMatch(/^0\.0 s (camera|f )/);
  expect(history![1]).toMatch(/ s camera /);
  expect(history![1]).toMatch(/ s f 879\.\d px \(prior\)/);
  console.log(`e2e history: ${history![0]}`);
  expect(errors).toEqual([]);
  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('a measured focal length is saved and the next Start begins from it; ?fresh forgets it', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const copyReport = async () => {
    await page.getByRole('button', { name: 'Copy report' }).click();
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
    return page.evaluate(() => navigator.clipboard.readText());
  };
  // a wrong prior, so the measured value differs from it
  const savedFx = async () => {
    const saved = await page.evaluate(() => localStorage.getItem('matar-demo-calibration'));
    return (JSON.parse(saved!) as { intrinsics: { fx: number } }).intrinsics.fx;
  };
  const requests = await startDemo(page, '&fov=60');
  await expect(page.locator('#hud')).toContainText('(estimated', { timeout: 20_000 });
  expect(Math.abs((await savedFx()) / 474.4 - 1)).toBeLessThan(0.02);
  // the 60° prior is 17 % long: the jump rule replaces it from the first usable frames
  const measured = await copyReport();
  const firstEstimate = /first estimate ([\d.]+) s after the first frame it could use/.exec(
    measured,
  );
  expect(firstEstimate).not.toBeNull();
  // the timeline has the prior and the estimates that replaced it
  expect(measured).toMatch(
    /history .*0\.0 s f 554\.\d px \(prior\) · .*s f 4\d\d\.\d px \(estimated/,
  );
  expect(Number(firstEstimate![1])).toBeLessThan(2);
  console.log(`e2e ${firstEstimate![0]}`);

  // refinements keep saving until the page goes: read what the next load starts from
  let fx = 0;
  requests.push(...(await startDemo(page, '', async () => void (fx = await savedFx()))));
  expect(Math.abs(fx / 474.4 - 1)).toBeLessThan(0.02);
  await waitForEvents(page, 20);
  const first = await page.evaluate(
    () => (window as unknown as { __matar: DebugState }).__matar.events[0]!.fx,
  );
  expect(first).toBeCloseTo(fx, 6); // not the 68° prior's 474.4 px exactly
  const report = await copyReport();
  expect(report).toMatch(/focal {4}[\d.]+ px \((provided|estimated)/);
  expect(report).toMatch(/started from (the one saved for|a saved one)/);

  requests.push(
    ...(await startDemo(page, '&fresh', async () => {
      expect(await page.evaluate(() => localStorage.getItem('matar-demo-calibration'))).toBeNull();
    })),
  );
  // Calibration may save again after Start; the first frame must use the default prior.
  const fresh = await waitForEvents(page, 5);
  const priorFx = Math.max(truth.width, truth.height) / 2 / Math.tan((68 * Math.PI) / 360);
  expect(fresh.events[0]?.fx).toBeCloseTo(priorFx, 6);
  expect(await copyReport()).toMatch(/; (nothing saved used|measured one saved for )/);
  expect(errors).toEqual([]);
  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('the saved calibration is used when camera names are listed only after a permission prompt', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await startDemo(page, '&fov=60');
  await expect(page.locator('#hud')).toContainText('(estimated', { timeout: 20_000 });
  // the next load as after a one-time grant: no names (or IDs) until getUserMedia
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const enumerate = md.enumerateDevices.bind(md);
    const open = md.getUserMedia.bind(md);
    let granted = false;
    md.getUserMedia = (c) =>
      open(c).then((s) => {
        granted = true;
        return s;
      });
    md.enumerateDevices = () =>
      enumerate().then((ds) =>
        granted
          ? ds
          : ds.map((d) => ({ ...d.toJSON(), label: '', deviceId: '' }) as MediaDeviceInfo),
      );
  });
  let fx = 0;
  requests.push(
    ...(await startDemo(page, '', async () => {
      const saved = await page.evaluate(() => localStorage.getItem('matar-demo-calibration'));
      fx = (JSON.parse(saved!) as { intrinsics: { fx: number } }).intrinsics.fx;
    })),
  );
  const state = await waitForEvents(page, 10);
  expect(state.events[0]!.fx).toBeCloseTo(fx, 6);
  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /started from the one saved for .* px, camera names listed after a permission prompt\)/,
  );
  expect(errors).toEqual([]);
  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('?exposure= reports what became of it and keeps tracking', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await startDemo(page, '&exposure=4');
  const state = await waitForEvents(page, 20);
  expect(state.events.slice(-10).some((e) => e.pose)).toBe(true);
  const copyReport = async () => {
    await page.getByRole('button', { name: /Copy report|Copied/ }).click();
    return page.evaluate(() => navigator.clipboard.readText());
  };
  // the fake camera has no manual exposure: 'unsupported' once it has settled
  // (EXPOSURE_SETTLE_MS); a phone with it shows "set"
  await expect
    .poll(
      async () =>
        /exposure .*; \?exposure=4 \(camera\.maxExposureMs\): (.*)/.exec(await copyReport())?.[1],
      {
        timeout: 10_000,
      },
    )
    .toBe('no manual exposure with ISO control here');
  const report = await copyReport();
  expect(report).toContain('url ?debug&exposure=4');
  // the timeline has the wait and the outcome, timed from the first frame
  expect(report).toMatch(/history .*\d s exposure pending .* · [\d.]+ s exposure unsupported/);
  expect(errors).toEqual([]);
  checkPrivacy(requests, new URL(baseURL!).origin);
});

test('Mode switches the background without a reload; Copy report copies the timings', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const requests = await startDemo(page, '');
  const before = await waitForEvents(page, 20);
  await expect(page.locator('#hud')).toContainText('bg frame');

  await page.getByRole('button', { name: 'Mode: frame' }).click();
  await expect(page.locator('#hud')).toContainText('bg live');
  await expect(page).toHaveURL(/bg=live/);
  const after = await waitForEvents(page, before.events.length + 30);
  expect(after.events.slice(-10).some((e) => e.pose)).toBe(true);

  await page.getByRole('button', { name: 'Copy report' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const report = await page.evaluate(() => navigator.clipboard.readText());
  // Mode rewrites the URL: URLSearchParams writes `debug=`
  expect(report).toMatch(/mode {5}bg live, pose raw, worker module, url \?debug=?&bg=live\n/);
  const fps = /fps {6}camera ([\d.]+), analysed ([\d.]+)/.exec(report);
  expect(Number(fps?.[1])).toBeGreaterThan(5);
  expect(Number(fps?.[2])).toBeGreaterThan(5);
  expect(report).toMatch(/worker {3}[\d.]+ \/ [\d.]+ ms/);
  expect(report).toMatch(/pose age \d+ \/ \d+ ms/);
  expect(report).toMatch(/interval \d+ \/ \d+ ms between analysed frames/);
  expect(report).toMatch(/no pose {2}\d+ frames in \d+ runs \(longest \d+\)/);
  expect(report).toMatch(/grab {5}[\d.]+ \/ [\d.]+ ms on the main thread/);
  expect(report).toMatch(
    /view {5}\d+ \/ \d+ mm above the paper, tilt \d+ \/ \d+° from straight down/,
  );
  // the error on the paper: the same corners met with the board plane (≈ 1 px per mm for the fake camera)
  const tags =
    /tags {5}\d+ \/ \d+ found, \d+ \/ \d+ used, err ([\d.]+) \/ [\d.]+ px \(([\d.]+) \/ [\d.]+ mm on the paper\)/.exec(
      report,
    );
  expect(tags, report).not.toBeNull();
  console.log(`e2e ${tags![0]}; ${/view .*/.exec(report)?.[0]}`);
  expect(Number(tags![2]), report).toBeGreaterThan(0);
  expect(Number(tags![2]), report).toBeLessThan(3 * Number(tags![1]) + 0.05);
  expect(report).toMatch(/motion {3}board centre \d+ \/ \d+ px\/s in the image/);
  expect(report).toMatch(/exposure \S/);
  // the report reprojects the used corners itself: small errors check its projection
  const rings =
    /err by r centre (\S+) px \((\d+) corners\), middle (\S+) \((\d+)\), edge (\S+) \((\d+)\)/.exec(
      report,
    );
  expect(rings, report).not.toBeNull();
  const corners = [rings![2], rings![4], rings![6]].reduce((a, n) => a + Number(n), 0);
  expect(corners).toBeGreaterThan(0);
  for (const rms of [rings![1], rings![3], rings![5]]) {
    if (rms !== '-') expect(Number(rms), report).toBeLessThan(2);
  }
  expect(errors).toEqual([]);
  checkPrivacy(requests, new URL(baseURL!).origin);
});
