/**
 * Shared helpers for the detector's synthetic tests: hand-built boards (the
 * board module's layout helpers are written in parallel), per-tag ground truth
 * (corners, shortest projected cell edge, tilt, visibility) and corner errors.
 */
import { tagLocalToBoard } from '../../src/board/corners.js';
import { TagDetector } from '../../src/detect/detector.js';
import {
  intrinsicsFromFov,
  mulberry32,
  projectBoardCorners,
  projectBoardPoint,
  randomViewPose,
  renderBoard,
} from '../../src/synth/index.js';
import type {
  Board,
  BoardTag,
  CameraIntrinsics,
  Mat4,
  TagDetection,
  Vec2,
} from '../../src/types.js';

/** `count` distinct tag36h11 IDs, seeded, none from `exclude`. */
export function pickIds(
  rng: () => number,
  count: number,
  exclude: readonly number[] = [],
): number[] {
  const out: number[] = [];
  const used = new Set(exclude);
  while (out.length < count) {
    const id = Math.floor(rng() * 587);
    if (!used.has(id)) {
      used.add(id);
      out.push(id);
    }
  }
  return out;
}

/** A cols × rows grid of tags centred on the origin, random sizes and rotations. */
export function gridBoard(
  rng: () => number,
  ids: readonly number[],
  o: { cols: number; rows: number; pitchMm: number; sizeMm: [number, number] },
): Board {
  const tags: BoardTag[] = [];
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      const id = ids[r * o.cols + c];
      if (id === undefined) break;
      tags.push({
        id,
        centerMm: [(c - (o.cols - 1) / 2) * o.pitchMm, (r - (o.rows - 1) / 2) * o.pitchMm],
        sizeMm: o.sizeMm[0] + rng() * (o.sizeMm[1] - o.sizeMm[0]),
        rotationDeg: rng() * 360,
      });
    }
  }
  return { family: 'tag36h11', tags };
}

export interface TagTruth {
  id: number;
  /** TL, TR, BR, BL as printed, px */
  corners: [Vec2, Vec2, Vec2, Vec2];
  /** shortest edge of any projected cell of the black square, px */
  minCellPx: number;
  /** angle between the board normal and the line of sight to the tag centre, degrees */
  tiltDeg: number;
  /** black square and white ring entirely inside the frame (2 px margin) */
  inView: boolean;
}

/** Ground truth of every board tag in front of the camera. */
export function tagTruths(board: Board, k: CameraIntrinsics, pose: Mat4): TagTruth[] {
  const corners = projectBoardCorners(board, k, pose);
  const out: TagTruth[] = [];
  const n = 8; // squareCells of tag36h11
  for (const tag of board.tags) {
    const c = corners.get(tag.id);
    if (!c) continue;
    const h = tag.sizeMm / 2;
    const cell = tag.sizeMm / n;
    const project = (lx: number, ly: number): Vec2 | null => {
      const b = tagLocalToBoard(tag, lx, ly);
      return projectBoardPoint(k, pose, [b[0], 0, b[1]]);
    };
    let minCellPx = Infinity;
    const grid: (Vec2 | null)[] = [];
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) grid.push(project(-h + i * cell, -h + j * cell));
    }
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const p = grid[j * (n + 1) + i];
        const right = i < n ? grid[j * (n + 1) + i + 1] : undefined;
        const down = j < n ? grid[(j + 1) * (n + 1) + i] : undefined;
        if (!p) continue;
        if (right) minCellPx = Math.min(minCellPx, Math.hypot(right[0] - p[0], right[1] - p[1]));
        if (down) minCellPx = Math.min(minCellPx, Math.hypot(down[0] - p[0], down[1] - p[1]));
      }
    }
    const rh = (h * (n + 2)) / n; // outer edge of the white ring
    const ring = [project(-rh, -rh), project(rh, -rh), project(rh, rh), project(-rh, rh)];
    const inView = ring.every(
      (p) => p !== null && p[0] >= 2 && p[1] >= 2 && p[0] <= k.width - 3 && p[1] <= k.height - 3,
    );
    const dx = pose[12]! - tag.centerMm[0];
    const dy = pose[13]!;
    const dz = pose[14]! - tag.centerMm[1];
    const tiltDeg = (Math.acos(dy / Math.hypot(dx, dy, dz)) * 180) / Math.PI;
    out.push({ id: tag.id, corners: c, minCellPx, tiltDeg, inView });
  }
  return out;
}

/** Distances between a detection's corners and the true ones, same order, px. */
export function cornerErrorsPx(d: TagDetection, truth: TagTruth): number[] {
  return d.corners.map((p, i) =>
    Math.hypot(p[0] - truth.corners[i]![0], p[1] - truth.corners[i]![1]),
  );
}

