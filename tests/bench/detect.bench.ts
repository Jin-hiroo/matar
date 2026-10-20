/**
 * Detector timing (TASKS.md D5: median ≤ 4 ms for 1280 × 720 with 15 tags on
 * M-series, reported). Run with `pnpm bench tests/bench/detect.bench.ts`
 * (vitest 5: `bench` is a test-context fixture, only in `*.bench.ts` files).
 *
 * Frames: the 15-tag A4 ring seen from 50 cm (all tags in view, 4.7–8.5 px
 * per cell), clean (blur 0.8 px) and noisy (40 clutter patches + 2 DN noise).
 * `'auto'` reuses one detector, so it measures the steady state (×2 with a
 * ×1 frame every 8th call).
 */
import { test } from 'vitest';
import { createDetector } from '../../src/detect/index.js';
import {
  intrinsicsFromFov,
  lookAtPose,
  mulberry32,
  randomPatches,
  renderBoard,
} from '../../src/synth/index.js';
import type { DetectorOptions, GrayImage } from '../../src/types.js';
import { a4Ring15 } from '../synthetic/pose-helpers.js';

const board = a4Ring15();
const k = intrinsicsFromFov(1280, 720, 65);
const pose = lookAtPose([30, 470, 160], [0, 0, 0]);
const pageMm = { min: [-148.5, -105] as [number, number], max: [148.5, 105] as [number, number] };

function frame(noisy: boolean): GrayImage {
  const patches = noisy
    ? randomPatches(mulberry32(3), {
        areaMm: { min: [-145, -100], max: [145, 100] },
        count: 40,
        avoid: board,
      })
    : [];
  return renderBoard({
    board,
    intrinsics: k,
    boardFromCamera: pose,
    patches,
    pageMm,
    blurSigmaPx: 0.8,
    noiseSigma: noisy ? 2 : 0,
    seed: 1,
    supersample: 4,
  });
}

const clean = frame(false);
const noisy = frame(true);
const ids = board.tags.map((t) => t.id);

function detector(decimate: DetectorOptions['decimate'], img: GrayImage) {
  const det = createDetector({ width: 1280, height: 720, family: 'tag36h11', ids, decimate });
  const found = det.detect(img).length; // warm-up, and a sanity check in the label
  return { det, found };
}

for (const [name, img] of [
  ['clean', clean],
  ['clutter + 2 DN noise', noisy],
] as const) {
  test(`detect 1280 × 720, 15 tags, ${name}`, async ({ bench }) => {
    const d1 = detector(1, img);
    const d2 = detector(2, img);
    const da = detector('auto', img);
    const r = await bench.compare(
      bench(`×1 (${d1.found} found)`, () => {
        d1.det.detect(img);
      }),
      bench(`×2 (${d2.found} found)`, () => {
        d2.det.detect(img);
      }),
      bench(`auto (${da.found} found)`, () => {
        da.det.detect(img);
      }),
    );
    // vitest 5 prints no table for a plain `vitest bench --run`; report medians here
    for (const n of [
      `×1 (${d1.found} found)`,
      `×2 (${d2.found} found)`,
      `auto (${da.found} found)`,
    ] as const) {
      const l = r.get(n).latency;
      console.log(
        `detect ${name}, ${n}: median ${l.p50.toFixed(2)} ms, p99 ${l.p99.toFixed(2)} ms`,
      );
    }
  });
}
