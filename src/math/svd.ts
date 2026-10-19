/**
 * Jacobi methods for small dense matrices.
 *
 * - `svd3`: one-sided (Hestenes) Jacobi SVD of a 3×3 matrix: plane rotations
 *   applied on the right orthogonalise the columns of A, so A·V = U·Σ.
 *   Works on A directly (no AᵀA), so small singular values keep their accuracy.
 * - `symmetricEigen`: cyclic Jacobi eigen-decomposition of a small symmetric
 *   n×n matrix (Golub & Van Loan, "Matrix Computations", §8.5).
 *
 * Both are textbook algorithms written from those descriptions. Matrices are
 * **row-major** Float64Arrays (`Mat3` for 3×3).
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < n·n, in
 * range by construction (loop bounds).
 */
import type { Mat3 } from '../types.js';

const EPS = 2.220446049250313e-16;

/** Result of `svd3`: `a = u · diag(s) · vᵀ`, `s` descending and ≥ 0, `u` and `v` orthogonal (row-major). */
export interface Svd3 {
  u: Mat3;
  s: Float64Array;
  v: Mat3;
}

/**
 * SVD of a 3×3 row-major matrix. `u` and `v` are orthogonal but either may have
 * determinant −1 (callers that need rotations fix the sign, see
 * `nearestRotation`). Rank-deficient inputs get a completed orthonormal `u`.
 */
export function svd3(a: Mat3, out?: Svd3): Svd3 {
  const res = out ?? { u: new Float64Array(9), s: new Float64Array(3), v: new Float64Array(9) };
  const u = res.u;
  const v = res.v;
  const s = res.s;
  u.set(a);
  v.fill(0);
  v[0] = v[4] = v[8] = 1;

  for (let sweep = 0; sweep < 30; sweep++) {
    let rotated = false;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < 3; i++) {
          const up = u[3 * i + p]!;
          const uq = u[3 * i + q]!;
          alpha += up * up;
          beta += uq * uq;
          gamma += up * uq;
        }
        if (gamma === 0 || Math.abs(gamma) <= EPS * Math.sqrt(alpha * beta)) continue;
        rotated = true;
        // rotation that makes columns p and q orthogonal (smaller root of t² + 2ζt − 1 = 0)
        const zeta = (beta - alpha) / (2 * gamma);
        const t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const sn = c * t;
        for (let i = 0; i < 3; i++) {
          const up = u[3 * i + p]!;
          const uq = u[3 * i + q]!;
          u[3 * i + p] = c * up - sn * uq;
          u[3 * i + q] = sn * up + c * uq;
          const vp = v[3 * i + p]!;
          const vq = v[3 * i + q]!;
          v[3 * i + p] = c * vp - sn * vq;
          v[3 * i + q] = sn * vp + c * vq;
        }
      }
    }
    if (!rotated) break;
  }

  // singular values = column norms of A·V; sort descending (swap columns of u and v)
  for (let j = 0; j < 3; j++) {
    s[j] = Math.hypot(u[j]!, u[3 + j]!, u[6 + j]!);
  }
  for (let i = 0; i < 2; i++) {
    let best = i;
    for (let j = i + 1; j < 3; j++) if (s[j]! > s[best]!) best = j;
    if (best !== i) {
      swapColumns(u, i, best);
      swapColumns(v, i, best);
      const tmp = s[i]!;
      s[i] = s[best]!;
      s[best] = tmp;
    }
  }

  // normalise u's columns; complete the basis where a singular value vanishes
  const tiny = (s[0]! > 0 ? s[0]! : 1) * 1e-300;
  let rank = 0;
  for (let j = 0; j < 3; j++) {
    const sj = s[j]!;
    if (sj > tiny && sj > s[0]! * EPS * 4) {
      u[j] = u[j]! / sj;
      u[3 + j] = u[3 + j]! / sj;
      u[6 + j] = u[6 + j]! / sj;
      rank++;
    } else {
      s[j] = sj; // kept as computed (tiny), its u column is replaced below
    }
  }
  if (rank < 3) completeBasis(u, rank);
  return res;
}

function swapColumns(m: Float64Array, i: number, j: number): void {
  for (let r = 0; r < 3; r++) {
    const t = m[3 * r + i]!;
    m[3 * r + i] = m[3 * r + j]!;
    m[3 * r + j] = t;
  }
}

