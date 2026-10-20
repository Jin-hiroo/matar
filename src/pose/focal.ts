/**
 * Focal-length self-calibration (ARCHITECTURE.md §5.5), worker-side state:
 * closed form over keyframes plus the spread of per-keyframe solves, no bundle.
 *
 * Model: square pixels, principal point (cx, cy) known (the intrinsics in use),
 * no skew or distortion; only f = fx = fy is estimated.
 *
 * Closed form (Zhang 2000 constraints with ω = diag(w, w, 1); RESEARCH.md
 * §2.5). Per keyframe, H = DLT homography (Hartley-normalised, §5.2) from board
 * (x, z) mm to centred, scaled pixels ((u − cx)/L, (v − cy)/L), L = the long
 * side. With H ∝ diag(f/L, f/L, 1)·[r₁ r₂ t] and w = (L/f)², the orthogonality
 * and equal norm of r₁, r₂ give, in terms of H's columns h₁ = (h₁₁, h₂₁, h₃₁),
 * h₂ = (h₁₂, h₂₂, h₃₂):
 *   w·(h₁₁h₁₂ + h₂₁h₂₂) + h₃₁h₃₂ = 0
 *   w·(h₁₁² + h₂₁² − h₁₂² − h₂₂²) + (h₃₁² − h₃₂²) = 0
 * i.e. a·w + b = 0 twice. Least squares over all keyframes: w = −Σab / Σa²,
 * f = L/√w (w ≤ 0 rejected). The board origin only changes h₃, so it doesn't
 * enter. To weight keyframes alike, each H is scaled so its first two columns
 * have unit ω-norm on average under the prior w₀.
 *
 * Uncertainty: each keyframe solved alone gives fᵢ; the deviation of the
 * estimate is std(fᵢ)/√N, % of f.
 *
 * Rules (§5.5 steps 2, 5, 6): keyframes need ≥ 6 inlier tags, RMS < 1 px,
 * tilt ≥ 20° (optical axis vs board normal) and a viewing direction (optical
 * axis) ≥ 10° from every kept keyframe; at most 20 (the least tilted is
 * dropped). Accept at ≥ 3 keyframes, deviation < 1 %, f ∈ [0.7, 1.4] × the
 * reference (prior) f. Once accepted, refine while the deviation ≥ 0.3 %, at
 * most 2 % per update. Jumps: 5 consecutive keyframe-quality frames each > 10 %
 * from the accepted f restart the calibration from their median.
 *
 * Deviations from §5.5, each measured in tests/synthetic/pose-focal.test.ts:
 * 1. "RMS < 1 px" is the RMS of the frame's own homography fit, not
 *    `pose.rmsErrPx` (see `add`).
 * 2. Refinement stops at deviation < 0.3 % only with ≥ 10 keyframes: with 3
 *    the spread has 2 degrees of freedom, < 0.3 % happens by chance, and 20
 *    views end no better than 3 (max error 0.29 % vs 0.19 %).
 * 3. A jump also needs its 5 frames to agree within 5 % of their median (no
 *    restart on scattered garbage); after it the median is the new reference
 *    for the [0.7, 1.4] window ("start again from the latest estimate"), and
 *    the jump frames seed the new keyframe set.
 * `source: 'provided'` starts accepted, so it is only refined (2 % steps).
 *
 * Non-null assertions (`!`) are on scratch typed-array reads with indices below
 * the sizes ensured before use, in range by construction.
 */
import { homographyDlt } from '../math/homography.js';
import type {
  Board,
  BoardPose,
  CameraIntrinsics,
  FocalEstimate,
  FocalEstimator,
  FocalSource,
  Mat3,
  Mat4,
  TagDetection,
} from '../types.js';
import { boardCorners } from './estimate.js';

