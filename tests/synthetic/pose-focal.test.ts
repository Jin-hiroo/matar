/**
 * Focal-length self-calibration (TASKS.md P6, ARCHITECTURE.md §5.5).
 * Corners: `projectBoardCorners` (synthetic oracle) + Gaussian noise; poses from
 * `estimatePose` with the intrinsics in use, as the worker will do.
 * The last test runs the real pipeline on rendered frames.
 */
import { describe, expect, it } from 'vitest';
import { createBoard, layoutBorderTags, pickTagIds } from '../../src/board/index.js';
import { createDetector } from '../../src/detect/index.js';
import { createFocalEstimator, estimatePose, focalPrior } from '../../src/pose/index.js';
import { intrinsicsFromFov, lookAtPose, randomViewPose } from '../../src/synth/camera.js';
import { mulberry32, normalSampler } from '../../src/synth/random.js';
import { renderBoard } from '../../src/synth/render.js';
import type {
  Board,
  CameraIntrinsics,
  FocalEstimate,
  FocalEstimator,
  Mat4,
  Vec3,
} from '../../src/types.js';
import { DEG, fmt, observe, quantile, rms } from './pose-helpers.js';

const W = 1280;
const H = 720;
const REAL = intrinsicsFromFov(W, H, 65); // the camera
const PRIOR = focalPrior(W, H, 68); // what the tracker starts with (5.6 % short)
// A4 landscape border ring, 16 × 32 mm tags (§3.1)
const BOARD: Board = createBoard({
  tags: layoutBorderTags({
    areaMm: { x: 0, y: 0, width: 297, height: 210 },
    originMm: [148.5, 105],
    sizeMm: 32,
    ids: pickTagIds('tag36h11', 16, 'pose-focal'),
  }),
});

/** A camera at `distanceMm` from a point near the board centre, given tilt and azimuth (degrees). */
function view(distanceMm: number, tiltDeg: number, azDeg: number, target: Vec3 = [0, 0, 0]): Mat4 {
  const t = tiltDeg * DEG;
  const a = azDeg * DEG;
  return lookAtPose(
    [
      target[0] + distanceMm * Math.sin(t) * Math.cos(a),
      distanceMm * Math.cos(t),
      target[2] + distanceMm * Math.sin(t) * Math.sin(a),
    ],
    target,
  );
}

/** Offers one view of `camera` to the estimator, the way the worker does; returns its result. */
function offer(
  est: FocalEstimator,
  camera: CameraIntrinsics,
  truth: Mat4,
  noise: () => number,
  sigmaPx = 0.3,
  board: Board = BOARD,
): FocalEstimate | null {
  const dets = observe(board, camera, truth, noise, sigmaPx);
  const pose = estimatePose(dets, board, est.intrinsics);
  return pose ? est.add(pose, dets, board) : null;
}

const pctErr = (f: number, truth = REAL.fx) => 100 * (f / truth - 1);

