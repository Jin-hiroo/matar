/**
 * Detector step 4 (ARCHITECTURE.md §4.1): sub-pixel edge refinement on the
 * full-resolution gray image.
 *
 * Follows the idea of AprilTag 3's `refine_edges()` (apriltag.c, BSD-2-Clause,
 * University of Michigan; Krogius et al., IROS 2019), re-implemented with
 * matar's conventions rather than ported:
 *
 * - pixel centres at integer coordinates (AprilTag samples at +0.5);
 * - gray values are **linearised** through a 256-entry LUT
 *   `lin[v] = (v / 255)^edgeGamma` before any gradient is taken. Optical blur
 *   happens in linear light and cameras gamma-encode afterwards, so gradients of
 *   encoded values peak on the ink side of the true edge (≈ 0.5 px at
 *   σ = 0.8 px); in linear light the blurred step is symmetric about the edge;
 * - bilinear sampling (AprilTag uses nearest pixels).
 *
 * For each side, points are sampled along the current line (keeping clear of
 * the corners, where the adjacent side's edge interferes). At each point the
 * profile is searched over ±(d + 1) px along the outward normal at 4 steps/px;
 * the gradient at each step is the difference of samples ±0.5 px apart, steps
 * whose gradient has the wrong sign (not dark inside → bright outside) are
 * dropped, and the edge point is the gradient²-weighted mean offset. A weighted
 * total-least-squares line is fitted per side (weights = Σ gradient²) and the
 * corners are the intersections of adjacent lines. Two passes; the second is
 * centred on the first pass's lines.
 *
 * Corners in/out: full-res px, clockwise on screen (y down), x0, y0, …, x3, y3.
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction (bounds are checked before sampling).
 */
import { intersect, quadShapeOk } from './quad.js';

/** Profile steps per pixel along the normal. */
const STEPS_PER_PX = 4;
/** Sample spacing along a side, px. */
const SAMPLE_SPACING_PX = 1.5;
/** Most samples per side. */
const MAX_SAMPLES = 128;
/** Refinement passes. */
const PASSES = 2;
/** Largest corner displacement accepted, px (§4.1 step 4). */
const MAX_CORNER_MOVE_PX = 3;

/** `lin[v] = (v / 255)^gamma`, v = 0 … 255. */
export function linearizationLut(gamma: number, out = new Float32Array(256)): Float32Array {
  for (let v = 0; v < 256; v++) out[v] = gamma === 1 ? v / 255 : Math.pow(v / 255, gamma);
  return out;
}

/** Edge refinement with preallocated scratch. */
export class EdgeRefiner {
  private readonly ex = new Float64Array(MAX_SAMPLES);
  private readonly ey = new Float64Array(MAX_SAMPLES);
  private readonly ew = new Float64Array(MAX_SAMPLES);
  private readonly lines = new Float64Array(16);
  private readonly start = new Float64Array(8);
  private prof = new Float64Array(64);

  constructor(readonly lut: Float32Array) {}

  /**
   * Refines the corners `q` (in/out) on `gray` (w × h) with a search range of
   * ±`rangePx`. Returns false (leaving `q` undefined) if a side has too few edge
   * samples, a corner moved more than 3 px, or the quad stopped being a valid
   * convex quad.
   */
  refine(
    gray: Uint8Array,
    w: number,
    h: number,
    q: Float64Array,
    rangePx: number,
    minSidePx: number,
  ): boolean {
    const half = Math.ceil(rangePx * STEPS_PER_PX) + STEPS_PER_PX; // profile half-length, steps
    if (this.prof.length < 2 * half + 1) this.prof = new Float64Array(2 * half + 1);
    this.start.set(q.subarray(0, 8));
    for (let pass = 0; pass < PASSES; pass++) {
      for (let side = 0; side < 4; side++) {
        if (!this.fitSide(gray, w, h, q, side, rangePx, half)) return false;
      }
      for (let i = 0; i < 4; i++) {
        if (!intersect(this.lines, ((i + 3) & 3) * 4, i * 4, q, i * 2)) return false;
      }
    }
    const s = this.start;
    for (let i = 0; i < 4; i++) {
      const dx = q[2 * i]! - s[2 * i]!;
      const dy = q[2 * i + 1]! - s[2 * i + 1]!;
      if (!(dx * dx + dy * dy <= MAX_CORNER_MOVE_PX * MAX_CORNER_MOVE_PX)) return false;
    }
    return quadShapeOk(q, minSidePx);
  }

