import { describe, expect, it } from 'vitest';
import { mat3Det, mat4InvertRigid, mat4Mul, mat4MulVec4, maxAbsDiff } from '../math/index.js';
import {
  intrinsicsFromFov,
  lookAtPose,
  projectBoardPoint,
  randomViewPose,
} from '../synth/camera.js';
import { mulberry32 } from '../synth/random.js';
import type { CameraIntrinsics, Mat4, Vec3 } from '../types.js';
import {
  boardFromCameraGl,
  cameraFromBoardCv,
  cvToGlPoint,
  glToCvPoint,
  projectionFromIntrinsics,
} from './frames.js';

const SEED = 4242;

function randomIntrinsics(rng: () => number): CameraIntrinsics {
  const portrait = rng() < 0.5;
  const w = portrait ? 720 : 1280;
  const h = portrait ? 1280 : 720;
  const k = intrinsicsFromFov(w, h, 50 + rng() * 30);
  // off-centre principal point and non-square pixels so the test sees every term
  return {
    ...k,
    fy: k.fx * (0.98 + rng() * 0.04),
    cx: k.cx + (rng() - 0.5) * 40,
    cy: k.cy + (rng() - 0.5) * 40,
  };
}

/** CV pinhole projection of a board point through the solver-side (R, t). */
function projectCv(
  k: CameraIntrinsics,
  r: Float64Array,
  t: Float64Array,
  p: Vec3,
): [number, number] {
  const x = r[0]! * p[0] + r[1]! * p[1] + r[2]! * p[2] + t[0]!;
  const y = r[3]! * p[0] + r[4]! * p[1] + r[5]! * p[2] + t[1]!;
  const z = r[6]! * p[0] + r[7]! * p[1] + r[8]! * p[2] + t[2]!;
  return [k.fx * (x / z) + k.cx, k.fy * (y / z) + k.cy];
}

describe('CV ↔ GL frames', () => {
  it('round-trips boardFromCamera (GL) ↔ cameraFromBoard (CV) to 1e-12', () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < 200; i++) {
      const m = randomViewPose(rng, {
        distanceMm: [150, 900],
        tiltDeg: [0, 75],
        rollDeg: [0, 360],
      });
      const r = new Float64Array(9);
      const t = new Float64Array(3);
      cameraFromBoardCv(m, r, t);
      expect(Math.abs(mat3Det(r) - 1)).toBeLessThan(1e-12);
      expect(maxAbsDiff(boardFromCameraGl(r, t), m), `seed ${SEED} case ${i}`).toBeLessThan(1e-12);
    }
  });

  it('matches the synthetic oracle: CV projection of (R, t) = projectBoardPoint of the GL pose', () => {
    const rng = mulberry32(SEED + 1);
    for (let i = 0; i < 200; i++) {
      const k = randomIntrinsics(rng);
      const m = randomViewPose(rng, {
        distanceMm: [150, 900],
        tiltDeg: [0, 70],
        rollDeg: [0, 360],
      });
      const r = new Float64Array(9);
      const t = new Float64Array(3);
      cameraFromBoardCv(m, r, t);
      const p: Vec3 = [(rng() - 0.5) * 300, (rng() - 0.5) * 50, (rng() - 0.5) * 200];
      const want = projectBoardPoint(k, m, p);
      if (!want) continue;
      const got = projectCv(k, r, t, p);
      expect(
        Math.abs(got[0] - want[0]) + Math.abs(got[1] - want[1]),
        `seed ${SEED + 1} case ${i}`,
      ).toBeLessThan(1e-9);
    }
  });

  it('a camera above the board looking down: CV +Y is board +Z (down the page), GL −Z is board −Y', () => {
    const m = lookAtPose([0, 500, 0], [0, 0, 0]);
    const r = new Float64Array(9);
    const t = new Float64Array(3);
    cameraFromBoardCv(m, r, t);
    // CV camera axes in board coordinates are the rows of R
    expect(Array.from(r).map((v) => v + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, -1, 0]);
    expect(Array.from(t).map((v) => v + 0)).toEqual([0, 0, 500]);
    expect(Array.from(cvToGlPoint([1, 2, 3]))).toEqual([1, -2, -3]);
    expect(Array.from(glToCvPoint(cvToGlPoint([1, 2, 3])))).toEqual([1, 2, 3]);
  });
});

