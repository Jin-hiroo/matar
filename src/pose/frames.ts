/**
 * Camera conventions: the **only** place that converts between the CV camera
 * used inside the solver and the GL camera of the public API
 * (ARCHITECTURE.md §2.4–2.6).
 *
 * - CV camera: +X right, +Y down, +Z forward. Solver state is
 *   `cameraFromBoard` = (R, t): board mm → CV camera mm, R a `Mat3` (row-major).
 * - GL camera: +X right, +Y up, −Z forward; GL = CV · diag(1, −1, −1).
 *   Public poses are `boardFromCamera` (GL → board, mm), a `Mat4`
 *   (column-major): boardFromCamera = inverse(cameraFromBoard_CV) · diag(1, −1, −1, 1).
 * - Pixels: centres at integer coordinates; a w-pixel row spans [−0.5, w − 0.5].
 *
 * Non-null assertions (`!`) are on fixed-size typed-array reads, in range by
 * construction.
 */
import type { CameraIntrinsics, Mat3, Mat4 } from '../types.js';

/**
 * `boardFromCamera` (GL, mm, column-major) from the solver's `cameraFromBoard`
 * in CV convention: rotation `r` (row-major) and translation `t` (mm).
 */
export function boardFromCameraGl(
  r: Mat3,
  t: ArrayLike<number>,
  out: Mat4 = new Float64Array(16),
): Mat4 {
  const tx = t[0]!, ty = t[1]!, tz = t[2]!; // prettier-ignore
  // inverse(cameraFromBoard) = [Rᵀ | −Rᵀt]; · diag(1, −1, −1, 1) negates columns 1 and 2.
  // Column c of Rᵀ is row c of R.
  out[0] = r[0]!;
  out[1] = r[1]!;
  out[2] = r[2]!;
  out[3] = 0;
  out[4] = -r[3]!;
  out[5] = -r[4]!;
  out[6] = -r[5]!;
  out[7] = 0;
  out[8] = -r[6]!;
  out[9] = -r[7]!;
  out[10] = -r[8]!;
  out[11] = 0;
  out[12] = -(r[0]! * tx + r[3]! * ty + r[6]! * tz);
  out[13] = -(r[1]! * tx + r[4]! * ty + r[7]! * tz);
  out[14] = -(r[2]! * tx + r[5]! * ty + r[8]! * tz);
  out[15] = 1;
  return out;
}

/**
 * The solver's `cameraFromBoard` (CV) from a public `boardFromCamera` (GL, mm,
 * column-major). Writes the rotation (row-major) into `r` and the translation
 * (mm) into `t`. Inverse of `boardFromCameraGl`; assumes a rigid transform.
 */
export function cameraFromBoardCv(boardFromCamera: Mat4, r: Mat3, t: Float64Array): void {
  const m = boardFromCamera;
  // boardFromCamera = [B | c] with B = Rᵀ·D, D = diag(1, −1, −1) → R = D·Bᵀ, t = −R·c.
  // Row i of Bᵀ is column i of B: m[4i…4i+2].
  r[0] = m[0]!;
  r[1] = m[1]!;
  r[2] = m[2]!;
  r[3] = -m[4]!;
  r[4] = -m[5]!;
  r[5] = -m[6]!;
  r[6] = -m[8]!;
  r[7] = -m[9]!;
  r[8] = -m[10]!;
  const cx = m[12]!, cy = m[13]!, cz = m[14]!; // prettier-ignore
  t[0] = -(r[0]! * cx + r[1]! * cy + r[2]! * cz);
  t[1] = -(r[3]! * cx + r[4]! * cy + r[5]! * cz);
  t[2] = -(r[6]! * cx + r[7]! * cy + r[8]! * cz);
}

/** A point in CV camera coordinates → GL camera coordinates (and back: the map is its own inverse). */
export function cvToGlPoint(
  p: ArrayLike<number>,
  out: Float64Array = new Float64Array(3),
): Float64Array {
  out[0] = p[0]!;
  out[1] = -p[1]!;
  out[2] = -p[2]!;
  return out;
}

/** A point in GL camera coordinates → CV camera coordinates. */
export const glToCvPoint = cvToGlPoint;

/**
 * three.js/WebGL projection matrix (column-major, NDC z ∈ [−1, 1]) for a frame
 * with intrinsics `k`; `near` and `far` in camera-space units (mm in core,
 * metres in `matar/three`). Pixel centres are integers, so the image edges sit
 * at −0.5 and w − 0.5: the frustum at the near plane is
 * l = −n(cx + 0.5)/fx, r = n(w − cx − 0.5)/fx, t = n(cy + 0.5)/fy,
 * b = −n(h − cy − 0.5)/fy, then the standard glFrustum. Equivalent to the
 * matrix in ARCHITECTURE.md §2.6.
 */
export function projectionFromIntrinsics(
  k: CameraIntrinsics,
  near: number,
  far: number,
  out: Mat4 = new Float64Array(16),
): Mat4 {
  if (!(near > 0) || !(far > near)) {
    throw new Error(`matar: projection needs 0 < near < far (got ${near}, ${far})`);
  }
  const n = near;
  const l = (-n * (k.cx + 0.5)) / k.fx;
  const r = (n * (k.width - k.cx - 0.5)) / k.fx;
  const t = (n * (k.cy + 0.5)) / k.fy;
  const b = (-n * (k.height - k.cy - 0.5)) / k.fy;
  out.fill(0);
  out[0] = (2 * n) / (r - l);
  out[5] = (2 * n) / (t - b);
  out[8] = (r + l) / (r - l);
  out[9] = (t + b) / (t - b);
  out[10] = -(far + n) / (far - n);
  out[11] = -1;
  out[14] = (-2 * far * n) / (far - n);
  return out;
}
