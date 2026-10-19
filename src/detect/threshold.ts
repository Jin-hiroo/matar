/**
 * Detector steps 1–2 (ARCHITECTURE.md §4.1): optional 2 × 2 box decimation and
 * the AprilTag 3 adaptive threshold.
 *
 * - `decimate2x2`: full-resolution gray (W × H) → ⌊W/2⌋ × ⌊H/2⌋, each pixel the
 *   rounded mean of a 2 × 2 block. Decimated pixel p is centred on full-res
 *   (p + 0.5)·2 − 0.5 (pixel centres at integers, §2.4).
 * - `adaptiveThreshold`: 4 × 4 px tiles, each tile's min and max, extrema
 *   dilated over the 3 × 3 tile neighbourhood, threshold (min + max) / 2.
 *   Pixels whose local max − min < `minContrast` are "unknown". The labels are
 *   written into a padded buffer ((w + 2) × (h + 2), a 1-px WHITE frame) that
 *   the border follower then uses as its work image.
 *
 * The threshold follows the algorithm of AprilTag 3 (`threshold()` in
 * apriltag_quad_thresh.c, BSD-2-Clause, University of Michigan; Wang & Olson,
 * "AprilTag 2", IROS 2016), re-implemented here, not ported.
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction (loop bounds).
 */

/** Label of a pixel darker than its local threshold (border-following foreground). */
export const BLACK = 0;
/** Label of a pixel in a low-contrast neighbourhood: neither black nor white. */
export const UNKNOWN = 127;
/** Label of a pixel brighter than its local threshold. */
export const WHITE = 255;

/** Tile edge, px (AprilTag 3). */
export const TILE_PX = 4;

/** Writes the 2 × 2 box-averaged image of `src` (w × h) into `out` (⌊w/2⌋ × ⌊h/2⌋). */
export function decimate2x2(src: Uint8Array, w: number, h: number, out: Uint8Array): void {
  const sw = w >> 1;
  const sh = h >> 1;
  for (let y = 0; y < sh; y++) {
    let i = 2 * y * w;
    let o = y * sw;
    for (let x = 0; x < sw; x++, i += 2, o++) {
      out[o] = (src[i]! + src[i + 1]! + src[i + w]! + src[i + w + 1]! + 2) >> 2;
    }
  }
}

/** Scratch buffers for `adaptiveThreshold`, sized by `thresholdScratchSize`. */
export interface ThresholdScratch {
  tileMin: Uint8Array;
  tileMax: Uint8Array;
  dilMin: Uint8Array;
  dilMax: Uint8Array;
}

/** Number of tiles for a w × h image (length of each scratch buffer). */
export function thresholdScratchSize(w: number, h: number): number {
  return Math.ceil(w / TILE_PX) * Math.ceil(h / TILE_PX);
}

/**
 * Labels every pixel of `img` (w × h, stride w) as BLACK, WHITE or UNKNOWN and
 * writes the labels into `out`, a padded (w + 2) × (h + 2) buffer whose 1-px
 * frame is set to WHITE. Pixel (x, y) goes to `out[(y + 1)·(w + 2) + x + 1]`.
 */
export function adaptiveThreshold(
  img: Uint8Array,
  w: number,
  h: number,
  minContrast: number,
  out: Uint8Array,
  s: ThresholdScratch,
): void {
  const tw = Math.ceil(w / TILE_PX);
  const th = Math.ceil(h / TILE_PX);
  const nt = tw * th;
  const { tileMin, tileMax, dilMin, dilMax } = s;
  tileMin.fill(255, 0, nt);
  tileMax.fill(0, 0, nt);

  // tile extrema (partial tiles at the right and bottom edges use the pixels they have)
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const tRow = (y >> 2) * tw;
    for (let x = 0; x < w; x++) {
      const v = img[row + x]!;
      const t = tRow + (x >> 2);
      if (v < tileMin[t]!) tileMin[t] = v;
      if (v > tileMax[t]!) tileMax[t] = v;
    }
  }

  // 3 × 3 tile dilation of the extrema
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty > 0 ? ty - 1 : 0;
    const y1 = ty < th - 1 ? ty + 1 : th - 1;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx > 0 ? tx - 1 : 0;
      const x1 = tx < tw - 1 ? tx + 1 : tw - 1;
      let lo = 255;
      let hi = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const t = yy * tw + xx;
          if (tileMin[t]! < lo) lo = tileMin[t]!;
          if (tileMax[t]! > hi) hi = tileMax[t]!;
        }
      }
      dilMin[ty * tw + tx] = lo;
      dilMax[ty * tw + tx] = hi;
    }
  }

  // labels, 4 pixels per tile at a time
  const stride = w + 2;
  out.fill(WHITE, 0, stride);
  out.fill(WHITE, (h + 1) * stride, (h + 2) * stride);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const o = (y + 1) * stride + 1;
    out[o - 1] = WHITE;
    out[o + w] = WHITE;
    const tRow = (y >> 2) * tw;
    for (let tx = 0; tx < tw; tx++) {
      const lo = dilMin[tRow + tx]!;
      const hi = dilMax[tRow + tx]!;
      const x0 = tx * TILE_PX;
      const x1 = x0 + TILE_PX < w ? x0 + TILE_PX : w;
      if (hi - lo < minContrast) {
        for (let x = x0; x < x1; x++) out[o + x] = UNKNOWN;
      } else {
        const thresh = lo + ((hi - lo) >> 1);
        for (let x = x0; x < x1; x++) out[o + x] = img[row + x]! > thresh ? WHITE : BLACK;
      }
    }
  }
}
