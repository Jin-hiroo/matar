/**
 * Pose refinement (ARCHITECTURE.md §5.3): Levenberg–Marquardt over 6 DoF,
 * minimising pixel reprojection error with a Huber loss on each corner's 2D
 * residual (δ = 1.5 px, IRLS weights min(1, δ/‖r‖)).
 *
 * State: `cameraFromBoard` in CV convention, X = R·p + t (mm), R row-major.
 * Board points are on the paper, p = (x, 0, z) mm. Update: R ← exp([ω]×)·R,
 * t ← t + δt (rotation increment about the camera origin, so the analytic
 * Jacobian is ∂X/∂ω = −[R·p]×, ∂X/∂t = I). Pinhole projection
 * u = fx·X/Z + cx, v = fy·Y/Z + cy, pixel centres at integers.
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < 2n (or the
 * fixed sizes 9, 6, 36), in range by construction.
 */
import {
  createLmScratch,
  levenbergMarquardt,
  type LmProblem,
  type LmResult,
  type LmScratch,
} from '../math/lm.js';
import { mat3Mul } from '../math/mat3.js';
import { rotationFromAxisAngle } from '../math/rotation.js';
import type { CameraIntrinsics, Mat3 } from '../types.js';

export interface RefineOptions {
  /** iteration limit (default 10) */
  maxIterations?: number;
  /** stop when the step is below this: |δω| (rad) and |δt|/|t| combined (default 1e-6) */
  minStep?: number;
}

/** Projects board point (x, 0, z) through (R, t); returns Z (≤ 0 = behind the camera) and writes u, v. */
function project(
  r: Mat3,
  t: Float64Array,
  k: CameraIntrinsics,
  x: number,
  z: number,
  uv: Float64Array,
): number {
  const X = r[0]! * x + r[2]! * z + t[0]!;
  const Y = r[3]! * x + r[5]! * z + t[1]!;
  const Z = r[6]! * x + r[8]! * z + t[2]!;
  uv[0] = (k.fx * X) / Z + k.cx;
  uv[1] = (k.fy * Y) / Z + k.cy;
  return Z;
}

/**
 * The 6-DoF pose problem for `levenbergMarquardt`. Reusable: `set()` points it
 * at new data and a start pose, buffers are kept.
 */
export class PoseProblem implements LmProblem {
  readonly size = 6;
  /** current estimate */
  readonly r = new Float64Array(9);
  readonly t = new Float64Array(3);
  private readonly rTrial = new Float64Array(9);
  private readonly tTrial = new Float64Array(3);
  private readonly dr = new Float64Array(9);
  private readonly uv = new Float64Array(2);
  private boardXz: ArrayLike<number> = new Float64Array(0);
  private px: ArrayLike<number> = new Float64Array(0);
  private n = 0;
  private k: CameraIntrinsics = { width: 1, height: 1, fx: 1, fy: 1, cx: 0, cy: 0 };
  private huber = 1.5;

  /**
   * Points the problem at n correspondences: `boardXz` board [x, z] mm and
   * `px` observed pixels [u, v], interleaved. Start pose (R, t) is copied.
   */
  set(
    boardXz: ArrayLike<number>,
    px: ArrayLike<number>,
    n: number,
    k: CameraIntrinsics,
    r: Mat3,
    t: ArrayLike<number>,
    huberPx = 1.5,
  ): void {
    this.boardXz = boardXz;
    this.px = px;
    this.n = n;
    this.k = k;
    this.huber = huberPx;
    this.r.set(r);
    this.t[0] = t[0]!;
    this.t[1] = t[1]!;
    this.t[2] = t[2]!;
  }

