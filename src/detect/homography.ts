/**
 * Projective map from the unit square to a quad (8 unknowns, h33 = 1), closed
 * form after Heckbert, "Fundamentals of Texture Mapping and Image Warping"
 * (UC Berkeley MS thesis, 1989, §2.2.3). Used to sample tag cells.
 *
 * (0, 0) → q0, (1, 0) → q1, (1, 1) → q2, (0, 1) → q3, with
 * x = (a·u + b·v + c) / (g·u + h·v + 1), y = (d·u + e·v + f) / (g·u + h·v + 1).
 * Output `m` = [a, b, c, d, e, f, g, h, 1] (row-major 3 × 3).
 *
 * Non-null assertions (`!`) are on fixed-length array reads.
 */

/** Writes the square → quad homography of corners `q` (x0, y0, …, x3, y3). False if degenerate. */
export function squareToQuad(q: Float64Array, m: Float64Array): boolean {
  const x0 = q[0]!;
  const y0 = q[1]!;
  const x1 = q[2]!;
  const y1 = q[3]!;
  const x2 = q[4]!;
  const y2 = q[5]!;
  const x3 = q[6]!;
  const y3 = q[7]!;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (sx !== 0 || sy !== 0) {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-12) return false;
    g = (sx * dy2 - dx2 * sy) / det;
    h = (dx1 * sy - sx * dy1) / det;
  }
  m[0] = x1 - x0 + g * x1;
  m[1] = x3 - x0 + h * x3;
  m[2] = x0;
  m[3] = y1 - y0 + g * y1;
  m[4] = y3 - y0 + h * y3;
  m[5] = y0;
  m[6] = g;
  m[7] = h;
  m[8] = 1;
  return true;
}
