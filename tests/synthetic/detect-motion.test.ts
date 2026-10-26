/**
 * Motion blur (device test 2026-10-21: whole frames without a tag while moving
 * the phone). 32 mm tags at 42 cm, f = 948.8 px (the 720 × 1280 portrait
 * prior): 9 px cells. The camera slides during the exposure so the image moves
 * 12 or 14 px, more than a cell, vertically and sideways. ≥ 90 % of the tags
 * must be found, with the right IDs and corners near the mid-exposure ones.
 * With the threshold at the encoded midpoint (before `linearMidpointTable`)
 * this found 16 / 32 (and none of a full 720 × 1280 demo-board frame from
 * 12 px): the blurred black border faded past a threshold at ≈ 20 % of the
 * ink-to-paper range in linear light.
 */
import { describe, expect, it } from 'vitest';
import { createDetector } from '../../src/detect/index.js';
import { intrinsicsFromFov, lookAtPose, mulberry32, renderBoard } from '../../src/synth/index.js';
import type { Board, CameraIntrinsics, Mat4 } from '../../src/types.js';
import { cornerErrorsPx, gridBoard, pickIds, rms, tagTruths } from './detect-helpers.js';

const F = 948.8;
const K: CameraIntrinsics = { width: 400, height: 400, fx: F, fy: F, cx: 199.5, cy: 199.5 };
const D_MM = 420;

describe('detector under motion blur', { timeout: 120_000 }, () => {
  it('finds ≥ 90 % of the tags with 12–14 px of vertical or sideways blur (9 px cells)', () => {
    const rng = mulberry32(1021);
    const board = gridBoard(rng, pickIds(rng, 4), {
      cols: 2,
      rows: 2,
      pitchMm: 60,
      sizeMm: [32, 32],
    });
    const ids = board.tags.map((t) => t.id);
    const truths = tagTruths(board, K, lookAtPose([0, D_MM, 0], [0, 0, 0]));
    let instances = 0;
    let found = 0;
    const wrong: number[] = [];
    const errsPx: number[] = [];
    for (const dir of ['vertical', 'sideways'] as const) {
      for (const blurPx of [12, 14]) {
        const mm = blurPx / (F / D_MM); // camera travel during the exposure
        const poses: Mat4[] = [];
        for (let i = 0; i <= blurPx; i++) {
          const s = (i / blurPx - 0.5) * mm;
          const x = dir === 'sideways' ? s : 0;
          const z = dir === 'vertical' ? s : 0;
          poses.push(lookAtPose([x, D_MM, z], [x, 0, z]));
        }
        const img = renderBoard({
          board,
          intrinsics: K,
          boardFromCamera: poses,
          blurSigmaPx: 0.8,
          noiseSigma: 2,
          supersample: 4,
          seed: blurPx,
        });
        for (const decimate of [1, 2] as const) {
          const dets = createDetector({
            width: K.width,
            height: K.height,
            family: 'tag36h11',
            ids,
            decimate,
          }).detect(img);
          instances += ids.length;
          for (const d of dets) {
            const t = truths.find((tt) => tt.id === d.id);
            if (!t) {
              wrong.push(d.id);
              continue;
            }
            found++;
            errsPx.push(...cornerErrorsPx(d, t));
          }
        }
      }
    }
    const maxErr = Math.max(...errsPx);
    const msg = `${found}/${instances} found, corners rms ${rms(errsPx).toFixed(2)} px, max ${maxErr.toFixed(2)} px`;
    console.log(`motion blur: ${msg}`);
    expect(wrong, msg).toEqual([]);
    expect(found / instances, msg).toBeGreaterThanOrEqual(0.9);
    // a ramp this long is wider than the refiner's search, so corners stay near the thresholded edge
    expect(rms(errsPx), msg).toBeLessThan(1.5);
    expect(maxErr, msg).toBeLessThan(5);
  });
});

describe('detector in dark, noisy, low-contrast frames', { timeout: 120_000 }, () => {
  // Codex review of the linear-light threshold: ink 10 / paper 50 DN, blur σ 2 px,
  // noise 4 DN. The encoded midpoint found 80 / 100; a pure linear midpoint 14 DN
  // below paper let noise break the white ring (58 / 100). The 24 DN white margin
  // keeps the encoded midpoint there.
  it('finds as many tags as the encoded midpoint did (≥ 75 / 100)', () => {
    const board: Board = {
      family: 'tag36h11',
      tags: [{ id: 12, centerMm: [0, 0], sizeMm: 32, rotationDeg: 17 }],
    };
    const k = intrinsicsFromFov(240, 240, 65);
    const det = createDetector({
      width: 240,
      height: 240,
      family: 'tag36h11',
      ids: [12],
      decimate: 1,
    });
    let found = 0;
    for (let seed = 100; seed < 200; seed++) {
      const img = renderBoard({
        board,
        intrinsics: k,
        boardFromCamera: lookAtPose([0, 180, 0], [0, 0, 0]),
        inkLevel: 10,
        paperLevel: 50,
        blurSigmaPx: 2,
        noiseSigma: 4,
        supersample: 2,
        seed,
      });
      const d = det.detect(img);
      expect(d.every((x) => x.id === 12)).toBe(true);
      if (d.length) found++;
    }
    expect(found).toBeGreaterThanOrEqual(75);
  });
});