  /** Fits `lines[side]` from edge samples along side `side` of `q`. */
  private fitSide(
    gray: Uint8Array,
    w: number,
    h: number,
    q: Float64Array,
    side: number,
    rangePx: number,
    half: number,
  ): boolean {
    const lut = this.lut;
    const prof = this.prof;
    const ax = q[side * 2]!;
    const ay = q[side * 2 + 1]!;
    const bx = q[((side + 1) & 3) * 2]!;
    const by = q[((side + 1) & 3) * 2 + 1]!;
    const len = Math.hypot(bx - ax, by - ay);
    if (!(len > 0)) return false;
    const tx = (bx - ax) / len;
    const ty = (by - ay) / len;
    // outward normal for clockwise-on-screen order
    const nx = ty;
    const ny = -tx;
    const margin = Math.min(rangePx + 2, 0.2 * len);
    const usable = len - 2 * margin;
    const m = Math.max(4, Math.min(MAX_SAMPLES, Math.round(usable / SAMPLE_SPACING_PX)));
    const stepPx = 1 / STEPS_PER_PX;
    const gHalf = STEPS_PER_PX >> 1; // ±0.5 px for the gradient
    const searchSteps = Math.round(rangePx * STEPS_PER_PX);
    const reach = half * stepPx;
    let ns = 0;
    for (let k = 0; k < m; k++) {
      const s = margin + ((k + 0.5) * usable) / m;
      const px = ax + s * tx;
      const py = ay + s * ty;
      // the whole profile must stay inside the image (bilinear needs x + 1, y + 1)
      const x0 = px - reach * Math.abs(nx);
      const x1 = px + reach * Math.abs(nx);
      const y0 = py - reach * Math.abs(ny);
      const y1 = py + reach * Math.abs(ny);
      if (!(x0 >= 0 && y0 >= 0 && x1 < w - 1 && y1 < h - 1)) continue;
      for (let j = -half; j <= half; j++) {
        const x = px + j * stepPx * nx;
        const y = py + j * stepPx * ny;
        const xi = x | 0;
        const yi = y | 0;
        const fx = x - xi;
        const fy = y - yi;
        const i = yi * w + xi;
        const top = lut[gray[i]!]! + fx * (lut[gray[i + 1]!]! - lut[gray[i]!]!);
        const bot = lut[gray[i + w]!]! + fx * (lut[gray[i + w + 1]!]! - lut[gray[i + w]!]!);
        prof[j + half] = top + fy * (bot - top);
      }
      let sw = 0;
      let swn = 0;
      for (let j = -searchSteps; j <= searchSteps; j++) {
        const g = prof[j + half + gHalf]! - prof[j + half - gHalf]!;
        if (g <= 0) continue; // must go dark inside → bright outside
        const wgt = g * g;
        sw += wgt;
        swn += wgt * j;
      }
      if (sw <= 0) continue;
      const off = (swn / sw) * stepPx;
      this.ex[ns] = px + off * nx;
      this.ey[ns] = py + off * ny;
      this.ew[ns] = sw;
      ns++;
    }
    if (ns < Math.max(3, m >> 1)) return false;
    // weighted total least squares
    let wsum = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < ns; i++) {
      const wi = this.ew[i]!;
      wsum += wi;
      mx += wi * this.ex[i]!;
      my += wi * this.ey[i]!;
    }
    mx /= wsum;
    my /= wsum;
    let cxx = 0;
    let cxy = 0;
    let cyy = 0;
    for (let i = 0; i < ns; i++) {
      const wi = this.ew[i]!;
      const dx = this.ex[i]! - mx;
      const dy = this.ey[i]! - my;
      cxx += wi * dx * dx;
      cxy += wi * dx * dy;
      cyy += wi * dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    let ltx = Math.cos(theta);
    let lty = Math.sin(theta);
    if (ltx * tx + lty * ty < 0) {
      ltx = -ltx;
      lty = -lty;
    }
    const l = this.lines;
    l[side * 4] = mx;
    l[side * 4 + 1] = my;
    l[side * 4 + 2] = ltx;
    l[side * 4 + 3] = lty;
    return true;
  }
}
