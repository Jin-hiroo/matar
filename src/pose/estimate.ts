/**
 * `estimatePose`: board pose from one frame's tag detections
 * (ARCHITECTURE.md §5.1–5.4).
 *
 * 1. Correspondences (§5.1): each detected tag on the board gives four pairs
 *    board (x, 0, z) mm ↔ image (u, v) px, corner i ↔ corner i (TL, TR, BR, BL).
 *    IDs not on the board are rejected. Duplicate IDs (the detector removes
 *    them, §4.1 step 7): the higher-margin detection is kept, the other ignored.
 * 2. Outlier tags (§5.4), with ≥ 3 tags: exhaustive RANSAC over tag pairs
 *    (`consensus.ts`).
 * 3. Initial pose (§5.2): DLT homography from centred board (x, z) to normalised
 *    image points, IPPE → two candidates, each refined by LM (§5.3,
 *    `refine.ts`). The lower-error one wins, unless e₂ < 1.5·e₁ and a previous
 *    pose is given: then the one with the smaller rotation angle to it.
 * 4. After the fit (≥ 3 tags), tags with RMS > max(3 px, 3 × median tag RMS)
 *    are dropped and the pose is refitted once.
 *
 * Frames: solver state is `cameraFromBoard` in CV convention; the result is
 * `boardFromCamera` in GL convention via `frames.ts`. Stateless per call (scratch
 * buffers are reused, not carried over), so results are deterministic.
 *
 * Non-null assertions (`!`) are on scratch typed-array reads with indices below
 * the sizes ensured by `ensureCapacity`, in range by construction.
 */
import { boardTagCornersMm } from '../board/corners.js';
import { homographyDlt } from '../math/homography.js';
import { rotationAngleBetween } from '../math/rotation.js';
import type { Board, BoardPose, CameraIntrinsics, Mat4, TagDetection } from '../types.js';
import { tagPairConsensus } from './consensus.js';
import { boardFromCameraGl, cameraFromBoardCv } from './frames.js';
import { ippeRotations, ippeTranslation } from './ippe.js';
import { PoseProblem, refinePose } from './refine.js';

/** Tuning for `estimatePose`; the defaults are ARCHITECTURE.md §5's values. */
export interface PoseOptions {
  /** consensus inlier threshold: every corner of a tag within this, px (default 4) */
  inlierPx?: number;
  /** Huber threshold of the refinement, px (default 1.5) */
  huberPx?: number;
  /** below this error ratio e₂/e₁ the previous pose picks the branch (default 1.5) */
  ambiguityRatio?: number;
  /** LM iteration limit (default 10) */
  maxIterations?: number;
  /** post-fit drop: tag RMS above max(dropMinPx, dropMedianFactor × median) (defaults 3, 3) */
  dropMinPx?: number;
  dropMedianFactor?: number;
}

// ---------------------------------------------------------------------------
// Board lookup (cached per board object; boards are immutable data)

const cornerCache = new WeakMap<Board, Map<number, Float64Array>>();

