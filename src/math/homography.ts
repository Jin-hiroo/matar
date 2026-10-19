/**
 * Planar homographies from point correspondences, with Hartley normalisation
 * (Hartley 1997, "In defense of the eight-point algorithm": shift each point
 * set to its centroid, scale so the mean distance from it is √2).
 *
 * - `homographyDlt`: the DLT. Minimises ‖A·h‖ subject to ‖h‖ = 1 via the
 *   eigenvector of the smallest eigenvalue of the 9×9 AᵀA (Jacobi). Handles
 *   nearly degenerate (collinear-ish) input without producing NaN.
 * - `homographyLsq`: least squares with h₃₃ = 1 in the normalised frames
 *   (8×8 normal equations, Cholesky). About 10× cheaper; used for the many small
 *   fits of the tag-pair consensus. Valid whenever the source centroid maps to a
 *   finite point (true for any planar target seen by a camera). Fails (null) on
 *   degenerate input instead of degrading.
 *
 * Points are interleaved `[x0, y0, x1, y1, …]`. H maps src → dst:
 * `dst ∝ H · [src, 1]`, `Mat3` **row-major**. Results are scaled so h₃₃ = 1
 * when |h₃₃| is not tiny, otherwise to unit Frobenius norm.
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < 2n (or the
 * fixed scratch sizes), in range by construction.
 */
import type { Mat3 } from '../types.js';
import { choleskyFactor, choleskySolve } from './cholesky.js';
import { symmetricEigen, type EigenScratch } from './svd.js';

/** Hartley normalisation of n interleaved points: x' = s·(x − cx). `null` if all points coincide. */
export function hartleyNormalisation(
  pts: ArrayLike<number>,
  n: number,
): { cx: number; cy: number; s: number } | null {
  const t = hartley(pts, n, 0, scratchT) ? scratchT : null;
  return t ? { cx: t[0]!, cy: t[1]!, s: t[2]! } : null;
}

const scratchT = new Float64Array(3);

/** Writes [cx, cy, s] into out at `o`; false if the spread is zero or not finite. */
function hartley(pts: ArrayLike<number>, n: number, o: number, out: Float64Array): boolean {
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += pts[2 * i]!;
    cy += pts[2 * i + 1]!;
  }
  cx /= n;
  cy /= n;
  let d = 0;
  for (let i = 0; i < n; i++) d += Math.hypot(pts[2 * i]! - cx, pts[2 * i + 1]! - cy);
  d /= n;
  if (!(d > 0) || !Number.isFinite(d)) return false;
  out[o] = cx;
  out[o + 1] = cy;
  out[o + 2] = Math.SQRT2 / d;
  return true;
}

// scratch, shared by both solvers (single-threaded, not re-entrant)
const tf = new Float64Array(6); // [scx, scy, ss, dcx, dcy, ds]
const ata = new Float64Array(81);
const eigVals = new Float64Array(9);
const eigVecs = new Float64Array(81);
const eigScratch: EigenScratch = { a: new Float64Array(81) };
const hn = new Float64Array(9);
const nrm = new Float64Array(81);
const rhs = new Float64Array(8);

/** Maps the normalised-frame homography `h` (row-major) back to the original frames: T_dst⁻¹ · h · T_src. */
function denormalise(h: Float64Array, out: Mat3): Mat3 | null {
  // prettier-ignore
  const scx = tf[0]!, scy = tf[1]!, ss = tf[2]!;
  // prettier-ignore
  const dcx = tf[3]!, dcy = tf[4]!, ds = tf[5]!;
  // h · T_src, T_src = [[ss, 0, −ss·scx], [0, ss, −ss·scy], [0, 0, 1]]
  for (let r = 0; r < 3; r++) {
    // prettier-ignore
    const a = h[3 * r]!, b = h[3 * r + 1]!, c = h[3 * r + 2]!;
    hn[3 * r] = a * ss;
    hn[3 * r + 1] = b * ss;
    hn[3 * r + 2] = c - ss * (a * scx + b * scy);
  }
  // T_dst⁻¹ · (…), T_dst⁻¹ = [[1/ds, 0, dcx], [0, 1/ds, dcy], [0, 0, 1]]
  const inv = 1 / ds;
  for (let c = 0; c < 3; c++) {
    const r2 = hn[6 + c]!;
    out[c] = hn[c]! * inv + dcx * r2;
    out[3 + c] = hn[3 + c]! * inv + dcy * r2;
    out[6 + c] = r2;
  }
  return scaleHomography(out);
}