  /** Robust (Huber) cost at (R, t); Infinity if a point is not in front of the camera. */
  cost(r: Mat3 = this.r, t: Float64Array = this.t): number {
    const { boardXz, px, n, k, uv, huber } = this;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const Z = project(r, t, k, boardXz[2 * i]!, boardXz[2 * i + 1]!, uv);
      if (!(Z > 1e-9)) return Infinity;
      const e = Math.hypot(uv[0]! - px[2 * i]!, uv[1]! - px[2 * i + 1]!);
      c += e <= huber ? 0.5 * e * e : huber * (e - 0.5 * huber);
    }
    return c;
  }

  linearize(jtj: Float64Array, jtr: Float64Array): number {
    const { boardXz, px, n, k, r, t, huber } = this;
    const fx = k.fx;
    const fy = k.fy;
    jtj.fill(0);
    jtr.fill(0);
    let c = 0;
    for (let i = 0; i < n; i++) {
      const x = boardXz[2 * i]!;
      const z = boardXz[2 * i + 1]!;
      // P = R·p, X = P + t
      const Px = r[0]! * x + r[2]! * z;
      const Py = r[3]! * x + r[5]! * z;
      const Pz = r[6]! * x + r[8]! * z;
      const X = Px + t[0]!;
      const Y = Py + t[1]!;
      const Z = Pz + t[2]!;
      const iz = 1 / Z;
      const xn = X * iz;
      const yn = Y * iz;
      const ru = fx * xn + k.cx - px[2 * i]!;
      const rv = fy * yn + k.cy - px[2 * i + 1]!;
      const e = Math.hypot(ru, rv);
      let w = 1;
      if (e <= huber) c += 0.5 * e * e;
      else {
        c += huber * (e - 0.5 * huber);
        w = huber / e;
      }
      // ∂u/∂X = (fx/Z)(1, 0, −X/Z), ∂v/∂X = (fy/Z)(0, 1, −Y/Z); ∂X/∂ω = −[P]×
      const ux = fx * iz;
      const uz = -fx * xn * iz;
      const vy = fy * iz;
      const vz = -fy * yn * iz;
      // rows: du = [ux·(0, Pz, −Py) + uz·(Py, −Px, 0), ux, 0, uz]
      ju[0] = uz * Py;
      ju[1] = ux * Pz - uz * Px;
      ju[2] = -ux * Py;
      ju[3] = ux;
      ju[4] = 0;
      ju[5] = uz;
      // dv = [vy·(−Pz, 0, Px) + vz·(Py, −Px, 0), 0, vy, vz]
      jv[0] = -vy * Pz + vz * Py;
      jv[1] = -vz * Px;
      jv[2] = vy * Px;
      jv[3] = 0;
      jv[4] = vy;
      jv[5] = vz;
      for (let a = 0; a < 6; a++) {
        const wa = w * ju[a]!;
        const wb = w * jv[a]!;
        jtr[a] = jtr[a]! + wa * ru + wb * rv;
        for (let b = a; b < 6; b++) jtj[a * 6 + b] = jtj[a * 6 + b]! + wa * ju[b]! + wb * jv[b]!;
      }
    }
    for (let a = 0; a < 6; a++) for (let b = 0; b < a; b++) jtj[a * 6 + b] = jtj[b * 6 + a]!;
    return c;
  }

  tryStep(step: Float64Array): number {
    rotationFromAxisAngle(step, this.dr);
    mat3Mul(this.dr, this.r, this.rTrial);
    this.tTrial[0] = this.t[0]! + step[3]!;
    this.tTrial[1] = this.t[1]! + step[4]!;
    this.tTrial[2] = this.t[2]! + step[5]!;
    return this.cost(this.rTrial, this.tTrial);
  }

  acceptStep(): void {
    this.r.set(this.rTrial);
    this.t.set(this.tTrial);
  }

  stepNorm(step: Float64Array): number {
    const tn = Math.max(Math.hypot(this.t[0]!, this.t[1]!, this.t[2]!), 1);
    return Math.hypot(step[0]!, step[1]!, step[2]!, step[3]! / tn, step[4]! / tn, step[5]! / tn);
  }

  /**
   * Plain (non-robust) squared reprojection errors per point into `out` (px²),
   * and their sum as the return value.
   */
  squaredErrors(out?: Float64Array): number {
    const { boardXz, px, n, k, r, t, uv } = this;
    let s = 0;
    for (let i = 0; i < n; i++) {
      project(r, t, k, boardXz[2 * i]!, boardXz[2 * i + 1]!, uv);
      const du = uv[0]! - px[2 * i]!;
      const dv = uv[1]! - px[2 * i + 1]!;
      const e2 = du * du + dv * dv;
      if (out) out[i] = e2;
      s += e2;
    }
    return s;
  }
}

const ju = new Float64Array(6);
const jv = new Float64Array(6);

/** Shared scratch for 6-parameter LM runs. */
export const poseLmScratch: LmScratch = createLmScratch(6);

/** Refines the pose held by `problem` in place. */
export function refinePose(problem: PoseProblem, options: RefineOptions = {}): LmResult {
  return levenbergMarquardt(
    problem,
    { maxIterations: options.maxIterations ?? 10, minStep: options.minStep ?? 1e-6 },
    poseLmScratch,
  );
}
