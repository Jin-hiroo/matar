/**
 * D1 (TASKS.md): threshold + candidates. Every tag's quad is found for
 * ≥ 3 px/cell and tilt ≤ 60°; no crash on degenerate frames; buffers reused.
 */
import { describe, expect, it } from 'vitest';
import { TagDetector } from '../../src/detect/detector.js';
import {
  intrinsicsFromFov,
  mulberry32,
  randomViewPose,
  renderBoard,
} from '../../src/synth/index.js';
import type { GrayImage } from '../../src/types.js';
import { bestCyclicMaxErrPx, gridBoard, pickIds, tagTruths } from './detect-helpers.js';

const K = intrinsicsFromFov(640, 480, 65);

/**
 * Renders seeded frames of a 3 × 3 grid board and checks that every eligible
 * tag has a candidate quad within `tolPx` of its true corners.
 */
function candidateRecall(o: {
  seed: number;
  decimate: 1 | 2;
  minCellPx: number;
  distanceMm: [number, number];
  minInstances: number;
  tolPx: number;
}): void {
  const rng = mulberry32(o.seed);
  const det = new TagDetector({
    width: K.width,
    height: K.height,
    family: 'tag36h11',
    ids: 'all',
    decimate: o.decimate,
  });
  let instances = 0;
  const misses: string[] = [];
  for (let frame = 0; instances < o.minInstances && frame < 200; frame++) {
    const board = gridBoard(rng, pickIds(rng, 9), {
      cols: 3,
      rows: 3,
      pitchMm: 60,
      sizeMm: [24, 32],
    });
    const pose = randomViewPose(rng, {
      distanceMm: o.distanceMm,
      tiltDeg: [0, 60],
      rollDeg: [0, 360],
      targetBoxMm: { min: [-20, -20], max: [20, 20] },
    });
    const img = renderBoard({
      board,
      intrinsics: K,
      boardFromCamera: pose,
      blurSigmaPx: 0.8,
      noiseSigma: 2,
      seed: o.seed * 1000 + frame,
      supersample: 2, // candidates are checked to 2–3 px only
    });
    det.detect(img);
    const cands = det.lastCandidates();
    for (const t of tagTruths(board, K, pose)) {
      if (!t.inView || t.minCellPx < o.minCellPx || t.tiltDeg > 60) continue;
      instances++;
      const err = Math.min(...cands.map((q) => bestCyclicMaxErrPx(q, t)));
      if (!(err <= o.tolPx)) {
        misses.push(
          `frame ${frame} id ${t.id} cell ${t.minCellPx.toFixed(2)} px err ${err.toFixed(2)} px`,
        );
      }
    }
  }
  expect(instances, `seed ${o.seed}`).toBeGreaterThanOrEqual(o.minInstances);
  expect(misses, `seed ${o.seed}: missed candidates`).toEqual([]);
}

// heavy seeded renders: when the whole suite runs in parallel they can land on efficiency cores
describe('detector candidates (D1)', { timeout: 120_000 }, () => {
  it('finds every tag quad at ≥ 3 px/cell, tilt ≤ 60° (full resolution)', () => {
    candidateRecall({
      seed: 101,
      decimate: 1,
      minCellPx: 3,
      distanceMm: [250, 650],
      minInstances: 200,
      tolPx: 2,
    });
  });

  it('finds every tag quad at ≥ 6 px/cell, tilt ≤ 60° (decimate 2)', () => {
    candidateRecall({
      seed: 102,
      decimate: 2,
      minCellPx: 6,
      distanceMm: [180, 350],
      minInstances: 200,
      tolPx: 3,
    });
  });

  it('does not crash on degenerate frames', () => {
    const rng = mulberry32(5);
    const sizes: [number, number][] = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
      [1, 7],
      [7, 5],
      [9, 4],
      [641, 479],
      [33, 31],
    ];
    for (const decimate of [1, 2] as const) {
      const det = new TagDetector({
        width: 1,
        height: 1,
        family: 'tag36h11',
        ids: 'all',
        decimate,
      });
      for (const [w, h] of sizes) {
        for (const fill of ['black', 'white', 'noise', 'stripes'] as const) {
          const data = new Uint8Array(w * h);
          for (let i = 0; i < data.length; i++) {
            const x = i % w;
            data[i] =
              fill === 'black'
                ? 0
                : fill === 'white'
                  ? 255
                  : fill === 'noise'
                    ? Math.floor(rng() * 256)
                    : (x >> 2) & 1
                      ? 220
                      : 20;
          }
          const img: GrayImage = { width: w, height: h, data };
          expect(() => det.detect(img), `${w}×${h} ${fill} d${decimate}`).not.toThrow();
          expect(det.detect(img)).toEqual([]);
        }
      }
    }
  });

  it('rejects data shorter than width × height', () => {
    const det = new TagDetector({ width: 4, height: 4, family: 'tag36h11', ids: 'all' });
    expect(() => det.detect({ width: 4, height: 4, data: new Uint8Array(15) })).toThrow(/shorter/);
  });

  it('reuses its buffers across calls and reallocates only on a size change', () => {
    const rng = mulberry32(9);
    const board = gridBoard(rng, pickIds(rng, 9), {
      cols: 3,
      rows: 3,
      pitchMm: 60,
      sizeMm: [28, 32],
    });
    const k = intrinsicsFromFov(320, 240, 65);
    const frames = [0, 1, 2].map((i) =>
      renderBoard({
        board,
        intrinsics: k,
        boardFromCamera: randomViewPose(rng, { distanceMm: [200, 260], tiltDeg: [0, 40] }),
        blurSigmaPx: 0.8,
        noiseSigma: 2,
        seed: i + 1,
        supersample: 2,
      }),
    );
    for (const decimate of [1, 2] as const) {
      const det = new TagDetector({
        width: 320,
        height: 240,
        family: 'tag36h11',
        ids: 'all',
        decimate,
      });
      expect(det.allocations).toBe(1);
      for (let i = 0; i < 6; i++) det.detect(frames[i % 3]!);
      expect(det.allocations).toBe(1);
      det.detect({ width: 160, height: 120, data: new Uint8Array(160 * 120) });
      expect(det.allocations).toBe(2);
      det.detect(frames[0]!);
      expect(det.allocations).toBe(3);
    }
  });
});