/** Replaces columns rank…2 of a 3×3 matrix with unit vectors orthogonal to the first `rank`. */
function completeBasis(u: Float64Array, rank: number): void {
  if (rank === 0) {
    u.fill(0);
    u[0] = u[4] = u[8] = 1;
    return;
  }
  if (rank === 1) {
    // pick the axis least aligned with column 0, Gram–Schmidt it
    // prettier-ignore
    const x = u[0]!, y = u[3]!, z = u[6]!;
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    const az = Math.abs(z);
    let ex = 0;
    let ey = 0;
    let ez = 0;
    if (ax <= ay && ax <= az) ex = 1;
    else if (ay <= az) ey = 1;
    else ez = 1;
    const d = ex * x + ey * y + ez * z;
    ex -= d * x;
    ey -= d * y;
    ez -= d * z;
    const n = Math.hypot(ex, ey, ez);
    u[1] = ex / n;
    u[4] = ey / n;
    u[7] = ez / n;
  }
  // column 2 = column 0 × column 1
  // prettier-ignore
  const x0 = u[0]!, y0 = u[3]!, z0 = u[6]!;
  // prettier-ignore
  const x1 = u[1]!, y1 = u[4]!, z1 = u[7]!;
  u[2] = y0 * z1 - z0 * y1;
  u[5] = z0 * x1 - x0 * z1;
  u[8] = x0 * y1 - y0 * x1;
}

/** Scratch for `symmetricEigen`, reusable across calls of the same n. */
export interface EigenScratch {
  a: Float64Array;
}

/**
 * Eigen-decomposition of a symmetric n×n row-major matrix by cyclic Jacobi.
 * Writes eigenvalues **ascending** into `values` (length n) and the matching
 * unit eigenvectors as the **columns** of `vectors` (row-major n×n), so
 * `a · vectors[:, k] = values[k] · vectors[:, k]`. `a` is not modified (only its
 * upper triangle is read).
 */
export function symmetricEigen(
  a: Float64Array,
  n: number,
  values: Float64Array,
  vectors: Float64Array,
  scratch?: EigenScratch,
): void {
  const m = scratch && scratch.a.length >= n * n ? scratch.a : new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) m[r * n + c] = r <= c ? a[r * n + c]! : a[c * n + r]!;
  }
  vectors.fill(0, 0, n * n);
  for (let i = 0; i < n; i++) vectors[i * n + i] = 1;

  let norm = 0;
  for (let i = 0; i < n * n; i++) norm += m[i]! * m[i]!;
  const tol = norm * EPS * EPS;

  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += m[p * n + q]! ** 2;
    if (off <= tol || off === 0) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = m[p * n + q]!;
        if (apq === 0) continue;
        const app = m[p * n + p]!;
        const aqq = m[q * n + q]!;
        // skip rotations that can no longer change the diagonal (Rutishauser's test)
        if (Math.abs(apq) < EPS * 0.5 * Math.min(Math.abs(app), Math.abs(aqq)) && sweep > 3) {
          m[p * n + q] = 0;
          m[q * n + p] = 0;
          continue;
        }
        const tau = (aqq - app) / (2 * apq);
        const t = (tau >= 0 ? 1 : -1) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        // A ← Jᵀ A J with J = rotation in the (p, q) plane
        for (let k = 0; k < n; k++) {
          const akp = m[k * n + p]!;
          const akq = m[k * n + q]!;
          m[k * n + p] = c * akp - s * akq;
          m[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = m[p * n + k]!;
          const aqk = m[q * n + k]!;
          m[p * n + k] = c * apk - s * aqk;
          m[q * n + k] = s * apk + c * aqk;
        }
        m[p * n + q] = 0;
        m[q * n + p] = 0;
        for (let k = 0; k < n; k++) {
          const vkp = vectors[k * n + p]!;
          const vkq = vectors[k * n + q]!;
          vectors[k * n + p] = c * vkp - s * vkq;
          vectors[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  for (let i = 0; i < n; i++) values[i] = m[i * n + i]!;
  // selection sort ascending, permuting eigenvector columns alongside
  for (let i = 0; i < n - 1; i++) {
    let best = i;
    for (let j = i + 1; j < n; j++) if (values[j]! < values[best]!) best = j;
    if (best === i) continue;
    const tv = values[i]!;
    values[i] = values[best]!;
    values[best] = tv;
    for (let k = 0; k < n; k++) {
      const t = vectors[k * n + i]!;
      vectors[k * n + i] = vectors[k * n + best]!;
      vectors[k * n + best] = t;
    }
  }
}
