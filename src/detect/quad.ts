/**
 * Detector step 3b (ARCHITECTURE.md §4.1): turn an outer border into a quad
 * candidate.
 *
 * - Douglas–Peucker (Douglas & Peucker, Cartographica 10(2), 1973) on the
 *   closed contour with ε = 0.03 × perimeter, seeded with two far-apart contour
 *   points (the farthest point from the first, then the farthest from that).
 *   Vertices closer than ε to the chord of their neighbours are then dropped
 *   (seeding can split an edge mid-way); exactly four must remain.
 * - Each side is re-estimated by a total-least-squares line through the contour
 *   points between its two vertices (ends trimmed, where corners are rounded),
 *   shifted half a pixel outward (contour points are the centres of the
 *   outermost black pixels); corners are the intersections of adjacent lines.
 *   This only seeds the edge refinement (refine.ts), which searches ±(d + 1) px.
 * - Filters: convex, every side ≥ `minSidePx` (search-image px), interior
 *   angles 20°–160°.
 *
 * Input: contour points in search-image pixels (integers, counter-clockwise on
 * screen). Output: four corners in **full-resolution** pixels, clockwise on
 * screen (y down), mapped from the search image by full = (p + 0.5)·d − 0.5.
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction.
 */

/** cos 20° and cos 160°: limits on interior angles. */
const COS_MIN_ANGLE = Math.cos((20 * Math.PI) / 180);
/** Douglas–Peucker vertices allowed before the collinear clean-up. */
const MAX_DP_VERTICES = 12;

export interface QuadFitOptions {
  /** minimum contour length, search-image px */
  minPerimeterPx: number;
  /** minimum side length, search-image px */
  minSidePx: number;
  /** decimation factor of the search image (1 or 2) */
  decimate: number;
}

/** Quad fitting with preallocated scratch for contours of up to `maxPoints` points. */
export class QuadFitter {
  private readonly stack: Int32Array;
  private readonly verts = new Int32Array(MAX_DP_VERTICES);
  private readonly lines = new Float64Array(16); // per side: cx, cy, tx, ty
  private readonly corners = new Float64Array(8);

  constructor(readonly maxPoints: number) {
    this.stack = new Int32Array(2 * maxPoints + 8);
  }

  /**
   * Fits a quad to the closed contour `xs`/`ys` (n points). On success writes
   * the corners (full-res px, clockwise on screen) to `out[0…7]` as x0, y0, …
   * and returns true.
   */
  fit(xs: Int32Array, ys: Int32Array, n: number, o: QuadFitOptions, out: Float64Array): boolean {
    if (n < 8) return false;
    let perimeter = 0;
    for (let i = 0; i < n; i++) {
      const j = i + 1 < n ? i + 1 : 0;
      perimeter += xs[i] !== xs[j] && ys[i] !== ys[j] ? Math.SQRT2 : 1;
    }
    if (perimeter < o.minPerimeterPx) return false;
    const eps = 0.03 * perimeter;

    const iA = farthest(xs, ys, n, xs[0]!, ys[0]!);
    const iB = farthest(xs, ys, n, xs[iA]!, ys[iA]!);
    if (iA === iB) return false;

    // Douglas–Peucker on both arcs; indices unwrapped (k ≥ n means k − n)
    const verts = this.verts;
    let nv = 0;
    verts[nv++] = iA;
    verts[nv++] = iB;
    const stack = this.stack;
    let sp = 0;
    const b2 = iB > iA ? iB : iB + n;
    stack[sp++] = iA;
    stack[sp++] = b2;
    stack[sp++] = b2;
    stack[sp++] = iA + n;
    const eps2 = eps * eps;
    while (sp > 0) {
      const e = stack[--sp]!;
      const s = stack[--sp]!;
      if (e - s < 2) continue;
      const sx = xs[s % n]!;
      const sy = ys[s % n]!;
      const dx = xs[e % n]! - sx;
      const dy = ys[e % n]! - sy;
      const len2 = dx * dx + dy * dy;
      let best = -1;
      let bestD2 = eps2;
      for (let k = s + 1; k < e; k++) {
        const kk = k % n;
        const px = xs[kk]! - sx;
        const py = ys[kk]! - sy;
        let d2: number;
        if (len2 > 0) {
          const c = px * dy - py * dx;
          d2 = (c * c) / len2;
        } else {
          d2 = px * px + py * py;
        }
        if (d2 > bestD2) {
          bestD2 = d2;
          best = k;
        }
      }
      if (best < 0) continue;
      if (nv === MAX_DP_VERTICES) return false; // far too many corners for a quad
      verts[nv++] = best % n;
      stack[sp++] = s;
      stack[sp++] = best;
      stack[sp++] = best;
      stack[sp++] = e;
    }
    if (nv < 4) return false;
    // sort the vertex indices (contour order = counter-clockwise on screen)
    for (let i = 1; i < nv; i++) {
      const v = verts[i]!;
      let j = i - 1;
      while (j >= 0 && verts[j]! > v) {
        verts[j + 1] = verts[j]!;
        j--;
      }
      verts[j + 1] = v;
    }
    // The far-point seeds can be adjacent corners; the next split then lands
    // mid-edge and leaves a nearly collinear vertex (or two vertices on one
    // rounded corner). Drop the vertex nearest its neighbours' chord while that
    // distance is < ε.
    while (nv > 4) {
      let drop = -1;
      let dropD2 = eps2;
      for (let i = 0; i < nv; i++) {
        const a = verts[i > 0 ? i - 1 : nv - 1]!;
        const v = verts[i]!;
        const b = verts[i < nv - 1 ? i + 1 : 0]!;
        const ax = xs[a]!;
        const ay = ys[a]!;
        const dx = xs[b]! - ax;
        const dy = ys[b]! - ay;
        const len2 = dx * dx + dy * dy;
        const c = (xs[v]! - ax) * dy - (ys[v]! - ay) * dx;
        const d2 = len2 > 0 ? (c * c) / len2 : 0;
        if (d2 < dropD2) {
          dropD2 = d2;
          drop = i;
        }
      }
      if (drop < 0) return false; // ≥ 5 real corners
      for (let i = drop; i < nv - 1; i++) verts[i] = verts[i + 1]!;
      nv--;
    }

    // centroid of the vertices, to orient the side normals outward
    let qx = 0;
    let qy = 0;
    for (let i = 0; i < 4; i++) {
      qx += xs[verts[i]!]! / 4;
      qy += ys[verts[i]!]! / 4;
    }

    // a total-least-squares line per side, shifted 0.5 px outward
    const lines = this.lines;
    for (let side = 0; side < 4; side++) {
      const a = verts[side]!;
      const b = side < 3 ? verts[side + 1]! : verts[0]! + n;
      const m = b - a + 1;
      const trim = m > 6 ? Math.max(1, Math.round(0.12 * m)) : 0;
      let sx = 0;
      let sy = 0;
      let cnt = 0;
      for (let k = a + trim; k <= b - trim; k++) {
        sx += xs[k % n]!;
        sy += ys[k % n]!;
        cnt++;
      }
      let cx: number;
      let cy: number;
      let tx: number;
      let ty: number;
      const ax = xs[a % n]!;
      const ay = ys[a % n]!;
      const bx = xs[b % n]!;
      const by = ys[b % n]!;
      if (cnt >= 3) {
        cx = sx / cnt;
        cy = sy / cnt;
        let cxx = 0;
        let cxy = 0;
        let cyy = 0;
        for (let k = a + trim; k <= b - trim; k++) {
          const px = xs[k % n]! - cx;
          const py = ys[k % n]! - cy;
          cxx += px * px;
          cxy += px * py;
          cyy += py * py;
        }
        const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
        tx = Math.cos(theta);
        ty = Math.sin(theta);
      } else {
        cx = (ax + bx) / 2;
        cy = (ay + by) / 2;
        const l = Math.hypot(bx - ax, by - ay);
        if (l === 0) return false;
        tx = (bx - ax) / l;
        ty = (by - ay) / l;
      }
      // outward normal: away from the quad's centroid
      let nx = -ty;
      let ny = tx;
      if (nx * (cx - qx) + ny * (cy - qy) < 0) {
        nx = -nx;
        ny = -ny;
      }
      lines[side * 4] = cx + 0.5 * nx;
      lines[side * 4 + 1] = cy + 0.5 * ny;
      lines[side * 4 + 2] = tx;
      lines[side * 4 + 3] = ty;
    }

    // corner at vertex i = intersection of side i − 1 and side i, reversed to clockwise
    const c = this.corners;
    for (let i = 0; i < 4; i++) {
      const p = ((i + 3) & 3) * 4;
      const q = i * 4;
      if (!intersect(lines, p, q, c, ((4 - i) & 3) * 2)) return false;
    }
    if (!quadShapeOk(c, o.minSidePx)) return false;

    const d = o.decimate;
    for (let i = 0; i < 8; i++) out[i] = d === 1 ? c[i]! : (c[i]! + 0.5) * d - 0.5;
    return true;
  }
}