/** Tuning of `createFocalEstimator`; the defaults are ARCHITECTURE.md §5.5's values. */
export interface FocalEstimatorOptions {
  minTags: number;
  /** keyframe quality: RMS of the frame's homography fit, px */
  maxFitRmsPx: number;
  minTiltDeg: number;
  /** minimum angle between keyframe viewing directions, degrees */
  minSeparationDeg: number;
  maxKeyframes: number;
  minKeyframes: number;
  /** accept below this deviation, % */
  acceptStdDevPct: number;
  /** stop refining below this deviation, %, once there are at least `minKeyframesDone` keyframes */
  doneStdDevPct: number;
  minKeyframesDone: number;
  /** plausible range, × the reference f */
  minRatio: number;
  maxRatio: number;
  /** once accepted, max change per update, fraction */
  maxStep: number;
  /** jump rule: this many consecutive frames each this far off (fraction) */
  jumpFrames: number;
  jumpRatio: number;
  /** jump frames must agree within this fraction of their median */
  jumpAgreement: number;
}

export const FOCAL_DEFAULTS: FocalEstimatorOptions = {
  minTags: 6,
  maxFitRmsPx: 1,
  minTiltDeg: 20,
  minSeparationDeg: 10,
  maxKeyframes: 20,
  minKeyframes: 3,
  acceptStdDevPct: 1,
  doneStdDevPct: 0.3,
  minKeyframesDone: 10,
  minRatio: 0.7,
  maxRatio: 1.4,
  maxStep: 0.02,
  jumpFrames: 5,
  jumpRatio: 0.1,
  jumpAgreement: 0.05,
};

const DEG = Math.PI / 180;

/**
 * The two constraint rows (a₁, b₁, a₂, b₂) of a homography H (row-major, board
 * mm → centred pixels / L), scaled for the prior w₀ = (L/f₀)². Returns false if
 * H is degenerate.
 */
export function focalConstraints(h: Mat3, w0: number, out: Float64Array): boolean {
  const h11 = h[0]!, h12 = h[1]!, h21 = h[3]!, h22 = h[4]!, h31 = h[6]!, h32 = h[7]!; // prettier-ignore
  const s2 = (w0 * (h11 * h11 + h21 * h21 + h12 * h12 + h22 * h22) + h31 * h31 + h32 * h32) / 2;
  if (!(s2 > 0) || !Number.isFinite(s2)) return false;
  out[0] = (h11 * h12 + h21 * h22) / s2;
  out[1] = (h31 * h32) / s2;
  out[2] = (h11 * h11 + h21 * h21 - h12 * h12 - h22 * h22) / s2;
  out[3] = (h31 * h31 - h32 * h32) / s2;
  return true;
}

/** w = (L/f)² from summed normal-equation terms Σa², Σab; NaN if not positive. */
function wFrom(saa: number, sab: number): number {
  const w = -sab / saa;
  return saa > 0 && w > 0 && Number.isFinite(w) ? w : NaN;
}

interface Keyframe {
  /** constraint rows a₁, b₁, a₂, b₂ */
  c: Float64Array;
  /** single-keyframe focal length, px */
  f: number;
  tiltRad: number;
  /** viewing direction (optical axis) in board coordinates, unit */
  dx: number;
  dy: number;
  dz: number;
}

/** Optical axis (GL −Z) of `boardFromCamera` in board coordinates. */
function viewDir(m: Mat4): [number, number, number] {
  const x = -m[8]!, y = -m[9]!, z = -m[10]!; // prettier-ignore
  const n = Math.hypot(x, y, z);
  return [x / n, y / n, z / n];
}

// per-frame scratch
let fCap = 0;
let srcBuf = new Float64Array(0);
let dstBuf = new Float64Array(0);
const hBuf = new Float64Array(9);
const consBuf = new Float64Array(4);

function ensure(nPts: number): void {
  if (nPts <= fCap) return;
  fCap = Math.max(nPts, 2 * fCap, 64);
  srcBuf = new Float64Array(2 * fCap);
  dstBuf = new Float64Array(2 * fCap);
}

/** Creates a focal estimator (`FocalEstimator`, src/types.ts). */
export function createFocalEstimator(
  initial: { intrinsics: CameraIntrinsics; source: 'prior' | 'provided' },
  options: Partial<FocalEstimatorOptions> = {},
): FocalEstimator {
  return new ClosedFormFocalEstimator(initial, { ...FOCAL_DEFAULTS, ...options });
}

class ClosedFormFocalEstimator implements FocalEstimator {
  private k: CameraIntrinsics;
  private src: FocalSource;
  private dev: number | null = null;
  /** reference f for the plausibility window (prior, provided, or a jump restart) */
  private fRef: number;
  private accepted: boolean;
  private done = false;
  private readonly keyframes: Keyframe[] = [];
  private readonly jumpFs: number[] = [];
  private readonly jumpFrames: Keyframe[] = [];

