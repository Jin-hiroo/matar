/**
 * Pose-stage timing (TASKS.md P4: ≤ 1 ms for 15 tags on M-series, reported).
 * Run with `pnpm vitest bench --run tests/bench/pose.bench.ts` (vitest 5: `bench` is a
 * test-context fixture, only available in `*.bench.ts` files).
 */
import { test } from 'vitest';
import { estimatePose } from '../../src/pose/index.js';
import { intrinsicsFromFov, lookAtPose } from '../../src/synth/camera.js';
import { mulberry32, normalSampler } from '../../src/synth/random.js';
import type { Board, BoardTag } from '../../src/types.js';
import { a4Ring15, observe, singleTag } from '../synthetic/pose-helpers.js';

const K = intrinsicsFromFov(1280, 720, 65);
const noise = normalSampler(mulberry32(1));

/** 40 tags of 20 mm on an 8 × 5 grid, 36 mm pitch. */
function grid40(): Board {
  const tags: BoardTag[] = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 8; c++) {
      tags.push({
        id: 10 + 8 * r + c,
        centerMm: [(c - 3.5) * 36, (r - 2) * 36],
        sizeMm: 20,
        rotationDeg: 0,
      });
    }
  }
  return { family: 'tag36h11', tags };
}

const view = lookAtPose([40, 360, 180], [0, 0, 0]);
const b1 = singleTag(40);
const d1 = observe(b1, K, lookAtPose([30, 260, 120], [0, 0, 0]), noise, 0.15);
const b15 = a4Ring15();
const d15 = observe(b15, K, view, noise, 0.15);
const b40 = grid40();
const d40 = observe(b40, K, lookAtPose([20, 420, 150], [0, 0, 0]), noise, 0.15);
const prev = view;

test('estimatePose', async ({ bench }) => {
  await bench.compare(
    bench('1 tag (previous pose given)', () => {
      estimatePose(d1, b1, K, prev);
    }),
    bench(`15 tags (${d15.length} visible)`, () => {
      estimatePose(d15, b15, K);
    }),
    bench(`40 tags (${d40.length} visible)`, () => {
      estimatePose(d40, b40, K);
    }),
  );
});