describe('P6 focal self-calibration (σ = 0.3 px, 68° prior on a 65° camera)', () => {
  it('20 views, tilt 20–60°: f within 0.3 %', () => {
    const trials = 200;
    const errs: number[] = [];
    const kfs: number[] = [];
    for (let trial = 0; trial < trials; trial++) {
      const seed = 6000 + trial;
      const rng = mulberry32(seed);
      const noise = normalSampler(mulberry32(seed + 100000));
      const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
      let last: FocalEstimate | null = null;
      for (let i = 0; i < 20; i++) {
        const truth = randomViewPose(rng, {
          distanceMm: [300, 500],
          tiltDeg: [20, 60],
          targetBoxMm: { min: [-20, -20], max: [20, 20] },
          rollDeg: [-20, 20],
        });
        last = offer(est, REAL, truth, noise) ?? last;
      }
      expect(last, `seed ${seed}: no estimate`).not.toBeNull();
      expect(est.source).toBe('estimated');
      const e = pctErr(est.intrinsics.fx);
      expect(Math.abs(e), `seed ${seed}`).toBeLessThanOrEqual(0.3);
      expect(est.intrinsics.fy).toBe(est.intrinsics.fx);
      errs.push(e);
      kfs.push(last!.keyframes);
    }
    const abs = errs.map(Math.abs);
    console.log(
      `P6 20 views (${trials} trials): f error RMS ${fmt(rms(errs))} %, p95 ${fmt(quantile(abs, 0.95))} %, ` +
        `max ${fmt(Math.max(...abs))} %, keyframes at the last update: median ${quantile(kfs, 0.5)}`,
    );
  });

  it('3 views (≥ 10° apart), tilt 20–60°: f within 1 %', () => {
    const trials = 300;
    const errs: number[] = [];
    let accepted = 0;
    for (let trial = 0; trial < trials; trial++) {
      const seed = 7000 + trial;
      const rng = mulberry32(seed);
      const noise = normalSampler(mulberry32(seed + 100000));
      const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
      const az0 = rng() * 360;
      let last: FocalEstimate | null = null;
      for (let i = 0; i < 3; i++) {
        const truth = view(300 + rng() * 200, 20 + rng() * 40, az0 + 120 * i);
        const r = offer(est, REAL, truth, noise);
        if (i < 2) expect(r, `seed ${seed}: estimate before 3 keyframes`).toBeNull();
        last = r ?? last;
      }
      if (!last) continue; // deviation ≥ 1 %: not accepted (the prior stays in use)
      accepted++;
      expect(last.keyframes).toBe(3);
      const e = pctErr(last.intrinsics.fx);
      expect(Math.abs(e), `seed ${seed}`).toBeLessThanOrEqual(1);
      errs.push(e);
    }
    const abs = errs.map(Math.abs);
    console.log(
      `P6 3 views (${trials} trials): accepted ${accepted} (${((100 * accepted) / trials).toFixed(1)} %), ` +
        `f error RMS ${fmt(rms(errs))} %, max ${fmt(Math.max(...abs))} %`,
    );
    expect(accepted / trials).toBeGreaterThanOrEqual(0.9);
  });

  it('fronto-parallel views give no estimate', () => {
    const seed = 8000;
    const rng = mulberry32(seed);
    const noise = normalSampler(mulberry32(seed + 1));
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    for (let i = 0; i < 200; i++) {
      const truth = randomViewPose(rng, {
        distanceMm: [300, 500],
        tiltDeg: [0, 15],
        targetBoxMm: { min: [-30, -30], max: [30, 30] },
        rollDeg: [0, 360],
      });
      expect(offer(est, REAL, truth, noise), `seed ${seed} view ${i}`).toBeNull();
    }
    expect(est.source).toBe('prior');
    expect(est.stdDevPct).toBeNull();
    // even with the tilt gate off, (nearly) fronto-parallel views carry no focal information
    const open = createFocalEstimator(
      { intrinsics: PRIOR, source: 'prior' },
      { minTiltDeg: 0, minSeparationDeg: 0.5 },
    );
    let estimates = 0;
    for (let i = 0; i < 200; i++) {
      const truth = view(300 + rng() * 200, rng() * 1.5, rng() * 360, [
        (rng() - 0.5) * 60,
        0,
        (rng() - 0.5) * 60,
      ]);
      if (offer(open, REAL, truth, noise)) estimates++;
    }
    expect(estimates, `seed ${seed}`).toBe(0);
  });
});