  constructor(
    initial: { intrinsics: CameraIntrinsics; source: 'prior' | 'provided' },
    private readonly o: FocalEstimatorOptions,
  ) {
    this.k = { ...initial.intrinsics };
    this.src = initial.source;
    this.fRef = initial.intrinsics.fx;
    this.accepted = initial.source === 'provided';
  }

  get intrinsics(): CameraIntrinsics {
    return this.k;
  }

  get source(): FocalSource {
    return this.src;
  }

  get stdDevPct(): number | null {
    return this.dev;
  }

  reset(initial?: { intrinsics: CameraIntrinsics; source: 'prior' | 'provided' }): void {
    this.keyframes.length = 0;
    this.jumpFs.length = 0;
    this.jumpFrames.length = 0;
    this.done = false;
    if (initial) {
      this.k = { ...initial.intrinsics };
      this.src = initial.source;
      this.fRef = initial.intrinsics.fx;
      this.accepted = initial.source === 'provided';
      this.dev = null;
    }
  }

  /**
   * Offers one frame. Deviation from §5.5 step 2: the "RMS < 1 px" quality
   * test uses the frame's homography fit, not `pose.rmsErrPx`: the pose is
   * solved with the focal length in use, so before calibration its RMS
   * measures the focal error itself (a 5.6 % error gives > 1 px on most views
   * tilted ≥ 30°) and the most useful frames would never qualify.
   */
  add(pose: BoardPose, detections: readonly TagDetection[], board: Board): FocalEstimate | null {
    const kf = this.measure(pose, detections, board);
    if (!kf) return null;

    // jump rule (accepted state only): consecutive quality frames far from the f in use
    if (this.accepted) {
      if (Math.abs(kf.f / this.k.fx - 1) > this.o.jumpRatio) {
        this.jumpFs.push(kf.f);
        this.jumpFrames.push(kf);
        if (this.jumpFs.length > this.o.jumpFrames) {
          this.jumpFs.shift();
          this.jumpFrames.shift();
        }
        return this.jumpFs.length === this.o.jumpFrames ? this.tryJump() : null;
      }
      this.jumpFs.length = 0;
      this.jumpFrames.length = 0;
    }

    if (!this.addKeyframe(kf) || this.done) return null;
    return this.update();
  }

  /** Quality-checks a frame and builds its keyframe candidate, or null. */
  private measure(
    pose: BoardPose,
    detections: readonly TagDetection[],
    board: Board,
  ): Keyframe | null {
    const o = this.o;
    if (pose.usedTagIds.length < o.minTags) return null;
    const [dx, dy, dz] = viewDir(pose.boardFromCamera);
    const tiltRad = Math.acos(Math.min(1, Math.abs(dy)));
    if (tiltRad < o.minTiltDeg * DEG) return null;

    // inlier tags' corners: board (x, z) mm → centred pixels / L
    const corners = boardCorners(board);
    const k = this.k;
    const L = Math.max(k.width, k.height);
    ensure(4 * pose.usedTagIds.length);
    let n = 0;
    for (const id of pose.usedTagIds) {
      const det = detections.find((d) => d.id === id);
      const bc = corners.get(id);
      if (!det || !bc) continue;
      for (let c = 0; c < 4; c++) {
        const [u, v] = det.corners[c]!;
        srcBuf[2 * n] = bc[2 * c]!;
        srcBuf[2 * n + 1] = bc[2 * c + 1]!;
        dstBuf[2 * n] = (u - k.cx) / L;
        dstBuf[2 * n + 1] = (v - k.cy) / L;
        n++;
      }
    }
    if (n < 4 * o.minTags) return null;
    const h = homographyDlt(srcBuf, dstBuf, n, hBuf);
    if (!h) return null;

    // fit quality in pixels (independent of f)
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const x = srcBuf[2 * i]!;
      const z = srcBuf[2 * i + 1]!;
      const ww = h[6]! * x + h[7]! * z + h[8]!;
      const du = (h[0]! * x + h[1]! * z + h[2]!) / ww - dstBuf[2 * i]!;
      const dv = (h[3]! * x + h[4]! * z + h[5]!) / ww - dstBuf[2 * i + 1]!;
      e2 += du * du + dv * dv;
    }
    if (!(Math.sqrt(e2 / n) * L < o.maxFitRmsPx)) return null;

