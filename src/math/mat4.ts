/**
 * 4×4 matrices, **column-major** (`Mat4`, three.js `Matrix4.elements` order,
 * ARCHITECTURE.md §2.5): element (row r, column c) is `m[4c + r]`, the
 * translation of a rigid transform is `m[12…14]`. Every `out` may alias an
 * input unless noted otherwise.
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads (indices
 * 0…15), in range by construction.
 */
import type { Mat3, Mat4 } from '../types.js';

/** Identity (column-major). */
export function mat4Identity(out: Mat4 = new Float64Array(16)): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** `a · b` (column-major). `out` may alias `a` or `b`. */
export function mat4Mul(a: Mat4, b: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  const r = out === a || out === b ? scratch : out;
  for (let c = 0; c < 4; c++) {
    // prettier-ignore
    const b0 = b[4 * c]!, b1 = b[4 * c + 1]!, b2 = b[4 * c + 2]!, b3 = b[4 * c + 3]!;
    for (let i = 0; i < 4; i++) {
      r[4 * c + i] = a[i]! * b0 + a[4 + i]! * b1 + a[8 + i]! * b2 + a[12 + i]! * b3;
    }
  }
  if (r !== out) out.set(r);
  return out;
}

const scratch = new Float64Array(16);

/** General inverse by cofactors (column-major); `null` if singular. */
export function mat4Invert(a: Mat4, out: Mat4 = new Float64Array(16)): Mat4 | null {
  // m_rc = a[4c + r]
  // prettier-ignore
  const a00 = a[0]!, a10 = a[1]!, a20 = a[2]!, a30 = a[3]!;
  // prettier-ignore
  const a01 = a[4]!, a11 = a[5]!, a21 = a[6]!, a31 = a[7]!;
  // prettier-ignore
  const a02 = a[8]!, a12 = a[9]!, a22 = a[10]!, a32 = a[11]!;
  // prettier-ignore
  const a03 = a[12]!, a13 = a[13]!, a23 = a[14]!, a33 = a[15]!;
  // 2×2 minors of the top two rows (s) and bottom two rows (c)
  const s0 = a00 * a11 - a01 * a10;
  const s1 = a00 * a12 - a02 * a10;
  const s2 = a00 * a13 - a03 * a10;
  const s3 = a01 * a12 - a02 * a11;
  const s4 = a01 * a13 - a03 * a11;
  const s5 = a02 * a13 - a03 * a12;
  const c5 = a22 * a33 - a23 * a32;
  const c4 = a21 * a33 - a23 * a31;
  const c3 = a21 * a32 - a22 * a31;
  const c2 = a20 * a33 - a23 * a30;
  const c1 = a20 * a32 - a22 * a30;
  const c0 = a20 * a31 - a21 * a30;
  const det = s0 * c5 - s1 * c4 + s2 * c3 + s3 * c2 - s4 * c1 + s5 * c0;
  if (det === 0 || !Number.isFinite(det)) return null;
  const k = 1 / det;
  // inverse element (r, c) goes to out[4c + r]
  out[0] = (a11 * c5 - a12 * c4 + a13 * c3) * k;
  out[4] = (-a01 * c5 + a02 * c4 - a03 * c3) * k;
  out[8] = (a31 * s5 - a32 * s4 + a33 * s3) * k;
  out[12] = (-a21 * s5 + a22 * s4 - a23 * s3) * k;
  out[1] = (-a10 * c5 + a12 * c2 - a13 * c1) * k;
  out[5] = (a00 * c5 - a02 * c2 + a03 * c1) * k;
  out[9] = (-a30 * s5 + a32 * s2 - a33 * s1) * k;
  out[13] = (a20 * s5 - a22 * s2 + a23 * s1) * k;
  out[2] = (a10 * c4 - a11 * c2 + a13 * c0) * k;
  out[6] = (-a00 * c4 + a01 * c2 - a03 * c0) * k;
  out[10] = (a30 * s4 - a31 * s2 + a33 * s0) * k;
  out[14] = (-a20 * s4 + a21 * s2 - a23 * s0) * k;
  out[3] = (-a10 * c3 + a11 * c1 - a12 * c0) * k;
  out[7] = (a00 * c3 - a01 * c1 + a02 * c0) * k;
  out[11] = (-a30 * s3 + a31 * s1 - a32 * s0) * k;
  out[15] = (a20 * s3 - a21 * s1 + a22 * s0) * k;
  return out;
}

/**
 * Inverse of a rigid transform [R t; 0 1] (column-major): [Rᵀ −Rᵀt; 0 1].
 * Assumes the upper-left 3×3 is a rotation; use `mat4Invert` otherwise.
 */
export function mat4InvertRigid(a: Mat4, out: Mat4 = new Float64Array(16)): Mat4 {
  // prettier-ignore
  const r00 = a[0]!, r10 = a[1]!, r20 = a[2]!;
  // prettier-ignore
  const r01 = a[4]!, r11 = a[5]!, r21 = a[6]!;
  // prettier-ignore
  const r02 = a[8]!, r12 = a[9]!, r22 = a[10]!;
  // prettier-ignore
  const tx = a[12]!, ty = a[13]!, tz = a[14]!;
  out[0] = r00;
  out[1] = r01;
  out[2] = r02;
  out[3] = 0;
  out[4] = r10;
  out[5] = r11;
  out[6] = r12;
  out[7] = 0;
  out[8] = r20;
  out[9] = r21;
  out[10] = r22;
  out[11] = 0;
  out[12] = -(r00 * tx + r10 * ty + r20 * tz);
  out[13] = -(r01 * tx + r11 * ty + r21 * tz);
  out[14] = -(r02 * tx + r12 * ty + r22 * tz);
  out[15] = 1;
  return out;
}

/** Rigid transform from a rotation (`Mat3`, row-major) and a translation → `Mat4` (column-major). */
export function mat4FromRotationTranslation(
  r: Mat3,
  t: ArrayLike<number>,
  out: Mat4 = new Float64Array(16),
): Mat4 {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[4 * col + row] = r[3 * row + col]!;
    out[12 + row] = t[row]!;
  }
  out[3] = out[7] = out[11] = 0;
  out[15] = 1;
  return out;
}

/** Upper-left 3×3 of a `Mat4` (column-major) as a `Mat3` (row-major). */
export function mat4GetRotation(m: Mat4, out: Mat3 = new Float64Array(9)): Mat3 {
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) out[3 * row + col] = m[4 * col + row]!;
  }
  return out;
}

/** `m · [p, 1]` for an affine `m` (no perspective divide). */
export function mat4TransformPoint(
  m: Mat4,
  p: ArrayLike<number>,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  // prettier-ignore
  const x = p[0]!, y = p[1]!, z = p[2]!;
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  return out;
}

/** `m · v` for a homogeneous 4-vector. */
export function mat4MulVec4(
  m: Mat4,
  v: ArrayLike<number>,
  out: Float64Array = new Float64Array(4),
): Float64Array {
  // prettier-ignore
  const x = v[0]!, y = v[1]!, z = v[2]!, w = v[3]!;
  for (let i = 0; i < 4; i++) {
    out[i] = m[i]! * x + m[4 + i]! * y + m[8 + i]! * z + m[12 + i]! * w;
  }
  return out;
}