describe('P6 rules', () => {
  const noise = normalSampler(mulberry32(9000));
  /** n views spread in azimuth at the given tilt, starting at az0 */
  const ring = (n: number, tiltDeg = 40, az0 = 0, d = 400) =>
    Array.from({ length: n }, (_, i) => view(d, tiltDeg, az0 + (360 * i) / n));

  it('accepts at 3 keyframes; repeated viewing directions do not count', () => {
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    const [a, b, c] = ring(3);
    expect(offer(est, REAL, a!, noise)).toBeNull();
    expect(offer(est, REAL, a!, noise)).toBeNull(); // same direction
    expect(offer(est, REAL, view(400, 45, 5), noise)).toBeNull(); // < 10° from a
    expect(offer(est, REAL, b!, noise)).toBeNull();
    const e = offer(est, REAL, c!, noise)!;
    expect(e).not.toBeNull();
    expect(e.keyframes).toBe(3);
    expect(e.source).toBe('estimated');
    expect(Math.abs(pctErr(e.intrinsics.fx))).toBeLessThan(1);
    expect(e.intrinsics).toEqual(est.intrinsics);
    expect(est.stdDevPct).toBe(e.stdDevPct);
    // principal point and size are kept
    expect([e.intrinsics.cx, e.intrinsics.cy, e.intrinsics.width]).toEqual([639.5, 359.5, 1280]);
  });

  it('ignores frames with < 6 inlier tags, a poor homography fit or tilt < 20°', () => {
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    const five: Board = { family: BOARD.family, tags: BOARD.tags.slice(0, 5) };
    for (const v of ring(6)) expect(offer(est, REAL, v, noise, 0.3, five)).toBeNull();
    for (const v of ring(6, 40, 30)) expect(offer(est, REAL, v, noise, 2.5)).toBeNull(); // fit RMS > 1 px
    for (const v of ring(6, 15, 60)) expect(offer(est, REAL, v, noise)).toBeNull();
    expect(est.source).toBe('prior');
    // the same views with good data are accepted
    let got: FocalEstimate | null = null;
    for (const v of ring(6)) got = offer(est, REAL, v, noise) ?? got;
    expect(got).not.toBeNull();
  });

  it('rejects estimates outside [0.7, 1.4] × the prior', () => {
    const wrongPrior = focalPrior(W, H, 95); // f = 586 px; the camera's 1004.6 px is 1.71 × that
    const est = createFocalEstimator({ intrinsics: wrongPrior, source: 'prior' });
    for (const v of ring(12, 35)) expect(offer(est, REAL, v, noise)).toBeNull();
    expect(est.intrinsics.fx).toBe(wrongPrior.fx);
    // a plausible prior with the same views is accepted
    const ok = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    let got: FocalEstimate | null = null;
    for (const v of ring(12, 35)) got = offer(ok, REAL, v, noise) ?? got;
    expect(got).not.toBeNull();
  });

  it("'provided' intrinsics are only refined: at most 2 % per update", () => {
    const provided = { ...REAL, fx: REAL.fx * 1.05, fy: REAL.fx * 1.05 };
    const est = createFocalEstimator({ intrinsics: provided, source: 'provided' });
    expect(est.source).toBe('provided');
    const fs: number[] = [provided.fx];
    for (const v of ring(10, 40)) {
      const e = offer(est, REAL, v, noise);
      if (e) fs.push(e.intrinsics.fx);
    }
    expect(fs.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < fs.length; i++) {
      expect(Math.abs(fs[i]! / fs[i - 1]! - 1)).toBeLessThanOrEqual(0.02 + 1e-12);
    }
    expect(fs[1]! / fs[0]!).toBeCloseTo(0.98, 12); // the first update is clamped
    expect(Math.abs(pctErr(est.intrinsics.fx))).toBeLessThan(0.5);
    expect(est.source).toBe('estimated');
  });

  it('stops refining once the deviation is < 0.3 % with ≥ 10 keyframes', () => {
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    const lowNoise = normalSampler(mulberry32(9001));
    let updates = 0;
    let lastUpdateAt = -1;
    const views = [...ring(10, 30), ...ring(10, 50, 18)];
    views.forEach((v, i) => {
      if (offer(est, REAL, v, lowNoise, 0.1)) {
        updates++;
        lastUpdateAt = i;
      }
    });
    expect(est.stdDevPct!).toBeLessThan(0.3);
    expect(lastUpdateAt).toBe(9); // the 10th keyframe ends refinement
    expect(updates).toBe(8); // keyframes 3…10
  });

  it('a persistent focal jump (> 10 % for 5 frames) restarts from the new estimate', () => {
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    for (const v of ring(8, 40)) offer(est, REAL, v, noise);
    expect(Math.abs(pctErr(est.intrinsics.fx))).toBeLessThan(0.5);
    const fA = est.intrinsics.fx;
    const other = intrinsicsFromFov(W, H, 54); // +28 % focal length (another lens / crop)
    const views = ring(5, 45, 7);
    // 4 jump frames then a normal one: no jump
    for (const v of views.slice(0, 4)) expect(offer(est, other, v, noise)).toBeNull();
    // (a direction already kept, so it resets the jump count without adding a keyframe)
    expect(offer(est, REAL, view(400, 40, 0), noise)).toBeNull();
    for (const v of views.slice(0, 4)) expect(offer(est, other, v, noise)).toBeNull();
    expect(est.intrinsics.fx).toBe(fA);
    // the 5th consecutive one triggers the restart
    const e = offer(est, other, views[4]!, noise)!;
    expect(e).not.toBeNull();
    expect(Math.abs(pctErr(e.intrinsics.fx, other.fx))).toBeLessThan(1);
    expect(e.keyframes).toBeLessThanOrEqual(5);
    // and calibration continues on the new camera, accepted afresh
    for (const v of ring(8, 35, 3)) offer(est, other, v, noise);
    expect(Math.abs(pctErr(est.intrinsics.fx, other.fx))).toBeLessThan(0.5);
  });

  it('reset() drops keyframes; reset(initial) also replaces intrinsics and source', () => {
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    const [a, b, c] = ring(3);
    offer(est, REAL, a!, noise);
    offer(est, REAL, b!, noise);
    est.reset();
    expect(offer(est, REAL, c!, noise)).toBeNull(); // only 1 keyframe now
    const provided = { ...REAL };
    est.reset({ intrinsics: provided, source: 'provided' });
    expect(est.source).toBe('provided');
    expect(est.intrinsics).toEqual(provided);
    expect(est.intrinsics).not.toBe(provided); // copied
    expect(est.stdDevPct).toBeNull();
  });
});