/** Board corners per tag ID, [x0, z0, …, x3, z3] mm in TL, TR, BR, BL order. */
function boardCorners(board: Board): Map<number, Float64Array> {
  let m = cornerCache.get(board);
  if (!m) {
    m = new Map();
    for (const tag of board.tags) {
      const c = boardTagCornersMm(tag);
      m.set(
        tag.id,
        Float64Array.of(c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]),
      );
    }
    cornerCache.set(board, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Scratch (grown on demand, reused across calls)

let cap = 0;
/** per tag: board corners [x, z]×4, pixel corners [u, v]×4, normalised corners [x, y]×4 */
let tagBoard = new Float64Array(0);
let tagPx = new Float64Array(0);
let tagNorm = new Float64Array(0);
let tagDet = new Int32Array(0); // index into detections
let inlier = new Uint8Array(0);
let tagRms = new Float64Array(0);
/** per fitted point */
let fitBoard = new Float64Array(0);
let fitPx = new Float64Array(0);
let fitModel = new Float64Array(0);
let fitNorm = new Float64Array(0);
let fitErr2 = new Float64Array(0);
let sortBuf = new Float64Array(0);

function ensureCapacity(nTags: number): void {
  if (nTags <= cap) return;
  cap = Math.max(nTags, 2 * cap, 16);
  tagBoard = new Float64Array(8 * cap);
  tagPx = new Float64Array(8 * cap);
  tagNorm = new Float64Array(8 * cap);
  tagDet = new Int32Array(cap);
  inlier = new Uint8Array(cap);
  tagRms = new Float64Array(cap);
  fitBoard = new Float64Array(8 * cap);
  fitPx = new Float64Array(8 * cap);
  fitModel = new Float64Array(8 * cap);
  fitNorm = new Float64Array(8 * cap);
  fitErr2 = new Float64Array(4 * cap);
  sortBuf = new Float64Array(cap);
}

const slotOfId = new Map<number, number>();
const problems = [new PoseProblem(), new PoseProblem()];
const hBuf = new Float64Array(9);
const rA = new Float64Array(9);
const rB = new Float64Array(9);
const rM = new Float64Array(9);
const tM = new Float64Array(3);
const rCb = new Float64Array(9);
const tCb = new Float64Array(3);
const rPrev = new Float64Array(9);
const tPrev = new Float64Array(3);

/** A fitted pose (refers to one of `problems`). */
interface Fit {
  problem: PoseProblem;
  /** plain RMS reprojection error over the fitted corners, px */
  rmsPx: number;
  /** fitted tag slots, in slot order */
  nTags: number;
}

/**
 * Board pose from one frame. `previous` (`boardFromCamera`, GL, mm,
 * column-major) only breaks the planar two-fold ambiguity of small views.
 * Returns null if no board tag is usable.
 */
export function estimatePose(
  detections: readonly TagDetection[],
  board: Board,
  intrinsics: CameraIntrinsics,
  previous?: Mat4,
  options: PoseOptions = {},
): BoardPose | null {
  const corners = boardCorners(board);
  const rejected: number[] = [];
  ensureCapacity(detections.length);

  // 1. correspondences: one slot per board tag ID
  slotOfId.clear();
  let nTags = 0;
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i]!;
    const bc = corners.get(d.id);
    if (!bc) {
      rejected.push(d.id);
      continue;
    }
    const prev = slotOfId.get(d.id);
    let slot: number;
    if (prev === undefined) {
      slot = nTags++;
      slotOfId.set(d.id, slot);
    } else if (d.margin > detections[tagDet[prev]!]!.margin) {
      slot = prev;
    } else continue;
    tagDet[slot] = i;
    for (let c = 0; c < 4; c++) {
      const [u, v] = d.corners[c]!;
      tagBoard[8 * slot + 2 * c] = bc[2 * c]!;
      tagBoard[8 * slot + 2 * c + 1] = bc[2 * c + 1]!;
      tagPx[8 * slot + 2 * c] = u;
      tagPx[8 * slot + 2 * c + 1] = v;
      tagNorm[8 * slot + 2 * c] = (u - intrinsics.cx) / intrinsics.fx;
      tagNorm[8 * slot + 2 * c + 1] = (v - intrinsics.cy) / intrinsics.fy;
    }
  }
  if (nTags === 0) return null;

  // 2. consensus over tag pairs
  if (nTags >= 3) {
    const found = tagPairConsensus(
      tagBoard,
      tagNorm,
      nTags,
      intrinsics.fx,
      intrinsics.fy,
      options.inlierPx ?? 4,
      inlier,
    );
    if (found === 0) return null;
  } else {
    inlier.fill(1, 0, nTags);
  }

  let havePrev = false;
  if (previous) {
    cameraFromBoardCv(previous, rPrev, tPrev);
    havePrev = true;
  }

  // 3. fit
  let fit = fitTags(nTags, intrinsics, havePrev, options);
  if (!fit) return null;

  // 4. drop tags far worse than the rest, refit once
  if (fit.nTags >= 3) {
    perTagRms(fit, nTags);
    let k = 0;
    for (let s = 0; s < nTags; s++) if (inlier[s]) sortBuf[k++] = tagRms[s]!;
    const med = median(sortBuf, k);
    const limit = Math.max(options.dropMinPx ?? 3, (options.dropMedianFactor ?? 3) * med);
    let dropped = 0;
    for (let s = 0; s < nTags; s++) {
      if (inlier[s] && tagRms[s]! > limit) {
        inlier[s] = 0;
        dropped++;
      }
    }
    if (dropped > 0) {
      if (dropped === fit.nTags) return null;
      fit = fitTags(nTags, intrinsics, havePrev, options);
      if (!fit) return null;
    }
  }

  const used: number[] = [];
  for (let s = 0; s < nTags; s++) {
    const id = detections[tagDet[s]!]!.id;
    if (inlier[s]) used.push(id);
    else rejected.push(id);
  }
  return {
    boardFromCamera: boardFromCameraGl(fit.problem.r, fit.problem.t),
    rmsErrPx: fit.rmsPx,
    usedTagIds: used,
    rejectedTagIds: rejected,
  };
}

