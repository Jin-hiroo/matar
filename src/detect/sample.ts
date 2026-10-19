/**
 * Detector step 5, sampling half (ARCHITECTURE.md §4.1): read a tag's code from
 * the gray image given its refined corners.
 *
 * - Homography from the black square's cell grid to the corners (homography.ts).
 * - One bilinear sample at each cell centre of the n × n black square and at
 *   each cell of the white ring around it (n = squareCells = 8 for tag36h11).
 *   Values are linearised with the same LUT as the edge search (`edgeGamma`),
 *   so a blurred black cell and a blurred white cell sit symmetrically about
 *   the threshold.
 * - Per-tag threshold: midpoint of the mean of the black border cells and the
 *   mean of the white ring samples.
 * - Checks: ring − border contrast ≥ `minContrast` (encoded DN); ≥ 75 % of the
 *   border cells darker and ≥ 75 % of the ring samples brighter than the
 *   threshold.
 * - 0.25 Laplacian sharpening over the cell grid, as in AprilTag 3's decoder
 *   (`sharpen()` in apriltag.c, BSD-2-Clause, University of Michigan),
 *   re-implemented: v' = v + 0.25·(4v − Σ 4-neighbours).
 * - Bits in the family's order (bit i ↔ cell bitX[i], bitY[i], 1 = white).
 * - `margin` = mean |sample − threshold| over the data cells in encoded DN.
 *
 * Corners in: full-res px, clockwise on screen; corner 0 is taken as the grid's
 * top-left (the matcher resolves the actual rotation).
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction (bounds are checked before sampling).
 */
import type { FamilyDef } from '../tags/families.js';
import { squareToQuad } from './homography.js';

/** Fraction of border / ring samples that must be on the right side of the threshold. */
const MIN_BORDER_FRACTION = 0.75;
/** Laplacian sharpening factor (AprilTag 3's `decode_sharpening` default). */
const SHARPENING = 0.25;

export class TagReader {
  /** code read by the last successful `read`, high and low words */
  hi = 0;
  lo = 0;
  /** mean |sample − threshold| over the data cells, encoded DN */
  margin = 0;

  private readonly n: number;
  private readonly cellU: Float64Array;
  private readonly cellV: Float64Array;
  private readonly ringU: Float64Array;
  private readonly ringV: Float64Array;
  private readonly cellLin: Float64Array;
  private readonly ringLinVals: Float64Array;
  private readonly cellRaw: Float64Array;
  private readonly sharp: Float64Array;
  private readonly isBorder: Uint8Array;
  private readonly isData: Uint8Array;
  private readonly m = new Float64Array(9);
  private lastLin = 0;
  private lastRaw = 0;

