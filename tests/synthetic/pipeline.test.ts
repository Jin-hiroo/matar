/**
 * Detector + pose together on rendered boards (a precursor of TASKS.md I1/I2):
 * renderBoard → createDetector → estimatePose, compared with the true pose.
 * Uses the public entry points only, as an integrator would.
 */
import { describe, expect, it } from 'vitest';
import {
  createBoard,
  createDetector,
  estimatePose,
  focalPrior,
  layoutBorderTags,
  pickTagIds,
} from '../../src/index.js';
import {
  intrinsicsFromFov,
  mulberry32,
  randomViewPose,
  renderBoard,
} from '../../src/synth/index.js';
import type { Mat4 } from '../../src/types.js';

// Rendering 1280 × 720 frames dominates the run time (≈ 1.3 s each).
const VIEWS = 12;
const SLOW_MS = 120_000;
const W = 1280;
const H = 720;
const board = createBoard({
  tags: layoutBorderTags({
    areaMm: { x: 0, y: 0, width: 210, height: 297 },
    originMm: [105, 148.5],
    sizeMm: 32,
    ids: pickTagIds('tag36h11', 16, 'pipeline-test'),
  }),
});
const pageMm = { min: [-105, -148.5] as [number, number], max: [105, 148.5] as [number, number] };

// `!` below: indices 0–15 of a Mat4, and poses checked non-null just before.

/** Camera position error (mm) and rotation error (degrees) between two boardFromCamera poses. */
function poseError(a: Mat4, b: Mat4): { mm: number; deg: number } {
  const mm = Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!);
  // trace of Ra^T Rb (column-major 3×3 blocks)
  let tr = 0;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) tr += a[c * 4 + r]! * b[c * 4 + r]!;
  const deg = (Math.acos(Math.min(1, Math.max(-1, (tr - 1) / 2))) * 180) / Math.PI;
  return { mm, deg };
}

describe('detect → pose on rendered A4 boards', () => {
  const k = intrinsicsFromFov(W, H, 68);
  const detector = createDetector({
    width: W,
    height: H,
    family: board.family,
    ids: board.tags.map((t) => t.id),
  });

  it(
    'recovers the camera within 1 mm / 0.2° with known intrinsics (12 views)',
    () => {
      const rng = mulberry32(20261020);
      let worstMm = 0;
      let worstDeg = 0;
      let sumTags = 0;
      for (let i = 0; i < VIEWS; i++) {
        const truth = randomViewPose(rng, {
          distanceMm: [300, 500],
          tiltDeg: [15, 50],
          targetBoxMm: { min: [-20, -30], max: [20, 30] },
          rollDeg: [-30, 30],
        });
        const img = renderBoard({
          board,
          intrinsics: k,
          boardFromCamera: truth,
          pageMm,
          blurSigmaPx: 0.8,
          noiseSigma: 2,
          seed: i + 1,
        });
        const dets = detector.detect(img);
        const pose = estimatePose(dets, board, k);
        expect(pose, `view ${i}: no pose from ${dets.length} detections`).not.toBeNull();
        const e = poseError(pose!.boardFromCamera, truth);
        worstMm = Math.max(worstMm, e.mm);
        worstDeg = Math.max(worstDeg, e.deg);
        sumTags += pose!.usedTagIds.length;
        expect(pose!.rejectedTagIds).toEqual([]);
      }
      console.log(
        `pipeline: worst ${worstMm.toFixed(3)} mm, ${worstDeg.toFixed(3)}°, mean tags ${(sumTags / VIEWS).toFixed(1)}`,
      );
      expect(worstMm).toBeLessThan(1);
      expect(worstDeg).toBeLessThan(0.2);
    },
    SLOW_MS,
  );

  it(
    'with the 68° prior on a 65° camera the pose is off mostly in depth, as §5.5 expects',
    () => {
      const real = intrinsicsFromFov(W, H, 65);
      const prior = focalPrior(W, H, 68);
      const truth = randomViewPose(mulberry32(3), { distanceMm: [400, 400], tiltDeg: [35, 35] });
      const img = renderBoard({
        board,
        intrinsics: real,
        boardFromCamera: truth,
        pageMm,
        blurSigmaPx: 0.8,
        noiseSigma: 2,
      });
      const pose = estimatePose(detector.detect(img), board, prior);
      expect(pose).not.toBeNull();
      const e = poseError(pose!.boardFromCamera, truth);
      console.log(
        `pipeline, wrong focal (${(100 * (prior.fx / real.fx - 1)).toFixed(1)} %): ${e.mm.toFixed(1)} mm, ${e.deg.toFixed(2)}°, rms ${pose!.rmsErrPx.toFixed(2)} px`,
      );
      expect(pose!.usedTagIds.length).toBeGreaterThanOrEqual(8);
      // focal error is absorbed as depth (≈ 5.6 % of 400 mm); rotation nearly untouched
      expect(e.mm).toBeGreaterThan(10);
      expect(e.mm).toBeLessThan(35);
      expect(e.deg).toBeLessThan(0.5);
    },
    SLOW_MS,
  );
});
