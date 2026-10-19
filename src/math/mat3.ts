/**
 * 3×3 matrices, **row-major** (`Mat3`, ARCHITECTURE.md §2.5): element (r, c) is
 * `m[3r + c]`. Plain functions on Float64Array. Every `out` may alias an input
 * (results are computed into locals first) unless noted otherwise.
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads (indices 0…8 or
 * 0…2), in range by construction.
 */
import type { Mat3 } from '../types.js';

/** A new zero 3×3 matrix. */
export function mat3Create(): Mat3 {
  return new Float64Array(9);
}

/** Identity (row-major). */
export function mat3Identity(out: Mat3 = new Float64Array(9)): Mat3 {
  out.fill(0);
  out[0] = out[4] = out[8] = 1;
  return out;
}

/** Copies `a` into `out`. */
export function mat3Copy(a: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  out.set(a);
  return out;
}

/** `a · b` (row-major). */
export function mat3Mul(a: Mat3, b: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  // prettier-ignore
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!, a4 = a[4]!, a5 = a[5]!;
  // prettier-ignore
  const a6 = a[6]!, a7 = a[7]!, a8 = a[8]!;
  // prettier-ignore
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!, b4 = b[4]!, b5 = b[5]!;
  // prettier-ignore
  const b6 = b[6]!, b7 = b[7]!, b8 = b[8]!;
  out[0] = a0 * b0 + a1 * b3 + a2 * b6;
  out[1] = a0 * b1 + a1 * b4 + a2 * b7;
  out[2] = a0 * b2 + a1 * b5 + a2 * b8;
  out[3] = a3 * b0 + a4 * b3 + a5 * b6;
  out[4] = a3 * b1 + a4 * b4 + a5 * b7;
  out[5] = a3 * b2 + a4 * b5 + a5 * b8;
  out[6] = a6 * b0 + a7 * b3 + a8 * b6;
  out[7] = a6 * b1 + a7 * b4 + a8 * b7;
  out[8] = a6 * b2 + a7 * b5 + a8 * b8;
  return out;
}

/** `aᵀ · b` (row-major), without forming the transpose. */
export function mat3MulTransposeA(a: Mat3, b: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  // prettier-ignore
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!, a4 = a[4]!, a5 = a[5]!;
  // prettier-ignore
  const a6 = a[6]!, a7 = a[7]!, a8 = a[8]!;
  // prettier-ignore
  const b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!, b4 = b[4]!, b5 = b[5]!;
  // prettier-ignore
  const b6 = b[6]!, b7 = b[7]!, b8 = b[8]!;
  out[0] = a0 * b0 + a3 * b3 + a6 * b6;
  out[1] = a0 * b1 + a3 * b4 + a6 * b7;
  out[2] = a0 * b2 + a3 * b5 + a6 * b8;
  out[3] = a1 * b0 + a4 * b3 + a7 * b6;
  out[4] = a1 * b1 + a4 * b4 + a7 * b7;
  out[5] = a1 * b2 + a4 * b5 + a7 * b8;
  out[6] = a2 * b0 + a5 * b3 + a8 * b6;
  out[7] = a2 * b1 + a5 * b4 + a8 * b7;
  out[8] = a2 * b2 + a5 * b5 + a8 * b8;
  return out;
}

/** Transpose. */
export function mat3Transpose(a: Mat3, out: Mat3 = new Float64Array(9)): Mat3 {
  // prettier-ignore
  const a1 = a[1]!, a2 = a[2]!, a5 = a[5]!;
  out[0] = a[0]!;
  out[4] = a[4]!;
  out[8] = a[8]!;
  out[1] = a[3]!;
  out[3] = a1;
  out[2] = a[6]!;
  out[6] = a2;
  out[5] = a[7]!;
  out[7] = a5;
  return out;
}

/** Determinant. */
export function mat3Det(a: Mat3): number {
  return (
    a[0]! * (a[4]! * a[8]! - a[5]! * a[7]!) -
    a[1]! * (a[3]! * a[8]! - a[5]! * a[6]!) +
    a[2]! * (a[3]! * a[7]! - a[4]! * a[6]!)
  );
}

/** Inverse by cofactors; `null` if the determinant is zero or not finite. */
export function mat3Invert(a: Mat3, out: Mat3 = new Float64Array(9)): Mat3 | null {
  // prettier-ignore
  const a0 = a[0]!, a1 = a[1]!, a2 = a[2]!, a3 = a[3]!, a4 = a[4]!, a5 = a[5]!;
  // prettier-ignore
  const a6 = a[6]!, a7 = a[7]!, a8 = a[8]!;
  const c0 = a4 * a8 - a5 * a7;
  const c3 = a5 * a6 - a3 * a8;
  const c6 = a3 * a7 - a4 * a6;
  const det = a0 * c0 + a1 * c3 + a2 * c6;
  if (det === 0 || !Number.isFinite(det)) return null;
  const s = 1 / det;
  out[0] = c0 * s;
  out[1] = (a2 * a7 - a1 * a8) * s;
  out[2] = (a1 * a5 - a2 * a4) * s;
  out[3] = c3 * s;
  out[4] = (a0 * a8 - a2 * a6) * s;
  out[5] = (a2 * a3 - a0 * a5) * s;
  out[6] = c6 * s;
  out[7] = (a1 * a6 - a0 * a7) * s;
  out[8] = (a0 * a4 - a1 * a3) * s;
  return out;
}

/** `a · v` for a 3-vector. */
export function mat3MulVec(
  a: Mat3,
  v: ArrayLike<number>,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  // prettier-ignore
  const x = v[0]!, y = v[1]!, z = v[2]!;
  out[0] = a[0]! * x + a[1]! * y + a[2]! * z;
  out[1] = a[3]! * x + a[4]! * y + a[5]! * z;
  out[2] = a[6]! * x + a[7]! * y + a[8]! * z;
  return out;
}

/** `aᵀ · v` for a 3-vector. */
export function mat3TransposeMulVec(
  a: Mat3,
  v: ArrayLike<number>,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  // prettier-ignore
  const x = v[0]!, y = v[1]!, z = v[2]!;
  out[0] = a[0]! * x + a[3]! * y + a[6]! * z;
  out[1] = a[1]! * x + a[4]! * y + a[7]! * z;
  out[2] = a[2]! * x + a[5]! * y + a[8]! * z;
  return out;
}

/** Largest absolute element difference between two matrices of the same length. */
export function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
  return m;
}
