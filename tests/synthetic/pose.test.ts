/**
 * Pose accuracy over seeded random views (TASKS.md P2–P4). Corners come from
 * the synthetic projection oracle (`projectBoardCorners`) plus Gaussian noise;
 * no rendering, so these isolate the pose stage.
 */
import { describe, expect, it } from 'vitest';
import { boardTagCornersMm } from '../../src/board/corners.js';
import {
  homographyDlt,
  mat3Mul,
  mat4FromRotationTranslation,
  mat4GetRotation,
  rotationAngleBetween,
  rotationFromAxisAngle,
} from '../../src/math/index.js';
import {
  boardFromCameraGl,
  cameraFromBoardCv,
  estimatePose,
  ippeRotations,
  ippeTranslation,
} from '../../src/pose/index.js';
import { intrinsicsFromFov, randomViewPose } from '../../src/synth/camera.js';
import { mulberry32, normalSampler } from '../../src/synth/random.js';
import type { Board, Mat4, Vec3 } from '../../src/types.js';
import {
  a4Ring12,
  DEG,
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

/** truth with its rotation perturbed by `deg` about a random axis (camera position kept) */
function perturbRotation(truth: Mat4, deg: number, g: () => number): Mat4 {
  const ax = [g(), g(), g()];
  const n = Math.hypot(ax[0]!, ax[1]!, ax[2]!);
  const dR = rotationFromAxisAngle(ax.map((v) => (v / n) * deg * DEG));
  return mat4FromRotationTranslation(mat3Mul(mat4GetRotation(truth), dR), [
    truth[12]!,
    truth[13]!,
    truth[14]!,
  ]);
}

/**
 * The other IPPE branch for an exact view of a tag at the board origin, as a
 * `boardFromCamera` (GL): the mirror solution of the planar ambiguity.
 */
function mirrorPose(board: Board, truth: Mat4): Mat4 {
  const dets = observe(board, K, truth, null, 0, -1e9);
  const corners = boardTagCornersMm(board.tags[0]!);
  const model = Float64Array.from(corners.flat());
  const norm = Float64Array.from(
    dets[0]!.corners.flatMap(([u, v]) => [(u - K.cx) / K.fx, (v - K.cy) / K.fy]),
  );
  const h = homographyDlt(model, norm, 4)!;
  const r1 = new Float64Array(9);
  const r2 = new Float64Array(9);
  ippeRotations(h, r1, r2);
  const rTrue = new Float64Array(9);
  const tTrue = new Float64Array(3);
  cameraFromBoardCv(truth, rTrue, tTrue);
  // model axes (board x, board z): R_cb = [r_a, r_b × r_a, r_b]
  const toBoard = (rm: Float64Array) => {
    const r = new Float64Array(9);
    for (let i = 0; i < 3; i++) {
      r[3 * i] = rm[3 * i]!;
      r[3 * i + 2] = rm[3 * i + 1]!;
    }
    r[1] = r[5]! * r[6]! - r[8]! * r[3]!;
    r[4] = r[8]! * r[0]! - r[2]! * r[6]!;
    r[7] = r[2]! * r[3]! - r[5]! * r[0]!;
    return r;
  };
  const b1 = toBoard(r1);
  const b2 = toBoard(r2);
  const wrong = rotationAngleBetween(b1, rTrue) > rotationAngleBetween(b2, rTrue) ? r1 : r2;
  const t = new Float64Array(3);
  ippeTranslation(wrong, model, norm, 4, t);
  return boardFromCameraGl(toBoard(wrong), t);
}

describe('P3 planar ambiguity', () => {
  const TAG40 = singleTag(40);
  // correct branch: rotation error < 10°; the mirror branch is ≈ 2 × tilt ≥ 40° away
  const CORRECT_DEG = 10;

  it('single 40 mm tag at 30 cm, tilt 20–60°, σ = 0.15 px, previous = truth ⊕ 2°: ≥ 99 % correct branch, board overlay ≤ 1 mm', () => {
    const seed = 303;
    const rng = mulberry32(seed);
    const noise = normalSampler(mulberry32(seed + 1));
    const g = normalSampler(mulberry32(seed + 2));
    const n = LONG ? 10000 : 1000;
    let correct = 0;
    let correctNoPrev = 0;
    const rot: number[] = [];
    const overlay: number[] = [];
    const ring: Vec3[] = [[0, 0, 0]];
    for (const rad of [40, 100]) {
      for (let j = 0; j < 8; j++)
        ring.push([rad * Math.cos((j * Math.PI) / 4), 0, rad * Math.sin((j * Math.PI) / 4)]);
    }
    for (let i = 0; i < n; i++) {
      const truth = randomViewPose(rng, {
        distanceMm: [300, 300],
        tiltDeg: [20, 60],
        targetBoxMm: { min: [-15, -15], max: [15, 15] },
        rollDeg: [0, 360],
      });
      const prev = perturbRotation(truth, 2, g);
      const dets = observe(TAG40, K, truth, noise, 0.15);
      expect(dets.length, `seed ${seed} case ${i}`).toBe(1);
      const pose = estimatePose(dets, TAG40, K, prev);
      expect(pose, `seed ${seed} case ${i}`).not.toBeNull();
      const e = poseError(pose!.boardFromCamera, truth).rotDeg;
      if (e < CORRECT_DEG) {
        correct++;
        rot.push(e);
      }
      const noPrev = estimatePose(dets, TAG40, K)!;
      if (poseError(noPrev.boardFromCamera, truth).rotDeg < CORRECT_DEG) correctNoPrev++;
      // worst overlay error over the tag centre and rings of 40 and 100 mm on the board
      overlay.push(
        Math.max(...ring.map((p) => overlayErrorMm(K, pose!.boardFromCamera, truth, p))),
      );
    }
    console.log(
      `P3 (${n} cases, seed ${seed}): correct branch ${((100 * correct) / n).toFixed(2)} % ` +
        `(without previous ${((100 * correctNoPrev) / n).toFixed(2)} %), rotation error p99 ${fmt(quantile(rot, 0.99))}°, ` +
        `board overlay (max over centre + 40/100 mm rings) RMS ${fmt(rms(overlay))} mm, p99 ${fmt(quantile(overlay, 0.99))} mm`,
    );
    expect(correct / n, `seed ${seed}`).toBeGreaterThanOrEqual(0.99);
    expect(rms(overlay), `seed ${seed}`).toBeLessThanOrEqual(1);
  });

  it('a wrong previous pose does not override clear image evidence', () => {
    const seed = 304;
    const rng = mulberry32(seed);
    const noise = normalSampler(mulberry32(seed + 1));
    let correct = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const truth = randomViewPose(rng, {
        distanceMm: [300, 300],
        tiltDeg: [20, 60],
        rollDeg: [0, 360],
      });
      const wrong = mirrorPose(TAG40, truth);
      expect(poseError(wrong, truth).rotDeg, `seed ${seed} case ${i}`).toBeGreaterThan(30);
      const pose = estimatePose(observe(TAG40, K, truth, noise, 0.15), TAG40, K, wrong)!;
      if (poseError(pose.boardFromCamera, truth).rotDeg < CORRECT_DEG) correct++;
    }
    console.log(`P3 previous = mirror branch: correct ${((100 * correct) / n).toFixed(1)} %`);
    expect(correct / n, `seed ${seed}`).toBeGreaterThanOrEqual(0.9);
  });

  it('the previous pose decides genuinely ambiguous views (20 mm tag at 60 cm, σ = 0.3 px)', () => {
    const seed = 305;
    const rng = mulberry32(seed);
    const noise = normalSampler(mulberry32(seed + 1));
    const g = normalSampler(mulberry32(seed + 2));
    const tag20 = singleTag(20);
    const n = 500;
    let withPrev = 0;
    let without = 0;
    for (let i = 0; i < n; i++) {
      const truth = randomViewPose(rng, {
        distanceMm: [600, 600],
        tiltDeg: [20, 40],
        rollDeg: [0, 360],
      });
      const dets = observe(tag20, K, truth, noise, 0.3);
      const a = estimatePose(dets, tag20, K, perturbRotation(truth, 2, g))!;
      const b = estimatePose(dets, tag20, K)!;
      if (poseError(a.boardFromCamera, truth).rotDeg < CORRECT_DEG) withPrev++;
      if (poseError(b.boardFromCamera, truth).rotDeg < CORRECT_DEG) without++;
    }
    console.log(
      `P3 hard views (seed ${seed}): correct with previous ${((100 * withPrev) / n).toFixed(1)} %, without ${((100 * without) / n).toFixed(1)} %`,
    );
    // reported, see the report: the 1.5 ratio rule is weak with a single tag's 2 residual DoF
    expect(withPrev).toBeGreaterThan(without);
  });
});
