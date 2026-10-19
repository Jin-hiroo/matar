/**
 * Rotations: axis-angle (rotation vector, radians) ↔ matrix (Rodrigues),
 * angles between rotations, the nearest rotation to a matrix, and unit
 * quaternions for the pose filter.
 *
 * Matrices are `Mat3`, **row-major**. Quaternions are Float64Array
 * `[x, y, z, w]` (three.js order), unit length, `q` and `−q` the same rotation.
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads, in range by
 * construction.
 */
import type { Mat3 } from '../types.js';
import { svd3, type Svd3 } from './svd.js';

/** exp: rotation vector ω (axis × angle, radians) → rotation matrix (row-major). */
export function rotationFromAxisAngle(w: ArrayLike<number>, out: Mat3 = new Float64Array(9)): Mat3 {
  const x = w[0]!;
  const y = w[1]!;
  const z = w[2]!;
  const t2 = x * x + y * y + z * z;
  let a: number; // sin θ / θ
  let b: number; // (1 − cos θ) / θ²
  if (t2 < 1e-12) {
    // Taylor series; error O(θ⁴) < 1e-24
    a = 1 - t2 / 6;
    b = 0.5 - t2 / 24;
  } else {
    const t = Math.sqrt(t2);
    a = Math.sin(t) / t;
    b = (1 - Math.cos(t)) / t2;
  }
  // R = I + a·[ω]× + b·[ω]×²
  out[0] = 1 - b * (y * y + z * z);
  out[1] = b * x * y - a * z;
  out[2] = b * x * z + a * y;
  out[3] = b * x * y + a * z;
  out[4] = 1 - b * (x * x + z * z);
  out[5] = b * y * z - a * x;
  out[6] = b * x * z - a * y;
  out[7] = b * y * z + a * x;
  out[8] = 1 - b * (x * x + y * y);
  return out;
}

/** log: rotation matrix (row-major) → rotation vector (radians, angle in [0, π]). Robust near 0 and π. */
export function axisAngleFromRotation(
  r: Mat3,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  const q = quatFromRotation(r, scratchQuat);
  return quatLog(q, out);
}

const scratchQuat = new Float64Array(4);

/** Rotation angle of R, radians in [0, π] (atan2 form, accurate for small angles). */
export function rotationAngle(r: Mat3): number {
  const sx = r[7]! - r[5]!;
  const sy = r[2]! - r[6]!;
  const sz = r[3]! - r[1]!;
  const sin2 = Math.hypot(sx, sy, sz); // 2 sin θ
  const cos2 = r[0]! + r[4]! + r[8]! - 1; // 2 cos θ
  return Math.atan2(sin2, cos2);
}

/** Angle of the relative rotation aᵀ·b, radians in [0, π]. */
export function rotationAngleBetween(a: Mat3, b: Mat3): number {
  // (aᵀb)_ij = Σ_k a_ki b_kj, only the entries the angle needs
  // prettier-ignore
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!, a4 = a[4]!, a5 = a[5]!;
  // prettier-ignore
  const a6 = a[6]!, a7 = a[7]!, a8 = a[8]!;
  // prettier-ignore
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!, b4 = b[4]!, b5 = b[5]!;
  // prettier-ignore
  const b6 = b[6]!, b7 = b[7]!, b8 = b[8]!;
  const m00 = a0 * b0 + a3 * b3 + a6 * b6;
  const m11 = a1 * b1 + a4 * b4 + a7 * b7;
  const m22 = a2 * b2 + a5 * b5 + a8 * b8;
  const m01 = a0 * b1 + a3 * b4 + a6 * b7;
  const m10 = a1 * b0 + a4 * b3 + a7 * b6;
  const m02 = a0 * b2 + a3 * b5 + a6 * b8;
  const m20 = a2 * b0 + a5 * b3 + a8 * b6;
  const m12 = a1 * b2 + a4 * b5 + a7 * b8;
  const m21 = a2 * b1 + a5 * b4 + a8 * b7;
  return Math.atan2(Math.hypot(m21 - m12, m02 - m20, m10 - m01), m00 + m11 + m22 - 1);
}

const svdScratch: Svd3 = { u: new Float64Array(9), s: new Float64Array(3), v: new Float64Array(9) };

