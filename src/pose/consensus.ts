/**
 * Outlier tags (ARCHITECTURE.md §5.4): exhaustive RANSAC over **tag pairs**.
 * Each pair's 8 corners give a homography board (x, z) → image; a tag is an
 * inlier when all 4 of its corners reproject within `inlierPx`. The largest
 * inlier set wins; ties go to the lower total corner error, then to the first
 * pair in (i, j) order, so the result is deterministic.
 *
 * Homographies are fitted to normalised image points (x = (u − cx)/fx, …)
 * with `homographyLsq` (the 8×8 least-squares form: a pair's 8 corners are
 * never collinear); errors are measured in pixels (dx·fx, dy·fy), so this is
 * the pixel homography K·H in disguise.
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < 8·nTags or
 * the fixed sizes 9 and 16, in range by construction.
 */
import { homographyLsq } from '../math/homography.js';

const h = new Float64Array(9);
const src = new Float64Array(16);
const dst = new Float64Array(16);

/**
 * Marks consensus inliers in `inlierOut[0…nTags)` (1 = inlier) and returns
 * their number (0 if no pair gives any inlier).
 *
 * @param tagBoard per tag [x, z]×4 board mm (TL, TR, BR, BL)
 * @param tagNorm per tag [x, y]×4 normalised image coordinates, same order
 */
export function tagPairConsensus(
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  nTags: number,
  fx: number,
  fy: number,
  inlierPx: number,
  inlierOut: Uint8Array,
): number {
  const lim2 = inlierPx * inlierPx;
  let bestCount = 0;
  let bestErr = Infinity;
  let bestI = -1;
  let bestJ = -1;
  for (let i = 0; i < nTags - 1; i++) {
    for (let j = i + 1; j < nTags; j++) {
      for (let k = 0; k < 8; k++) {
        src[k] = tagBoard[8 * i + k]!;
        src[8 + k] = tagBoard[8 * j + k]!;
        dst[k] = tagNorm[8 * i + k]!;
        dst[8 + k] = tagNorm[8 * j + k]!;
      }
      if (!homographyLsq(src, dst, 8, h)) continue;
      let count = 0;
      let err = 0;
      for (let t = 0; t < nTags; t++) {
        const e = tagError(t, tagBoard, tagNorm, fx, fy, lim2);
        if (e >= 0) {
          count++;
          err += e;
        }
      }
      if (count > bestCount || (count === bestCount && count > 0 && err < bestErr)) {
        bestCount = count;
        bestErr = err;
        bestI = i;
        bestJ = j;
      }
    }
  }
  inlierOut.fill(0, 0, nTags);
  if (bestCount === 0) return 0;
  // recompute the winning pair's homography and mark its inliers
  for (let k = 0; k < 8; k++) {
    src[k] = tagBoard[8 * bestI + k]!;
    src[8 + k] = tagBoard[8 * bestJ + k]!;
    dst[k] = tagNorm[8 * bestI + k]!;
    dst[8 + k] = tagNorm[8 * bestJ + k]!;
  }
  homographyLsq(src, dst, 8, h);
  let count = 0;
  for (let t = 0; t < nTags; t++) {
    if (tagError(t, tagBoard, tagNorm, fx, fy, lim2) >= 0) {
      inlierOut[t] = 1;
      count++;
    }
  }
  return count;
}

/** Sum of tag t's 4 corner errors (px) under `h`, or −1 if any corner is beyond the limit. */
function tagError(
  t: number,
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  fx: number,
  fy: number,
  lim2: number,
): number {
  let sum = 0;
  for (let c = 0; c < 4; c++) {
    const x = tagBoard[8 * t + 2 * c]!;
    const z = tagBoard[8 * t + 2 * c + 1]!;
    const w = h[6]! * x + h[7]! * z + h[8]!;
    if (!(w > 0) && !(w < 0)) return -1;
    const du = ((h[0]! * x + h[1]! * z + h[2]!) / w - tagNorm[8 * t + 2 * c]!) * fx;
    const dv = ((h[3]! * x + h[4]! * z + h[5]!) / w - tagNorm[8 * t + 2 * c + 1]!) * fy;
    const e2 = du * du + dv * dv;
    if (!(e2 <= lim2)) return -1;
    sum += Math.sqrt(e2);
  }
  return sum;
}