    const w0 = (L / this.fRef) ** 2;
    if (!focalConstraints(h, w0, consBuf)) return null;
    const c = Float64Array.from(consBuf);
    const w = wFrom(c[0]! ** 2 + c[2]! ** 2, c[0]! * c[1]! + c[2]! * c[3]!);
    if (!(w > 0)) return null;
    return { c, f: L / Math.sqrt(w), tiltRad, dx, dy, dz };
  }

  /** Keeps `kf` if its viewing direction is new enough; true if the set changed. */
  private addKeyframe(kf: Keyframe): boolean {
    const cosSep = Math.cos(this.o.minSeparationDeg * DEG);
    for (const k of this.keyframes) {
      if (k.dx * kf.dx + k.dy * kf.dy + k.dz * kf.dz > cosSep) return false;
    }
    this.keyframes.push(kf);
    if (this.keyframes.length > this.o.maxKeyframes) {
      let least = 0;
      for (let i = 1; i < this.keyframes.length; i++) {
        if (this.keyframes[i]!.tiltRad < this.keyframes[least]!.tiltRad) least = i;
      }
      const [dropped] = this.keyframes.splice(least, 1);
      if (dropped === kf) return false;
    }
    return true;
  }

  /** Closed form over the keyframes → maybe a new estimate in use. */
  private update(): FocalEstimate | null {
    const o = this.o;
    const kfs = this.keyframes;
    const n = kfs.length;
    if (n < o.minKeyframes) return null;
    let saa = 0;
    let sab = 0;
    for (const k of kfs) {
      const c = k.c;
      saa += c[0]! * c[0]! + c[2]! * c[2]!;
      sab += c[0]! * c[1]! + c[2]! * c[3]!;
    }
    const w = wFrom(saa, sab);
    if (!(w > 0)) return null;
    const L = Math.max(this.k.width, this.k.height);
    const f = L / Math.sqrt(w);
    let mean = 0;
    for (const k of kfs) mean += k.f / n;
    let ss = 0;
    for (const k of kfs) ss += (k.f - mean) ** 2;
    const dev = (100 * Math.sqrt(ss / (n - 1))) / Math.sqrt(n) / f;
    if (!(dev < o.acceptStdDevPct)) return null;
    if (f < o.minRatio * this.fRef || f > o.maxRatio * this.fRef) return null;

    const cur = this.k.fx;
    let next = f;
    if (this.accepted) next = Math.min(cur * (1 + o.maxStep), Math.max(cur * (1 - o.maxStep), f));
    this.accepted = true;
    this.dev = dev;
    this.done = dev < o.doneStdDevPct && n >= o.minKeyframesDone && next === f;
    if (Math.abs(next - cur) <= 1e-9 * cur && this.src === 'estimated') return null;
    return this.use(next, dev, n);
  }

  /** Jump rule: restart from the median of agreeing jump frames. */
  private tryJump(): FocalEstimate | null {
    const sorted = [...this.jumpFs].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1]!;
    if (sorted[0]! < med * (1 - this.o.jumpAgreement)) return null;
    if (sorted[sorted.length - 1]! > med * (1 + this.o.jumpAgreement)) return null;
    const frames = [...this.jumpFrames];
    let mean = 0;
    for (const f of sorted) mean += f / sorted.length;
    let ss = 0;
    for (const f of sorted) ss += (f - mean) ** 2;
    const dev = (100 * Math.sqrt(ss / (sorted.length - 1))) / Math.sqrt(sorted.length) / med;
    this.reset();
    this.fRef = med;
    this.accepted = false;
    this.dev = dev;
    // the jump frames seed the new keyframe set (subject to the separation rule)
    for (const kf of frames) this.addKeyframe(kf);
    return this.use(med, dev, this.keyframes.length);
  }

  private use(f: number, dev: number, keyframes: number): FocalEstimate {
    this.k = { ...this.k, fx: f, fy: f };
    this.src = 'estimated';
    return { intrinsics: { ...this.k }, source: 'estimated', stdDevPct: dev, keyframes };
  }
}
