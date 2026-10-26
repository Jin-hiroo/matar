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
  lookAtPose,
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

describe('detect → pose under motion blur', () => {
  // The demo's view: 720 × 1280 portrait, the 68° prior, 420 mm straight down,
  // so 9 px cells. 16 px of blur stretches every tag by ≈ 3.5 px per side
  // along the motion (centres stay put). The full-resolution search is the
  // worst case ('auto' runs it after a frame without tags). Before the
  // consensus had its relaxed pass, 5 of 11–13 tags were kept and the camera was
  // 26–58 mm and 3–8° off (content 100 mm above the paper: 19–38 px); now
  // 1.6–3.1 mm and 0.2–0.4° (1–3 px).
  const pw = 720;
  const ph = 1280;
  const k = focalPrior(pw, ph, 68);
  const dMm = 420;
  const truth = lookAtPose([0, dMm, 0], [0, 0, 0]);
  for (const dir of ['sideways', 'vertical'] as const) {
    it(
      `keeps every tag and the pose with 16 px of ${dir} blur`,
      () => {
        const blurPx = 16;
        const mm = (blurPx * dMm) / k.fx; // camera travel during the exposure
        const poses: Mat4[] = [];
        for (let i = 0; i <= blurPx; i++) {
          const s = (i / blurPx - 0.5) * mm;
          const x = dir === 'sideways' ? s : 0;
          const z = dir === 'vertical' ? s : 0;
          poses.push(lookAtPose([x, dMm, z], [x, 0, z]));
        }
        const img = renderBoard({
          board,
          intrinsics: k,
          boardFromCamera: poses,
          pageMm,
          blurSigmaPx: 0.8,
          noiseSigma: 2,
          supersample: 4,
          seed: 16,
        });
        const dets = createDetector({
          width: pw,
          height: ph,
          family: board.family,
          ids: board.tags.map((t) => t.id),
          decimate: 1,
        }).detect(img);
        const pose = estimatePose(dets, board, k);
        expect(pose).not.toBeNull();
        const e = poseError(pose!.boardFromCamera, truth);
        console.log(
          `pipeline, ${blurPx} px ${dir} blur: ${pose!.usedTagIds.length}/${dets.length} tags, ${e.mm.toFixed(2)} mm, ${e.deg.toFixed(2)}°, rms ${pose!.rmsErrPx.toFixed(2)} px`,
        );
        expect(dets.length).toBeGreaterThanOrEqual(8);
        expect(pose!.rejectedTagIds).toEqual([]);
        expect(e.mm).toBeLessThan(5);
        expect(e.deg).toBeLessThan(0.6);
      },
      SLOW_MS,
    );
  }
});
