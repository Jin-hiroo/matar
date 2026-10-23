/**
 * Outlier tags (ARCHITECTURE.md §5.4): exhaustive RANSAC over **tag pairs**.
 * Each pair's 8 corners give a homography board (x, z) → image, and each tag
 * is judged by its 4 corner errors under it. The largest inlier set wins; ties
 * go to the lower total corner error, then to the first pair in (i, j) order,
 * so the result is deterministic. Two tests, in two passes:
 *
 * - strict: every corner within `inlierPx`.
 * - relaxed: the tag's shift (the mean of its corner errors, as vectors)
 *   within `inlierPx` and every corner within 3 × `inlierPx`.
 *
 * The strict pass runs first; when it leaves tags out, the relaxed pass's set
 * is used if it is larger and either the strict set has fewer than half the
 * tags or the relaxed set's tags don't lie along one line (their centres' RMS
 * distance from their best-fit line is ≥ half a tag side).
 *
 * Why relaxed: motion blur longer than a cell stretches every tag along the
 * motion by about (blur − cell) / 2 px per side while it barely shifts (16 px
 * of blur on 9 px cells: corners 3.5–4 px off, centres 0.1 px). The strict
 * test split those tags into small sets, and the pose from 5 of 13 was 58 mm
 * off; from all 13 it is within 2 mm. A wrong or displaced tag shifts, and a
 * tag turned in place (a misprint) moves its corners beyond 3 × `inlierPx`
 * once turned far enough.
 *
 * Why not relaxed alone: along one line, the homography of a pair that
 * includes a misprinted tag is free to tilt about that line and can pass the
 * other tags. Tags 17, 42 and 101 (one edge), 101 turned by 6°: 145 mm off;
 * add tag 3, 101 turned by 20°: 765 mm off. The strict test keeps the good
 * tags; a tag off the line exposes the tilt, hence the spread condition. Under
 * blur the strict set alone, when it had half the tags or more, was a biased
 * subset (full board, stretch 3.7 px: content 100 mm above the board 5.6 mm
 * off at worst, against 3.0 mm for relaxed alone; strict alone 21 mm).
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
/** the winning pair of the last `search` (−1: none) */
let bestI = -1;
let bestJ = -1;

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
  const count = search(tagBoard, tagNorm, nTags, fx, fy, lim2, false);
  if (count < nTags) {
    const i = bestI;
    const j = bestJ;
    if (search(tagBoard, tagNorm, nTags, fx, fy, lim2, true) > count) {
      const n = mark(tagBoard, tagNorm, nTags, fx, fy, lim2, true, inlierOut);
      if (2 * count < nTags || spread(tagBoard, inlierOut, nTags) >= 0.5) return n;
    }
    bestI = i;
    bestJ = j;
  }
  return mark(tagBoard, tagNorm, nTags, fx, fy, lim2, false, inlierOut);
}

/** Marks the inliers of the pair `bestI`, `bestJ` under one test (none without a pair); returns their number. */
function mark(
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  nTags: number,
  fx: number,
  fy: number,
  lim2: number,
  relaxed: boolean,
  inlierOut: Uint8Array,
): number {
  inlierOut.fill(0, 0, nTags);
  if (bestI < 0 || !pairHomography(tagBoard, tagNorm, bestI, bestJ)) return 0;
  let count = 0;
  for (let t = 0; t < nTags; t++) {
    if (tagError(t, tagBoard, tagNorm, fx, fy, lim2, relaxed) >= 0) {
      inlierOut[t] = 1;
      count++;
    }
  }
  return count;
}

/**
 * RMS distance of the marked tags' centres (board mm) from their best-fit line,
 * in mean tag sides: the square root of the smaller eigenvalue of the centres'
 * covariance.
 */
function spread(tagBoard: Float64Array, mask: Uint8Array, nTags: number): number {
  let n = 0;
  let sx = 0;
  let sz = 0;
  let sxx = 0;
  let sxz = 0;
  let szz = 0;
  let side = 0;
  for (let t = 0; t < nTags; t++) {
    if (!mask[t]) continue;
    const o = 8 * t;
    const x = (tagBoard[o]! + tagBoard[o + 2]! + tagBoard[o + 4]! + tagBoard[o + 6]!) / 4;
    const z = (tagBoard[o + 1]! + tagBoard[o + 3]! + tagBoard[o + 5]! + tagBoard[o + 7]!) / 4;
    n++;
    sx += x;
    sz += z;
    sxx += x * x;
    sxz += x * z;
    szz += z * z;
    side += Math.hypot(tagBoard[o + 2]! - tagBoard[o]!, tagBoard[o + 3]! - tagBoard[o + 1]!);
  }
  const a = (sxx - (sx * sx) / n) / n;
  const b = (sxz - (sx * sz) / n) / n;
  const c = (szz - (sz * sz) / n) / n;
  return Math.sqrt(Math.max((a + c) / 2 - Math.hypot((a - c) / 2, b), 0)) / (side / n);
}

/** Best pair under one test: returns its inlier count, the pair in `bestI`, `bestJ`. */
function search(
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  nTags: number,
  fx: number,
  fy: number,
  lim2: number,
  relaxed: boolean,
): number {
  let bestCount = 0;
  let bestErr = Infinity;
  bestI = -1;
  bestJ = -1;
  for (let i = 0; i < nTags - 1; i++) {
    for (let j = i + 1; j < nTags; j++) {
      if (!pairHomography(tagBoard, tagNorm, i, j)) continue;
      let count = 0;
      let err = 0;
      for (let t = 0; t < nTags; t++) {
        const e = tagError(t, tagBoard, tagNorm, fx, fy, lim2, relaxed);
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
  return bestCount;
}

/** Fits `h` to tags i and j's 8 corners; false if degenerate. */
function pairHomography(
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  i: number,
  j: number,
): boolean {
  for (let k = 0; k < 8; k++) {
    src[k] = tagBoard[8 * i + k]!;
    src[8 + k] = tagBoard[8 * j + k]!;
    dst[k] = tagNorm[8 * i + k]!;
    dst[8 + k] = tagNorm[8 * j + k]!;
  }
  return homographyLsq(src, dst, 8, h) !== null;
}

/**
 * Sum of tag t's 4 corner errors (px) under `h`, or −1 if it fails the test:
 * strict, a corner beyond √lim2; relaxed, its shift (the mean corner error
 * vector) beyond √lim2 or a corner beyond 3·√lim2.
 */
function tagError(
  t: number,
  tagBoard: Float64Array,
  tagNorm: Float64Array,
  fx: number,
  fy: number,
  lim2: number,
  relaxed: boolean,
): number {
  const cornerLim2 = relaxed ? 9 * lim2 : lim2;
  let sum = 0;
  let su = 0;
  let sv = 0;
  for (let c = 0; c < 4; c++) {
    const x = tagBoard[8 * t + 2 * c]!;
    const z = tagBoard[8 * t + 2 * c + 1]!;
    const w = h[6]! * x + h[7]! * z + h[8]!;
    if (!(w > 0) && !(w < 0)) return -1;
    const du = ((h[0]! * x + h[1]! * z + h[2]!) / w - tagNorm[8 * t + 2 * c]!) * fx;
    const dv = ((h[3]! * x + h[4]! * z + h[5]!) / w - tagNorm[8 * t + 2 * c + 1]!) * fy;
    const e2 = du * du + dv * dv;
    if (!(e2 <= cornerLim2)) return -1;
    su += du;
    sv += dv;
    sum += Math.sqrt(e2);
  }
  return !relaxed || su * su + sv * sv <= 16 * lim2 ? sum : -1;
}