describe('projectionFromIntrinsics', () => {
  it('matches pinhole u, v to 1e-9 px (portrait and landscape, off-centre principal point)', () => {
    const rng = mulberry32(SEED + 2);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      const k = randomIntrinsics(rng);
      const m = randomViewPose(rng, {
        distanceMm: [150, 900],
        tiltDeg: [0, 70],
        rollDeg: [0, 360],
      });
      const proj = projectionFromIntrinsics(k, 10, 5000);
      const clipFromBoard = mat4Mul(proj, mat4InvertRigid(m));
      for (let j = 0; j < 5; j++) {
        const p: Vec3 = [(rng() - 0.5) * 300, rng() * 100, (rng() - 0.5) * 200];
        const want = projectBoardPoint(k, m, p);
        if (!want) continue;
        const c = mat4MulVec4(clipFromBoard, [p[0], p[1], p[2], 1]);
        const ndcX = c[0]! / c[3]!;
        const ndcY = c[1]! / c[3]!;
        // NDC x = 2(u + 0.5)/w − 1, NDC y = 1 − 2(v + 0.5)/h
        const u = ((ndcX + 1) * k.width) / 2 - 0.5;
        const v = ((1 - ndcY) * k.height) / 2 - 0.5;
        const err = Math.hypot(u - want[0], v - want[1]);
        worst = Math.max(worst, err);
        expect(err, `seed ${SEED + 2} case ${i}`).toBeLessThan(1e-9);
      }
    }
    console.log(`projectionFromIntrinsics: max error ${worst.toExponential(1)} px`);
  });

  it('equals the ARCHITECTURE.md §2.6 matrix and maps the image edges to NDC ±1', () => {
    const k: CameraIntrinsics = { width: 1280, height: 720, fx: 1000, fy: 990, cx: 650, cy: 350 };
    const n = 20;
    const f = 4000;
    const p = projectionFromIntrinsics(k, n, f);
    // prettier-ignore
    const want: Mat4 = Float64Array.of(
      (2 * k.fx) / k.width, 0, 0, 0,
      0, (2 * k.fy) / k.height, 0, 0,
      1 - (2 * (k.cx + 0.5)) / k.width, (2 * (k.cy + 0.5)) / k.height - 1, -(f + n) / (f - n), -1,
      0, 0, (-2 * f * n) / (f - n), 0,
    );
    expect(maxAbsDiff(p, want)).toBeLessThan(1e-15);
    // GL camera point through the top-left image corner (−0.5, −0.5) at depth d
    const d = 300;
    const tl = mat4MulVec4(p, [((-0.5 - k.cx) / k.fx) * d, -((-0.5 - k.cy) / k.fy) * d, -d, 1]);
    expect(tl[0]! / tl[3]!).toBeCloseTo(-1, 12);
    expect(tl[1]! / tl[3]!).toBeCloseTo(1, 12);
    const br = mat4MulVec4(p, [
      ((k.width - 0.5 - k.cx) / k.fx) * d,
      -((k.height - 0.5 - k.cy) / k.fy) * d,
      -d,
      1,
    ]);
    expect(br[0]! / br[3]!).toBeCloseTo(1, 12);
    expect(br[1]! / br[3]!).toBeCloseTo(-1, 12);
    // depth: near → −1, far → +1
    const zn = mat4MulVec4(p, [0, 0, -n, 1]);
    const zf = mat4MulVec4(p, [0, 0, -f, 1]);
    expect(zn[2]! / zn[3]!).toBeCloseTo(-1, 12);
    expect(zf[2]! / zf[3]!).toBeCloseTo(1, 12);
    expect(() => projectionFromIntrinsics(k, 0, 10)).toThrow();
    expect(() => projectionFromIntrinsics(k, 10, 10)).toThrow();
  });
});
