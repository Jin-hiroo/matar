import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  homographyDlt,
  mat3Det,
  mat3MulTransposeA,
  maxAbsDiff,
  rotationAngleBetween,
  rotationFromAxisAngle,
} from '../math/index.js';
import { intrinsicsFromFov, randomViewPose } from '../synth/camera.js';
import { mulberry32 } from '../synth/random.js';
import { cameraFromBoardCv } from './frames.js';
import { ippeRotations, ippeTranslation } from './ippe.js';
import { PoseProblem, refinePose } from './refine.js';

const K = intrinsicsFromFov(1280, 720, 65);

/** n random model-plane points (centred), their normalised images under (R, t), and the homography. */
function planarCase(rng: () => number) {
  const m = randomViewPose(rng, { distanceMm: [200, 600], tiltDeg: [5, 70], rollDeg: [0, 360] });
  const r = new Float64Array(9);
  const t = new Float64Array(3);
  cameraFromBoardCv(m, r, t);
  // model frame (a, b, a × b) = (board x, board z, −board y): R_model = [r_x, r_z, −r_y]
  const rm = Float64Array.of(r[0]!, r[2]!, -r[1]!, r[3]!, r[5]!, -r[4]!, r[6]!, r[8]!, -r[7]!);
  const n = 4 + Math.floor(rng() * 12);
  const model = new Float64Array(2 * n);
  const img = new Float64Array(2 * n);
  let ca = 0;
  let cb = 0;
  for (let i = 0; i < n; i++) {
    model[2 * i] = (rng() - 0.5) * 60;
    model[2 * i + 1] = (rng() - 0.5) * 60;
    ca += model[2 * i]! / n;
    cb += model[2 * i + 1]! / n;
  }
  for (let i = 0; i < n; i++) {
    model[2 * i] = model[2 * i]! - ca;
    model[2 * i + 1] = model[2 * i + 1]! - cb;
  }
  for (let i = 0; i < n; i++) {
    const a = model[2 * i]!;
    const b = model[2 * i + 1]!;
    const X = rm[0]! * a + rm[1]! * b + t[0]!;
    const Y = rm[3]! * a + rm[4]! * b + t[1]!;
    const Z = rm[6]! * a + rm[7]! * b + t[2]!;
    img[2 * i] = X / Z;
    img[2 * i + 1] = Y / Z;
  }
  return { rm, t, n, model, img };
}