/** Scales so h₃₃ = 1, or to unit Frobenius norm if |h₃₃| is tiny; null if not finite or zero. */
function scaleHomography(h: Mat3): Mat3 | null {
  let f = 0;
  for (let i = 0; i < 9; i++) f += h[i]! * h[i]!;
  f = Math.sqrt(f);
  if (!(f > 0) || !Number.isFinite(f)) return null;
  const h33 = h[8]!;
  const k = Math.abs(h33) > 1e-10 * f ? 1 / h33 : 1 / f;
  for (let i = 0; i < 9; i++) h[i] = h[i]! * k;
  return h;
}

/**
 * DLT homography src → dst from n ≥ 4 interleaved point pairs. Returns null for
 * n < 4, coincident points or non-finite input. Nearly degenerate input gives a
 * finite (if ill-determined) H.
 */
export function homographyDlt(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  n: number,
  out: Mat3 = new Float64Array(9),
): Mat3 | null {
  if (n < 4 || !hartley(src, n, 0, tf) || !hartley(dst, n, 3, tf)) return null;
  const sums = accumulate(src, dst, n);
  // AᵀA = [[M, 0, −Mu], [0, M, −Mv], [−Muᵀ, −Mvᵀ, Mw]] with a = (x, y, 1):
  // M = Σ a·aᵀ, Mu = Σ u·a·aᵀ, Mv = Σ v·a·aᵀ, Mw = Σ (u² + v²)·a·aᵀ
  ata.fill(0);
  putBlock(ata, 9, 0, 0, sums, 0, 1);
  putBlock(ata, 9, 3, 3, sums, 0, 1);
  putBlock(ata, 9, 0, 6, sums, 6, -1);
  putBlock(ata, 9, 3, 6, sums, 12, -1);
  putBlock(ata, 9, 6, 6, sums, 18, 1);
  symmetricEigen(ata, 9, eigVals, eigVecs, eigScratch);
  // eigenvector of the smallest eigenvalue = column 0
  const h = scratchH;
  for (let i = 0; i < 9; i++) h[i] = eigVecs[i * 9]!;
  for (let i = 0; i < 9; i++) if (!Number.isFinite(h[i]!)) return null;
  return denormalise(h, out);
}

const scratchH = new Float64Array(9);
// Σ over points of (xx, xy, x, yy, y, 1) × weight 1, u, v, u² + v²: 4 groups of 6
const sumsBuf = new Float64Array(24);

/** Normalised-frame sums for both solvers (see `homographyDlt`). */
function accumulate(src: ArrayLike<number>, dst: ArrayLike<number>, n: number): Float64Array {
  // prettier-ignore
  const scx = tf[0]!, scy = tf[1]!, ss = tf[2]!;
  // prettier-ignore
  const dcx = tf[3]!, dcy = tf[4]!, ds = tf[5]!;
  const s = sumsBuf;
  s.fill(0);
  for (let i = 0; i < n; i++) {
    const x = (src[2 * i]! - scx) * ss;
    const y = (src[2 * i + 1]! - scy) * ss;
    const u = (dst[2 * i]! - dcx) * ds;
    const v = (dst[2 * i + 1]! - dcy) * ds;
    const w = u * u + v * v;
    // prettier-ignore
    const xx = x * x, xy = x * y, yy = y * y;
    for (let g = 0; g < 4; g++) {
      const k = g === 0 ? 1 : g === 1 ? u : g === 2 ? v : w;
      const o = 6 * g;
      s[o] = s[o]! + k * xx;
      s[o + 1] = s[o + 1]! + k * xy;
      s[o + 2] = s[o + 2]! + k * x;
      s[o + 3] = s[o + 3]! + k * yy;
      s[o + 4] = s[o + 4]! + k * y;
      s[o + 5] = s[o + 5]! + k;
    }
  }
  return s;
}