/** Index of the contour point farthest from (x, y). */
function farthest(xs: Int32Array, ys: Int32Array, n: number, x: number, y: number): number {
  let best = 0;
  let bestD2 = -1;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - x;
    const dy = ys[i]! - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > bestD2) {
      bestD2 = d2;
      best = i;
    }
  }
  return best;
}

/**
 * Intersection of the lines at `lines[p…p+3]` and `lines[q…q+3]` (point, unit
 * direction), written to out[o], out[o + 1]. False if they are near parallel.
 */
export function intersect(
  lines: Float64Array,
  p: number,
  q: number,
  out: Float64Array,
  o: number,
): boolean {
  const ax = lines[p]!;
  const ay = lines[p + 1]!;
  const atx = lines[p + 2]!;
  const aty = lines[p + 3]!;
  const bx = lines[q]!;
  const by = lines[q + 1]!;
  const btx = lines[q + 2]!;
  const bty = lines[q + 3]!;
  const den = atx * bty - aty * btx;
  if (Math.abs(den) < 1e-6) return false;
  const s = ((bx - ax) * bty - (by - ay) * btx) / den;
  out[o] = ax + s * atx;
  out[o + 1] = ay + s * aty;
  return true;
}

/**
 * Corners c (x0, y0, …, clockwise on screen): convex, sides ≥ minSidePx,
 * interior angles within 20°–160°.
 */
export function quadShapeOk(c: Float64Array, minSidePx: number): boolean {
  for (let i = 0; i < 4; i++) {
    const i0 = ((i + 3) & 3) * 2;
    const i1 = i * 2;
    const i2 = ((i + 1) & 3) * 2;
    // edges into and out of corner i
    const ex = c[i1]! - c[i0]!;
    const ey = c[i1 + 1]! - c[i0 + 1]!;
    const fx = c[i2]! - c[i1]!;
    const fy = c[i2 + 1]! - c[i1 + 1]!;
    const le = Math.hypot(ex, ey);
    const lf = Math.hypot(fx, fy);
    if (!(lf >= minSidePx) || !(le > 0)) return false;
    // clockwise on screen (y down) ⇔ positive cross product at every corner
    if (ex * fy - ey * fx <= 0) return false;
    // interior angle between −e and f
    const cos = -(ex * fx + ey * fy) / (le * lf);
    if (cos > COS_MIN_ANGLE || cos < -COS_MIN_ANGLE) return false;
  }
  return true;
}
