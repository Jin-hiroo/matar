/**
 * Pose smoothing (ARCHITECTURE.md §5.6), main thread: a One Euro filter
 * (G. Casiez, N. Roussel, D. Vogel, "1€ Filter: A Simple Speed-based Low-pass
 * Filter for Noisy Input in Interactive Systems", CHI 2012) on the camera
 * position (mm) and rotation (unit quaternion), with jump gating and loss hold.
 *
 * Input and output: `boardFromCamera` (GL, mm, column-major), timestamps in ms
 * from the frames (not wall-clock).
 *
 * Per step (dt from timestamps):
 * - speed estimates, low-passed at `dCutoffHz`: position v = (x − x̂)/dt (mm/s),
 *   rotation ω = log(q̂⁻¹q)/dt (rad/s), each against the previous filtered value
 *   as in the paper;
 * - cutoffs fc_pos = minCutoff + beta·|v|, fc_rot = minCutoff + beta·|ω|, and
 *   **one** α = 1 / (1 + 1/(2π·fc·dt)) with fc = max(fc_pos, fc_rot) for both,
 *   so position and rotation lag by the same time (separate α's make content
 *   slide when orbiting the board: fast rotation, slow translation);
 * - x̂ ← x̂ + α(x − x̂), q̂ ← q̂ ⊗ exp(α·log(q̂⁻¹q)) (q hemisphere-aligned to q̂).
 *
 * Jump gating: a raw pose more than `jumpMm` or `jumpDeg` from the filtered one
 * is ignored (the output holds) unless such jumps persist for `jumpFrames`
 * consecutive frames; then the filter resets to the latest raw pose.
 * Loss: `update(null, t)` holds the last output until `lostAfterMs` has passed
 * since the last pose, then returns null and resets.
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads, in range by
 * construction.
 */
import {
  quatExp,
  quatFromRotation,
  quatLog,
  quatMultiply,
  rotationFromQuat,
} from '../math/rotation.js';
import type { Mat4, OneEuroParams, PoseFilter, PoseFilterOptions } from '../types.js';

/** Defaults of `createPoseFilter` (ARCHITECTURE.md §5.6; to be tuned on device). */
export const POSE_FILTER_DEFAULTS: {
  position: OneEuroParams;
  rotation: OneEuroParams;
  dCutoffHz: number;
  jumpMm: number;
  jumpDeg: number;
  jumpFrames: number;
  lostAfterMs: number;
} = {
  position: { minCutoffHz: 1.5, beta: 0.1 }, // beta: Hz per mm/s
  rotation: { minCutoffHz: 1.5, beta: 20 }, // beta: Hz per rad/s
  dCutoffHz: 1,
  jumpMm: 20,
  jumpDeg: 5,
  jumpFrames: 3,
  lostAfterMs: 300,
};

/** One Euro smoothing factor for a cutoff (Hz) and a time step (s). */
export function oneEuroAlpha(cutoffHz: number, dtS: number): number {
  return 1 / (1 + 1 / (2 * Math.PI * cutoffHz * dtS));
}

/** Creates a pose filter (`PoseFilter`, src/types.ts). */
export function createPoseFilter(opts: PoseFilterOptions = {}): PoseFilter {
  return new OneEuroPoseFilter(opts);
}

class OneEuroPoseFilter implements PoseFilter {
  private readonly pos: OneEuroParams;
  private readonly rot: OneEuroParams;
  private readonly dCutoffHz: number;
  private readonly jumpMm: number;
  private readonly jumpRad: number;
  private readonly jumpFrames: number;
  private readonly lostAfterMs: number;

  private has = false;
  /** filtered position (mm) and rotation (quaternion [x, y, z, w]) */
  private readonly x = new Float64Array(3);
  private readonly q = new Float64Array(4);
  /** filtered speeds: mm/s and rad/s vectors */
  private readonly v = new Float64Array(3);
  private readonly w = new Float64Array(3);
  /** timestamp of the last filter step and of the last raw pose, ms */
  private lastStepMs = 0;
  private lastPoseMs = 0;
  /** consecutive gated (jump) frames */
  private jumps = 0;

  // scratch
  private readonly rawX = new Float64Array(3);
  private readonly rawQ = new Float64Array(4);
  private readonly rawR = new Float64Array(9);
  private readonly dq = new Float64Array(4);
  private readonly dw = new Float64Array(3);
  private readonly r = new Float64Array(9);