/**
 * Worst corner distance between a quad and the truth, px, for the best of the
 * four cyclic corner shifts (candidate quads don't know the printed rotation).
 */
export function bestCyclicMaxErrPx(q: readonly Vec2[], truth: TagTruth): number {
  let best = Infinity;
  for (let s = 0; s < 4; s++) {
    let worst = 0;
    for (let i = 0; i < 4; i++) {
      const p = q[(i + s) % 4]!;
      const t = truth.corners[i]!;
      worst = Math.max(worst, Math.hypot(p[0] - t[0], p[1] - t[1]));
    }
    best = Math.min(best, worst);
  }
  return best;
}

export function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((a, v) => a + v * v, 0) / values.length);
}

export interface FrameRunOptions {
  seed: number;
  /** frame size and horizontal field of view */
  width: number;
  height: number;
  hfovDeg?: number;
  /** renderer settings */
  blurSigmaPx: number;
  noiseSigma: number;
  supersample?: number;
  gamma?: number;
  /** camera distance range and view tilt range */
  distanceMm: [number, number];
  tiltDeg: [number, number];
  /** eligible tags: shortest projected cell edge ≥ minCellPx, own tilt ≤ maxTiltDeg */
  minCellPx: number;
  maxTiltDeg: number;
  /** stop after this many eligible tag instances (or 400 frames) */
  minInstances: number;
  /** detector settings */
  decimate?: 1 | 2;
  edgeGamma?: number;
  ids?: 'board' | 'all';
  /** board: 3 × 3 tags of this size range, mm, 45 mm apart */
  sizeMm?: [number, number];
}

export interface FrameRunResult {
  frames: number;
  /** eligible tag instances */
  instances: number;
  /** eligible instances detected with the right ID */
  found: number;
  /** corner errors of the found eligible instances, px */
  errsPx: number[];
  /** eligible instances not detected (frame, id, cell size) */
  misses: string[];
  /** detections whose ID isn't in the frame or whose corners are > 1.5 px off */
  wrong: string[];
}

/**
 * Renders seeded frames of a random 3 × 3 board and runs a fresh detector per
 * call over them, collecting recall, corner errors and wrong detections. Used
 * by the D2/D3 tests and for the numbers in reports.
 */
export function runFrames(o: FrameRunOptions): FrameRunResult {
  const rng = mulberry32(o.seed);
  const k = intrinsicsFromFov(o.width, o.height, o.hfovDeg ?? 65);
  const det = new TagDetector({
    width: o.width,
    height: o.height,
    family: 'tag36h11',
    ids: 'all',
    decimate: o.decimate ?? 1,
    edgeGamma: o.edgeGamma ?? 2.2,
  });
  const res: FrameRunResult = {
    frames: 0,
    instances: 0,
    found: 0,
    errsPx: [],
    misses: [],
    wrong: [],
  };
  for (let frame = 0; res.instances < o.minInstances && frame < 400; frame++) {
    res.frames++;
    const board = gridBoard(rng, pickIds(rng, 9), {
      cols: 3,
      rows: 3,
      pitchMm: 45,
      sizeMm: o.sizeMm ?? [24, 32],
    });
    if (o.ids !== 'all') det.setIds(board.tags.map((t) => t.id));
    const pose = randomViewPose(rng, {
      distanceMm: o.distanceMm,
      tiltDeg: o.tiltDeg,
      rollDeg: [0, 360],
      targetBoxMm: { min: [-20, -20], max: [20, 20] },
    });
    const img = renderBoard({
      board,
      intrinsics: k,
      boardFromCamera: pose,
      blurSigmaPx: o.blurSigmaPx,
      noiseSigma: o.noiseSigma,
      seed: o.seed * 1000 + frame,
      supersample: o.supersample ?? 8,
      gamma: o.gamma ?? 2.2,
    });
    const dets = det.detect(img);
    const truths = new Map(tagTruths(board, k, pose).map((t) => [t.id, t]));
    for (const d of dets) {
      const t = truths.get(d.id);
      const err = t ? Math.max(...cornerErrorsPx(d, t)) : Infinity;
      if (!(err <= 1.5)) res.wrong.push(`frame ${frame} id ${d.id} err ${err.toFixed(2)} px`);
    }
    for (const t of truths.values()) {
      if (!t.inView || t.minCellPx < o.minCellPx || t.tiltDeg > o.maxTiltDeg) continue;
      res.instances++;
      const d = dets.find((x) => x.id === t.id);
      if (!d) {
        res.misses.push(
          `frame ${frame} id ${t.id} cell ${t.minCellPx.toFixed(2)} px tilt ${t.tiltDeg.toFixed(1)}°`,
        );
        continue;
      }
      res.found++;
      res.errsPx.push(...cornerErrorsPx(d, t));
    }
  }
  return res;
}