/** The rotation nearest to `m` in the Frobenius norm: U·diag(1, 1, det(UVᵀ))·Vᵀ from the SVD. */
export function nearestRotation(m: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  const { u, v } = svd3(m, svdScratch);
  const det =
    u[0]! * (u[4]! * u[8]! - u[5]! * u[7]!) -
    u[1]! * (u[3]! * u[8]! - u[5]! * u[6]!) +
    u[2]! * (u[3]! * u[7]! - u[4]! * u[6]!);
  const detV =
    v[0]! * (v[4]! * v[8]! - v[5]! * v[7]!) -
    v[1]! * (v[3]! * v[8]! - v[5]! * v[6]!) +
    v[2]! * (v[3]! * v[7]! - v[4]! * v[6]!);
  const d = det * detV < 0 ? -1 : 1;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[3 * i + j] =
        u[3 * i]! * v[3 * j]! + u[3 * i + 1]! * v[3 * j + 1]! + d * u[3 * i + 2]! * v[3 * j + 2]!;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Quaternions [x, y, z, w]

/** Unit quaternion of a rotation matrix (row-major), w ≥ 0 (Shepperd's method). */
export function quatFromRotation(r: Mat3, out: Float64Array = new Float64Array(4)): Float64Array {
  // prettier-ignore
  const m00 = r[0]!, m01 = r[1]!, m02 = r[2]!;
  // prettier-ignore
  const m10 = r[3]!, m11 = r[4]!, m12 = r[5]!;
  // prettier-ignore
  const m20 = r[6]!, m21 = r[7]!, m22 = r[8]!;
  const tr = m00 + m11 + m22;
  // prettier-ignore
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 2 * Math.sqrt(tr + 1);
    w = s / 4;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = s / 4;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = s / 4;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = s / 4;
  }
  const n = (w < 0 ? -1 : 1) / Math.hypot(x, y, z, w);
  out[0] = x * n;
  out[1] = y * n;
  out[2] = z * n;
  out[3] = w * n;
  return out;
}

/** Rotation matrix (row-major) of a quaternion (normalised first). */
export function rotationFromQuat(q: ArrayLike<number>, out: Mat3 = new Float64Array(9)): Mat3 {
  // prettier-ignore
  let x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  const n = 1 / Math.hypot(x, y, z, w);
  x *= n;
  y *= n;
  z *= n;
  w *= n;
  out[0] = 1 - 2 * (y * y + z * z);
  out[1] = 2 * (x * y - z * w);
  out[2] = 2 * (x * z + y * w);
  out[3] = 2 * (x * y + z * w);
  out[4] = 1 - 2 * (x * x + z * z);
  out[5] = 2 * (y * z - x * w);
  out[6] = 2 * (x * z - y * w);
  out[7] = 2 * (y * z + x * w);
  out[8] = 1 - 2 * (x * x + y * y);
  return out;
}

/** Hamilton product a ⊗ b (apply b, then a). `out` may alias. */
export function quatMultiply(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  out: Float64Array = new Float64Array(4),
): Float64Array {
  // prettier-ignore
  const ax = a[0]!, ay = a[1]!, az = a[2]!, aw = a[3]!;
  // prettier-ignore
  const bx = b[0]!, by = b[1]!, bz = b[2]!, bw = b[3]!;
  out[0] = aw * bx + ax * bw + ay * bz - az * by;
  out[1] = aw * by - ax * bz + ay * bw + az * bx;
  out[2] = aw * bz + ax * by - ay * bx + az * bw;
  out[3] = aw * bw - ax * bx - ay * by - az * bz;
  return out;
}

/** Conjugate (= inverse for unit quaternions). `out` may alias. */
export function quatConjugate(
  q: ArrayLike<number>,
  out: Float64Array = new Float64Array(4),
): Float64Array {
  out[0] = -q[0]!;
  out[1] = -q[1]!;
  out[2] = -q[2]!;
  out[3] = q[3]!;
  return out;
}

/** log of a unit quaternion as a rotation vector (axis × full angle, radians, shortest arc). */
export function quatLog(
  q: ArrayLike<number>,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  // prettier-ignore
  let x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const s = Math.hypot(x, y, z);
  // angle θ = 2·atan2(s, w); ω = θ·v/s, with θ/s → 2/w as s → 0
  const k = s < 1e-12 ? 2 / w : (2 * Math.atan2(s, w)) / s;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
  return out;
}

/** exp of a rotation vector (radians) as a unit quaternion. */
export function quatExp(
  v: ArrayLike<number>,
  out: Float64Array = new Float64Array(4),
): Float64Array {
  // prettier-ignore
  const x = v[0]!, y = v[1]!, z = v[2]!;
  const t = Math.hypot(x, y, z);
  const h = t / 2;
  const k = t < 1e-12 ? 0.5 - (t * t) / 48 : Math.sin(h) / t;
  out[0] = x * k;
  out[1] = y * k;
  out[2] = z * k;
  out[3] = Math.cos(h);
  return out;
}