  constructor(
    readonly def: FamilyDef,
    readonly lut: Float32Array,
  ) {
    const n = def.family.squareCells;
    this.n = n;
    this.cellU = new Float64Array(n * n);
    this.cellV = new Float64Array(n * n);
    this.cellLin = new Float64Array(n * n);
    this.cellRaw = new Float64Array(n * n);
    this.sharp = new Float64Array(n * n);
    this.isBorder = new Uint8Array(n * n);
    this.isData = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        this.cellU[r * n + c] = (c + 0.5) / n;
        this.cellV[r * n + c] = (r + 0.5) / n;
        this.isBorder[r * n + c] = r === 0 || c === 0 || r === n - 1 || c === n - 1 ? 1 : 0;
      }
    }
    for (let i = 0; i < def.nbits; i++) this.isData[def.bitY[i]! * n + def.bitX[i]!] = 1;
    // white ring: the cell centres of the (n + 2)² grid outside the black square
    const ring = 4 * n + 4;
    this.ringU = new Float64Array(ring);
    this.ringV = new Float64Array(ring);
    this.ringLinVals = new Float64Array(ring);
    let k = 0;
    for (let i = -1; i <= n; i++) {
      for (const j of [-1, n]) {
        this.ringU[k] = (i + 0.5) / n;
        this.ringV[k++] = (j + 0.5) / n;
        if (i >= 0 && i < n) {
          this.ringU[k] = (j + 0.5) / n;
          this.ringV[k++] = (i + 0.5) / n;
        }
      }
    }
  }

  /**
   * Samples the tag with corners `q` in `gray` (w × h). Returns false if a
   * sample falls outside the image or a border/contrast check fails; otherwise
   * sets `hi`, `lo` and `margin`.
   */
  read(gray: Uint8Array, w: number, h: number, q: Float64Array, minContrast: number): boolean {
    const m = this.m;
    if (!squareToQuad(q, m)) return false;
    const n = this.n;
    const nn = n * n;

    let borderLin = 0;
    let borderRaw = 0;
    let borderCount = 0;
    for (let i = 0; i < nn; i++) {
      if (!this.sample(gray, w, h, this.cellU[i]!, this.cellV[i]!)) return false;
      this.cellLin[i] = this.lastLin;
      this.cellRaw[i] = this.lastRaw;
      if (this.isBorder[i]) {
        borderLin += this.lastLin;
        borderRaw += this.lastRaw;
        borderCount++;
      }
    }
    const nr = this.ringU.length;
    let ringLin = 0;
    let ringRaw = 0;
    for (let i = 0; i < nr; i++) {
      if (!this.sample(gray, w, h, this.ringU[i]!, this.ringV[i]!)) return false;
      this.ringLinVals[i] = this.lastLin;
      ringLin += this.lastLin;
      ringRaw += this.lastRaw;
    }
    borderLin /= borderCount;
    borderRaw /= borderCount;
    ringLin /= nr;
    ringRaw /= nr;
    if (!(ringRaw - borderRaw >= minContrast)) return false;
    const tLin = (borderLin + ringLin) / 2;
    const tRaw = (borderRaw + ringRaw) / 2;

    // border cells dark, ring samples bright
    let dark = 0;
    for (let i = 0; i < nn; i++) if (this.isBorder[i] && this.cellLin[i]! < tLin) dark++;
    if (dark < MIN_BORDER_FRACTION * borderCount) return false;
    let bright = 0;
    for (let i = 0; i < nr; i++) if (this.ringLinVals[i]! > tLin) bright++;
    if (bright < MIN_BORDER_FRACTION * nr) return false;

    // sharpen (data cells only need it; all their 4-neighbours are inside the grid)
    const lin = this.cellLin;
    const sharp = this.sharp;
    for (let r = 1; r < n - 1; r++) {
      for (let c = 1; c < n - 1; c++) {
        const i = r * n + c;
        const v = lin[i]! - tLin;
        const lap = 4 * v - (lin[i - 1]! + lin[i + 1]! + lin[i - n]! + lin[i + n]! - 4 * tLin);
        sharp[i] = v + SHARPENING * lap;
      }
    }

    const def = this.def;
    let hi = 0;
    let lo = 0;
    let marginSum = 0;
    for (let b = 0; b < def.nbits; b++) {
      const i = def.bitY[b]! * n + def.bitX[b]!;
      const bit = sharp[i]! > 0 ? 1 : 0;
      const pos = def.nbits - 1 - b;
      if (pos >= 32) hi |= bit << (pos - 32);
      else lo |= bit << pos;
      marginSum += Math.abs(this.cellRaw[i]! - tRaw);
    }
    this.hi = hi >>> 0;
    this.lo = lo >>> 0;
    this.margin = marginSum / def.nbits;
    return true;
  }

  /** Bilinear sample at grid point (u, v) → `lastLin`, `lastRaw`. False if outside the image. */
  private sample(gray: Uint8Array, w: number, h: number, u: number, v: number): boolean {
    const m = this.m;
    const z = m[6]! * u + m[7]! * v + 1;
    const x = (m[0]! * u + m[1]! * v + m[2]!) / z;
    const y = (m[3]! * u + m[4]! * v + m[5]!) / z;
    if (!(x >= 0 && y >= 0 && x < w - 1 && y < h - 1)) return false;
    const xi = x | 0;
    const yi = y | 0;
    const fx = x - xi;
    const fy = y - yi;
    const i = yi * w + xi;
    const a = gray[i]!;
    const b = gray[i + 1]!;
    const c = gray[i + w]!;
    const d = gray[i + w + 1]!;
    const lut = this.lut;
    const rt = a + fx * (b - a);
    this.lastRaw = rt + fy * (c + fx * (d - c) - rt);
    const lt = lut[a]! + fx * (lut[b]! - lut[a]!);
    this.lastLin = lt + fy * (lut[c]! + fx * (lut[d]! - lut[c]!) - lt);
    return true;
  }
}
