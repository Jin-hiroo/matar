/**
 * Shared helpers for the detector's synthetic tests: hand-built boards (the
 * board module's layout helpers are written in parallel), per-tag ground truth
 * (corners, shortest projected cell edge, tilt, visibility) and corner errors.
 */
import { tagLocalToBoard } from '../../src/board/corners.js';
import { projectBoardCorners, projectBoardPoint } from '../../src/synth/index.js';
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