describe('P6 end to end on rendered frames', () => {
  it('renderBoard → createDetector → estimatePose (68° prior) → estimator: f within 1 % of a 65° camera', () => {
    const detector = createDetector({
      width: W,
      height: H,
      family: BOARD.family,
      ids: BOARD.tags.map((t) => t.id),
    });
    const est = createFocalEstimator({ intrinsics: PRIOR, source: 'prior' });
    const rng = mulberry32(6106);
    const pageMm = {
      min: [-148.5, -105] as [number, number],
      max: [148.5, 105] as [number, number],
    };
    let last: FocalEstimate | null = null;
    for (let i = 0; i < 8; i++) {
      const truth = view(330 + rng() * 120, 25 + rng() * 30, 45 * i + rng() * 20, [
        (rng() - 0.5) * 30,
        0,
        (rng() - 0.5) * 30,
      ]);
      const img = renderBoard({
        board: BOARD,
        intrinsics: REAL,
        boardFromCamera: truth,
        pageMm,
        blurSigmaPx: 0.8,
        noiseSigma: 2,
        seed: i + 1,
      });
      const dets = detector.detect(img);
      const pose = estimatePose(dets, BOARD, est.intrinsics);
      if (!pose) continue;
      last = est.add(pose, dets, BOARD) ?? last;
    }
    expect(last).not.toBeNull();
    const e = pctErr(est.intrinsics.fx);
    console.log(
      `P6 rendered (8 frames): f ${fmt(est.intrinsics.fx, 1)} px vs ${fmt(REAL.fx, 1)} px, error ${fmt(e)} % ` +
        `(prior ${fmt(pctErr(PRIOR.fx), 2)} %), ${last!.keyframes} keyframes, deviation ${fmt(est.stdDevPct!)} %`,
    );
    expect(Math.abs(e)).toBeLessThanOrEqual(1);
  }, 120_000);
});
