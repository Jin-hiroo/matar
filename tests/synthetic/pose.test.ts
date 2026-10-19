/**
 * Pose accuracy over seeded random views (TASKS.md P2–P4). Corners come from
 * the synthetic projection oracle (`projectBoardCorners`) plus Gaussian noise;
 * no rendering, so these isolate the pose stage.
 */
import { describe, expect, it } from 'vitest';
import { estimatePose } from '../../src/pose/index.js';
import { intrinsicsFromFov, randomViewPose } from '../../src/synth/camera.js';
import { mulberry32, normalSampler } from '../../src/synth/random.js';
import type { Vec3 } from '../../src/types.js';
import {
  a4Ring12,
  fmt,
  observe,
  overlayErrorMm,
  poseError,
  quantile,
  rms,
  singleTag,
} from './pose-helpers.js';

const LONG = !!process.env.MATAR_LONG;
const K = intrinsicsFromFov(1280, 720, 65); // f ≈ 1004.6 px
const A4 = a4Ring12();

describe('P2 IPPE + LM', () => {
  it('recovers the pose from exact correspondences to 1e-6 mm / 1e-6°', () => {
    const seed = 101;
    const rng = mulberry32(seed);
    const boards = [A4, singleTag(40)];
    let worstPos = 0;
    let worstRot = 0;
    let cases = 0;
    for (let i = 0; i < 400; i++) {
      const board = boards[i % 2]!;
      const truth = randomViewPose(rng, {
        distanceMm: board === A4 ? [300, 700] : [150, 500],
        tiltDeg: [0, 65],
        targetBoxMm: { min: [-20, -20], max: [20, 20] },
        rollDeg: [0, 360],
      });
      const dets = observe(board, K, truth, null, 0);
      if (dets.length === 0) continue;
      const pose = estimatePose(dets, board, K);
      expect(pose, `seed ${seed} case ${i}`).not.toBeNull();
      const e = poseError(pose!.boardFromCamera, truth);
      worstPos = Math.max(worstPos, e.posMm);
      worstRot = Math.max(worstRot, e.rotDeg);
      expect(e.posMm, `seed ${seed} case ${i}`).toBeLessThan(1e-6);
      expect(e.rotDeg, `seed ${seed} case ${i}`).toBeLessThan(1e-6);
      expect(pose!.rmsErrPx).toBeLessThan(1e-6);
      cases++;
    }
    expect(cases).toBeGreaterThanOrEqual(200);
    console.log(
      `P2 exact (${cases} cases): max position ${fmt(worstPos)} mm, max rotation ${fmt(worstRot)}°`,
    );
  });

  it('12-tag A4 board at 40 cm, tilt 20–50°, σ = 0.15 px: position ≤ 0.5 mm, rotation ≤ 0.1°, overlay at 100 mm ≤ 0.3 mm (RMS)', () => {
    const seed = 202;
    const rng = mulberry32(seed);
    const noise = normalSampler(mulberry32(seed + 1));
    const n = LONG ? 5000 : 500;
    const pos: number[] = [];
    const rot: number[] = [];
    const overlay: number[] = [];
    const tags: number[] = [];
    const above: Vec3 = [0, 100, 0];
    for (let i = 0; i < n; i++) {
      const truth = randomViewPose(rng, {
        distanceMm: [400, 400],
        tiltDeg: [20, 50],
        targetBoxMm: { min: [-10, -10], max: [10, 10] },
        rollDeg: [-15, 15],
      });
      const dets = observe(A4, K, truth, noise, 0.15);
      const pose = estimatePose(dets, A4, K);
      expect(pose, `seed ${seed} case ${i}`).not.toBeNull();
      expect(pose!.rejectedTagIds, `seed ${seed} case ${i}`).toEqual([]);
      const e = poseError(pose!.boardFromCamera, truth);
      pos.push(e.posMm);
      rot.push(e.rotDeg);
      overlay.push(overlayErrorMm(K, pose!.boardFromCamera, truth, above));
      tags.push(dets.length);
    }
    const r = { pos: rms(pos), rot: rms(rot), overlay: rms(overlay) };
    console.log(
      `P2 noisy (${n} cases, seed ${seed}, ${quantile(tags, 0)}–${quantile(tags, 1)} tags, median ${quantile(tags, 0.5)}): ` +
        `position RMS ${fmt(r.pos)} mm (p99 ${fmt(quantile(pos, 0.99))}), rotation RMS ${fmt(r.rot)}° ` +
        `(p99 ${fmt(quantile(rot, 0.99))}), overlay at 100 mm RMS ${fmt(r.overlay)} mm (p99 ${fmt(quantile(overlay, 0.99))})`,
    );
    expect(r.pos, `seed ${seed}`).toBeLessThanOrEqual(0.5);
    expect(r.rot, `seed ${seed}`).toBeLessThanOrEqual(0.1);
    expect(r.overlay, `seed ${seed}`).toBeLessThanOrEqual(0.3);
  });
});