  constructor(o: PoseFilterOptions) {
    const d = POSE_FILTER_DEFAULTS;
    this.pos = { ...d.position, ...o.position };
    this.rot = { ...d.rotation, ...o.rotation };
    this.dCutoffHz = o.dCutoffHz ?? d.dCutoffHz;
    this.jumpMm = o.jumpMm ?? d.jumpMm;
    this.jumpRad = ((o.jumpDeg ?? d.jumpDeg) * Math.PI) / 180;
    this.jumpFrames = Math.max(1, o.jumpFrames ?? d.jumpFrames);
    this.lostAfterMs = o.lostAfterMs ?? d.lostAfterMs;
  }

  reset(): void {
    this.has = false;
    this.jumps = 0;
  }

  update(boardFromCamera: Mat4 | null, timestampMs: number): Mat4 | null {
    if (!boardFromCamera) {
      if (!this.has) return null;
      if (timestampMs - this.lastPoseMs > this.lostAfterMs) {
        this.reset();
        return null;
      }
      return this.output();
    }
    this.readRaw(boardFromCamera);
    if (!this.has) return this.resetTo(timestampMs);
    this.lastPoseMs = timestampMs;

    // jump gating
    const { x, q, rawX, rawQ, dq, dw } = this;
    const dPos = Math.hypot(rawX[0]! - x[0]!, rawX[1]! - x[1]!, rawX[2]! - x[2]!);
    // q̂⁻¹ ⊗ q, hemisphere-aligned (quatLog takes the short way)
    dq[0] = -q[0]!;
    dq[1] = -q[1]!;
    dq[2] = -q[2]!;
    dq[3] = q[3]!;
    quatMultiply(dq, rawQ, dq);
    quatLog(dq, dw);
    const dAng = Math.hypot(dw[0]!, dw[1]!, dw[2]!);
    if (dPos > this.jumpMm || dAng > this.jumpRad) {
      if (++this.jumps >= this.jumpFrames) return this.resetTo(timestampMs);
      return this.output();
    }
    this.jumps = 0;

    const dt = (timestampMs - this.lastStepMs) / 1000;
    if (!(dt > 0)) return this.output(); // repeated timestamp: nothing to integrate
    this.lastStepMs = timestampMs;

    // speeds against the previous filtered value, low-passed at dCutoff
    const ad = oneEuroAlpha(this.dCutoffHz, dt);
    const { v, w } = this;
    for (let i = 0; i < 3; i++) {
      v[i] = v[i]! + ad * ((rawX[i]! - x[i]!) / dt - v[i]!);
      w[i] = w[i]! + ad * (dw[i]! / dt - w[i]!);
    }
    const fcPos = this.pos.minCutoffHz + this.pos.beta * Math.hypot(v[0]!, v[1]!, v[2]!);
    const fcRot = this.rot.minCutoffHz + this.rot.beta * Math.hypot(w[0]!, w[1]!, w[2]!);
    const a = oneEuroAlpha(Math.max(fcPos, fcRot), dt);

    for (let i = 0; i < 3; i++) x[i] = x[i]! + a * (rawX[i]! - x[i]!);
    dw[0] = dw[0]! * a;
    dw[1] = dw[1]! * a;
    dw[2] = dw[2]! * a;
    quatExp(dw, dq);
    quatMultiply(q, dq, q);
    const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
    for (let i = 0; i < 4; i++) q[i] = q[i]! / n;
    return this.output();
  }

  /** Position and rotation of a raw `boardFromCamera` into rawX / rawQ. */
  private readRaw(m: Mat4): void {
    const r = this.rawR;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) r[3 * row + col] = m[4 * col + row]!;
      this.rawX[row] = m[12 + row]!;
    }
    quatFromRotation(r, this.rawQ);
  }

  private resetTo(timestampMs: number): Mat4 {
    this.x.set(this.rawX);
    this.q.set(this.rawQ);
    this.v.fill(0);
    this.w.fill(0);
    this.lastStepMs = timestampMs;
    this.lastPoseMs = timestampMs;
    this.jumps = 0;
    this.has = true;
    return this.output();
  }

  /** A new `boardFromCamera` (GL, mm, column-major) from the filter state. */
  private output(): Mat4 {
    const r = rotationFromQuat(this.q, this.r);
    const out = new Float64Array(16); // returned to the caller, who may keep it
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) out[4 * col + row] = r[3 * row + col]!;
      out[12 + row] = this.x[row]!;
    }
    out[15] = 1;
    return out;
  }
}
