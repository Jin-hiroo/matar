/**
 * Detector steps 1–2 (ARCHITECTURE.md §4.1): optional 2 × 2 box decimation and
 * the AprilTag 3 adaptive threshold.
 *
 * - `decimate2x2`: full-resolution gray (W × H) → ⌊W/2⌋ × ⌊H/2⌋, each pixel the
 *   rounded mean of a 2 × 2 block. Decimated pixel p is centred on full-res
 *   (p + 0.5)·2 − 0.5 (pixel centres at integers, §2.4).
 * - `adaptiveThreshold`: 4 × 4 px tiles, each tile's min and max, extrema
 *   dilated over the 3 × 3 tile neighbourhood, threshold (min + max) / 2.
 *   Pixels whose local max − min < `minContrast` are "unknown". With
 *   `blockExtrema` (the detector's choice) a full tile's extrema are taken
 *   over its four 2 × 2 block means: that halves the noise in max − min, so
 *   flat paper with 2–4 DN sensor noise stays unknown instead of breaking into
 *   large random black clusters (each pixel is still compared with the
 *   threshold at full resolution). Real edges keep their extrema, since blocks
 *   lie wholly on each side of an edge. The labels are
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
 *
 * `blockExtrema`: full tiles take their extrema over 2 × 2 block means instead
 * of pixels (see the header); partial tiles at the right and bottom edges use
 * pixels.
 *
 * Written branch-free in the per-pixel loops (min/max and the label are bit
 * tricks on int32): with sensor noise, data-dependent branches mispredict and
 * made this stage 2–4× slower.
 */
export function adaptiveThreshold(
  img: Uint8Array,
  w: number,
  h: number,
  minContrast: number,
  out: Uint8Array,
  s: ThresholdScratch,
  blockExtrema = false,
): void {
  const tw = Math.ceil(w / TILE_PX);
  const th = Math.ceil(h / TILE_PX);
  const { tileMin, tileMax, dilMin, dilMax } = s;

  // tile extrema
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * TILE_PX;
    const rows = h - y0 < TILE_PX ? h - y0 : TILE_PX;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * TILE_PX;
      const cols = w - x0 < TILE_PX ? w - x0 : TILE_PX;
      let lo = 255;
      let hi = 0;
      let d: number;
      if (blockExtrema && rows === TILE_PX && cols === TILE_PX) {
        for (let r = 0; r < TILE_PX; r += 2) {
          const i = (y0 + r) * w + x0;
          let v = (img[i]! + img[i + 1]! + img[i + w]! + img[i + w + 1]! + 2) >> 2;
          d = v - lo;
          lo += d & (d >> 31);
          d = hi - v;
          hi -= d & (d >> 31);
          v = (img[i + 2]! + img[i + 3]! + img[i + w + 2]! + img[i + w + 3]! + 2) >> 2;
          d = v - lo;
          lo += d & (d >> 31);
          d = hi - v;
          hi -= d & (d >> 31);
        }
      } else {
        for (let r = 0; r < rows; r++) {
          let i = (y0 + r) * w + x0;
          for (let c = 0; c < cols; c++, i++) {
            const v = img[i]!;
            d = v - lo;
            lo += d & (d >> 31);
            d = hi - v;
            hi -= d & (d >> 31);
          }
        }
      }
      tileMin[ty * tw + tx] = lo;
      tileMax[ty * tw + tx] = hi;
    }
  }

  // 3 × 3 tile dilation, separable: rows into dil*, then columns back into tile*
  for (let ty = 0; ty < th; ty++) {
    const row = ty * tw;
    for (let tx = 0; tx < tw; tx++) {
      const a = row + (tx > 0 ? tx - 1 : 0);
      const b = row + (tx < tw - 1 ? tx + 1 : tw - 1);
      let lo = tileMin[row + tx]!;
      let hi = tileMax[row + tx]!;
      let d = tileMin[a]! - lo;
      lo += d & (d >> 31);
      d = tileMin[b]! - lo;
      lo += d & (d >> 31);
      d = hi - tileMax[a]!;
      hi -= d & (d >> 31);
      d = hi - tileMax[b]!;
      hi -= d & (d >> 31);
      dilMin[row + tx] = lo;
      dilMax[row + tx] = hi;
    }
  }
  for (let ty = 0; ty < th; ty++) {
    const up = (ty > 0 ? ty - 1 : 0) * tw;
    const row = ty * tw;
    const down = (ty < th - 1 ? ty + 1 : th - 1) * tw;
    for (let tx = 0; tx < tw; tx++) {
      let lo = dilMin[row + tx]!;
      let hi = dilMax[row + tx]!;
      let d = dilMin[up + tx]! - lo;
      lo += d & (d >> 31);
      d = dilMin[down + tx]! - lo;
      lo += d & (d >> 31);
      d = hi - dilMax[up + tx]!;
      hi -= d & (d >> 31);
      d = hi - dilMax[down + tx]!;
      hi -= d & (d >> 31);
      tileMin[row + tx] = lo;
      tileMax[row + tx] = hi;
    }
  }

  // labels: (thresh − v) >> 31 is −1 (→ WHITE = 255) when v > thresh, else 0 (BLACK)
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
      const lo = tileMin[tRow + tx]!;
      const hi = tileMax[tRow + tx]!;
      const x0 = tx * TILE_PX;
      const x1 = x0 + TILE_PX < w ? x0 + TILE_PX : w;
      if (hi - lo < minContrast) {
        for (let x = x0; x < x1; x++) out[o + x] = UNKNOWN;
      } else {
        const t = lo + ((hi - lo) >> 1);
        if (x1 - x0 === TILE_PX) {
          const i = row + x0;
          const p = o + x0;
          out[p] = ((t - img[i]!) >> 31) & WHITE;
          out[p + 1] = ((t - img[i + 1]!) >> 31) & WHITE;
          out[p + 2] = ((t - img[i + 2]!) >> 31) & WHITE;
          out[p + 3] = ((t - img[i + 3]!) >> 31) & WHITE;
        } else {
          for (let x = x0; x < x1; x++) out[o + x] = ((t - img[row + x]!) >> 31) & WHITE;
        }
      }
    }
  }
}