/**
 * Writes sign × the symmetric 3×3 block given by six sums (xx, xy, x, yy, y, 1)
 * at (r0, c0) of an n×n row-major matrix, and its transpose at (c0, r0).
 */
function putBlock(
  m: Float64Array,
  n: number,
  r0: number,
  c0: number,
  s: Float64Array,
  o: number,
  sign: number,
): void {
  // prettier-ignore
  const b00 = sign * s[o]!, b01 = sign * s[o + 1]!, b02 = sign * s[o + 2]!;
  // prettier-ignore
  const b11 = sign * s[o + 3]!, b12 = sign * s[o + 4]!, b22 = sign * s[o + 5]!;
  for (let t = 0; t < 2; t++) {
    const r = t === 0 ? r0 : c0;
    const c = t === 0 ? c0 : r0;
    m[r * n + c] = b00;
    m[r * n + c + 1] = b01;
    m[r * n + c + 2] = b02;
    m[(r + 1) * n + c] = b01;
    m[(r + 1) * n + c + 1] = b11;
    m[(r + 1) * n + c + 2] = b12;
    m[(r + 2) * n + c] = b02;
    m[(r + 2) * n + c + 1] = b12;
    m[(r + 2) * n + c + 2] = b22;
  }
}

/**
 * Least-squares homography with h₃₃ = 1 (in Hartley-normalised frames) from
 * n ≥ 4 interleaved point pairs; exact for 4 points in general position.
 * Returns null on degenerate input (normal equations not positive definite).
 */
export function homographyLsq(
  src: ArrayLike<number>,
  dst: ArrayLike<number>,
  n: number,
  out: Mat3 = new Float64Array(9),
): Mat3 | null {
  if (n < 4 || !hartley(src, n, 0, tf) || !hartley(dst, n, 3, tf)) return null;
  const s = accumulate(src, dst, n);
  // unknowns h11…h32 (h33 = 1); rows [a, 0, −u·(x, y)]·h = u and [0, a, −v·(x, y)]·h = v.
  // Normal matrix = the 9×9 AᵀA without its last row/column; right side = −(last column).
  nrm.fill(0);
  putBlock(nrm, 9, 0, 0, s, 0, 1);
  putBlock(nrm, 9, 3, 3, s, 0, 1);
  putBlock(nrm, 9, 0, 6, s, 6, -1);
  putBlock(nrm, 9, 3, 6, s, 12, -1);
  putBlock(nrm, 9, 6, 6, s, 18, 1);
  for (let r = 0; r < 8; r++) {
    rhs[r] = -nrm[r * 9 + 8]!;
    for (let c = 0; c < 8; c++) sys[r * 8 + c] = nrm[r * 9 + c]!;
  }
  if (!choleskyFactor(sys, 8)) return null;
  choleskySolve(sys, 8, rhs, rhs);
  const h = scratchH;
  for (let i = 0; i < 8; i++) h[i] = rhs[i]!;
  h[8] = 1;
  for (let i = 0; i < 8; i++) if (!Number.isFinite(h[i]!)) return null;
  return denormalise(h, out);
}

const sys = new Float64Array(64);

/** Applies H (row-major) to (x, y); writes [u, v] into `out` at `o`. Returns false if the point maps to infinity. */
export function applyHomography(
  h: Mat3,
  x: number,
  y: number,
  out: Float64Array | number[],
  o = 0,
): boolean {
  const w = h[6]! * x + h[7]! * y + h[8]!;
  if (w === 0) return false;
  out[o] = (h[0]! * x + h[1]! * y + h[2]!) / w;
  out[o + 1] = (h[3]! * x + h[4]! * y + h[5]!) / w;
  return true;
}