/** Fits the pose to the tags with `inlier[slot]` set (§5.2–5.3). */
function fitTags(
  nTags: number,
  k: CameraIntrinsics,
  havePrev: boolean,
  options: PoseOptions,
): Fit | null {
  // gather points; centre the board points for IPPE
  let n = 0;
  let mx = 0;
  let mz = 0;
  let fitted = 0;
  for (let s = 0; s < nTags; s++) {
    if (!inlier[s]) continue;
    fitted++;
    for (let j = 0; j < 8; j++) {
      fitBoard[2 * n + j] = tagBoard[8 * s + j]!;
      fitPx[2 * n + j] = tagPx[8 * s + j]!;
      fitNorm[2 * n + j] = tagNorm[8 * s + j]!;
    }
    for (let c = 0; c < 4; c++) {
      mx += tagBoard[8 * s + 2 * c]!;
      mz += tagBoard[8 * s + 2 * c + 1]!;
    }
    n += 4;
  }
  if (n < 4) return null;
  mx /= n;
  mz /= n;
  for (let i = 0; i < n; i++) {
    fitModel[2 * i] = fitBoard[2 * i]! - mx;
    fitModel[2 * i + 1] = fitBoard[2 * i + 1]! - mz;
  }

  const h = homographyDlt(fitModel, fitNorm, n, hBuf);
  if (!h || !ippeRotations(h, rA, rB)) return null;

  const huber = options.huberPx ?? 1.5;
  const refine = { maxIterations: options.maxIterations ?? 10 };
  let best: Fit | null = null;
  let other: Fit | null = null;
  for (let c = 0; c < 2; c++) {
    const rModel = c === 0 ? rA : rB;
    if (!ippeTranslation(rModel, fitModel, fitNorm, n, tM)) continue;
    modelToBoard(rModel, tM, mx, mz);
    const p = problems[c]!;
    p.set(fitBoard, fitPx, n, k, rCb, tCb, huber);
    if (!Number.isFinite(p.cost())) continue; // candidate puts points behind the camera
    refinePose(p, refine);
    const rms = Math.sqrt(p.squaredErrors() / n);
    if (!Number.isFinite(rms)) continue;
    const f: Fit = { problem: p, rmsPx: rms, nTags: fitted };
    if (!best || rms < best.rmsPx) {
      other = best;
      best = f;
    } else other = f;
  }
  if (!best) return null;
  if (other && havePrev && other.rmsPx < (options.ambiguityRatio ?? 1.5) * best.rmsPx) {
    // ambiguous: keep the branch nearer the previous pose
    if (
      rotationAngleBetween(other.problem.r, rPrev) < rotationAngleBetween(best.problem.r, rPrev)
    ) {
      best = other;
    }
  }
  // fill per-point errors for the caller
  best.problem.squaredErrors(fitErr2);
  return best;
}

/**
 * Model frame (axes board x, board z, x × z = −board y; origin at the centroid
 * (mx, 0, mz)) → board: R_cb = [r_a, r_b × r_a, r_b] (columns for board x, y,
 * z), t_cb = t_m − r_a·mx − r_b·mz. Writes `rCb`, `tCb`.
 */
function modelToBoard(rm: Float64Array, tm: Float64Array, mx: number, mz: number): void {
  rM.set(rm);
  for (let i = 0; i < 3; i++) {
    const a = rM[3 * i]!;
    const b = rM[3 * i + 1]!;
    rCb[3 * i] = a;
    rCb[3 * i + 2] = b;
    tCb[i] = tm[i]! - a * mx - b * mz;
  }
  // column y = r_b × r_a
  const ax = rCb[0]!, ay = rCb[3]!, az = rCb[6]!; // prettier-ignore
  const bx = rCb[2]!, by = rCb[5]!, bz = rCb[8]!; // prettier-ignore
  rCb[1] = by * az - bz * ay;
  rCb[4] = bz * ax - bx * az;
  rCb[7] = bx * ay - by * ax;
}

/** RMS per fitted tag (px) into `tagRms`, from the per-point errors of the last fit. */
function perTagRms(_fit: Fit, nTags: number): void {
  let p = 0;
  for (let s = 0; s < nTags; s++) {
    if (!inlier[s]) continue;
    const e = fitErr2[p]! + fitErr2[p + 1]! + fitErr2[p + 2]! + fitErr2[p + 3]!;
    tagRms[s] = Math.sqrt(e / 4);
    p += 4;
  }
}

/** Median of the first n values (sorts them in place). */
function median(a: Float64Array, n: number): number {
  const v = a.subarray(0, n).sort();
  return n % 2 ? v[(n - 1) >> 1]! : 0.5 * (v[n / 2 - 1]! + v[n / 2]!);
}