describe('IPPE', () => {
  it('returns two rotations, one of them the true pose (exact data)', () => {
    const seed = 77;
    const rng = mulberry32(seed);
    for (let i = 0; i < 200; i++) {
      const { rm, t, n, model, img } = planarCase(rng);
      const h = homographyDlt(model, img, n)!;
      const r1 = new Float64Array(9);
      const r2 = new Float64Array(9);
      expect(ippeRotations(h, r1, r2), `seed ${seed} case ${i}`).toBe(true);
      for (const r of [r1, r2]) {
        const rtr = mat3MulTransposeA(r, r);
        expect(maxAbsDiff(rtr, [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeLessThan(1e-12);
        expect(Math.abs(mat3Det(r) - 1)).toBeLessThan(1e-12);
      }
      const e1 = rotationAngleBetween(r1, rm);
      const e2 = rotationAngleBetween(r2, rm);
      const best = e1 < e2 ? r1 : r2;
      expect(Math.min(e1, e2), `seed ${seed} case ${i}`).toBeLessThan(1e-9);
      const tt = new Float64Array(3);
      expect(ippeTranslation(best, model, img, n, tt)).toBe(true);
      expect(maxAbsDiff(tt, t) / t[2]!, `seed ${seed} case ${i}`).toBeLessThan(1e-9);
      // both solutions share the depth of the model origin and its image (first-order equivalent)
      const t2 = new Float64Array(3);
      ippeTranslation(best === r1 ? r2 : r1, model, img, n, t2);
      expect(Number.isFinite(t2[2]!)).toBe(true);
      const p = new Float64Array(2);
      applyHomography(h, 0, 0, p);
      expect(Math.abs(p[0]! - t[0]! / t[2]!)).toBeLessThan(1e-9);
    }
  });

  it('rejects degenerate homographies', () => {
    const r1 = new Float64Array(9);
    const r2 = new Float64Array(9);
    expect(ippeRotations(Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0), r1, r2)).toBe(false);
    expect(ippeRotations(new Float64Array(9).fill(NaN), r1, r2)).toBe(false);
  });
});

describe('LM pose refinement', () => {
  function boardCase(rng: () => number) {
    const m = randomViewPose(rng, { distanceMm: [250, 500], tiltDeg: [10, 60], rollDeg: [0, 360] });
    const r = new Float64Array(9);
    const t = new Float64Array(3);
    cameraFromBoardCv(m, r, t);
    const n = 24;
    const xz = new Float64Array(2 * n);
    const px = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      const x = (rng() - 0.5) * 200;
      const z = (rng() - 0.5) * 150;
      xz[2 * i] = x;
      xz[2 * i + 1] = z;
      const X = r[0]! * x + r[2]! * z + t[0]!;
      const Y = r[3]! * x + r[5]! * z + t[1]!;
      const Z = r[6]! * x + r[8]! * z + t[2]!;
      px[2 * i] = (K.fx * X) / Z + K.cx;
      px[2 * i + 1] = (K.fy * Y) / Z + K.cy;
    }
    return { r, t, n, xz, px };
  }

  it('analytic gradient matches finite differences (quadratic and Huber regions)', () => {
    const rng = mulberry32(88);
    const p = new PoseProblem();
    const jtj = new Float64Array(36);
    const jtr = new Float64Array(6);
    for (let i = 0; i < 50; i++) {
      const { r, t, n, xz, px } = boardCase(rng);
      // perturbed start: small (all residuals < δ) or large (Huber region)
      const big = i % 2 === 1;
      const dr = rotationFromAxisAngle(
        [rng() * 1e-3, -rng() * 1e-3, rng() * 1e-3].map((v) => (big ? 20 * v : v)),
      );
      const r0 = new Float64Array(9);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += dr[3 * a + c]! * r[3 * c + b]!;
          r0[3 * a + b] = s;
        }
      }
      const t0 = Float64Array.of(t[0]! + (big ? 3 : 0.1), t[1]!, t[2]! - (big ? 5 : 0.1));
      p.set(xz, px, n, K, r0, t0);
      const c0 = p.linearize(jtj, jtr);
      expect(c0).toBeCloseTo(p.cost(), 9);
      for (let k = 0; k < 6; k++) {
        const h = k < 3 ? 1e-7 : 1e-5;
        const step = new Float64Array(6);
        step[k] = h;
        const cp = p.tryStep(step);
        step[k] = -h;
        const cm = p.tryStep(step);
        const g = (cp - cm) / (2 * h);
        expect(
          Math.abs(g - jtr[k]!) / Math.max(1, Math.abs(g)),
          `case ${i} param ${k}`,
        ).toBeLessThan(1e-4);
      }
    }
  });

  it('converges from a perturbed start to the exact pose within 10 iterations', () => {
    const rng = mulberry32(99);
    const p = new PoseProblem();
    for (let i = 0; i < 200; i++) {
      const { r, t, n, xz, px } = boardCase(rng);
      const dr = rotationFromAxisAngle([
        (rng() - 0.5) * 0.04,
        (rng() - 0.5) * 0.04,
        (rng() - 0.5) * 0.04,
      ]);
      const r0 = new Float64Array(9);
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          let s = 0;
          for (let c = 0; c < 3; c++) s += dr[3 * a + c]! * r[3 * c + b]!;
          r0[3 * a + b] = s;
        }
      }
      const t0 = Float64Array.of(
        t[0]! + (rng() - 0.5) * 10,
        t[1]! + (rng() - 0.5) * 10,
        t[2]! + (rng() - 0.5) * 20,
      );
      p.set(xz, px, n, K, r0, t0);
      const res = refinePose(p);
      expect(res.iterations, `seed 99 case ${i}`).toBeLessThanOrEqual(10);
      expect(rotationAngleBetween(p.r, r), `seed 99 case ${i}`).toBeLessThan(1e-9);
      expect(maxAbsDiff(p.t, t), `seed 99 case ${i}`).toBeLessThan(1e-6);
    }
  });
});
