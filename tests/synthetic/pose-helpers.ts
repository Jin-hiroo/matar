/**
 * Shared helpers for the pose synthetic tests: hand-built boards (createBoard is
 * written in parallel), noisy detections from the synthetic projection oracle,
 * and pose error metrics.
 */
import { mat4GetRotation, rotationAngleBetween } from '../../src/math/index.js';
import { projectBoardCorners, projectBoardPoint } from '../../src/synth/camera.js';
import type {
  Board,
  BoardTag,
  CameraIntrinsics,
  Mat4,
  TagDetection,
  Vec2,
  Vec3,
} from '../../src/types.js';

export const DEG = Math.PI / 180;

/**
 * A4 landscape (297 × 210 mm) centred on the board origin with a ring of 12 ×
 * 32 mm tags ≥ 8 mm from the edge: 5 along the top and bottom edges, 1 on each
 * side. Rotations vary so corner order is exercised.
 */
export function a4Ring12(): Board {
  const ids = [3, 17, 42, 101, 150, 203, 256, 300, 333, 404, 480, 555];
  const tags: BoardTag[] = [];
  const xEdge = 148.5 - 8 - 16;
  const zEdge = 105 - 8 - 16;
  const centres: Vec2[] = [];
  for (let k = 0; k < 5; k++) centres.push([-xEdge + (k * 2 * xEdge) / 4, -zEdge]);
  for (let k = 0; k < 5; k++) centres.push([-xEdge + (k * 2 * xEdge) / 4, zEdge]);
  centres.push([-xEdge, 0], [xEdge, 0]);
  centres.forEach((c, i) =>
    tags.push({ id: ids[i]!, centerMm: c, sizeMm: 32, rotationDeg: [0, 90, 180, 270][i % 4]! }),
  );
  return { family: 'tag36h11', tags };
}

/** a4Ring12 plus 3 inner 20 mm tags (15 tags), for timing. */
export function a4Ring15(): Board {
  const b = a4Ring12();
  return {
    family: b.family,
    tags: [
      ...b.tags,
      { id: 7, centerMm: [-60, 0], sizeMm: 20, rotationDeg: 0 },
      { id: 8, centerMm: [0, 40], sizeMm: 20, rotationDeg: 30 },
      { id: 9, centerMm: [60, 0], sizeMm: 20, rotationDeg: 0 },
    ],
  };
}

/** One tag at the board origin. */
export function singleTag(sizeMm: number, id = 42): Board {
  return { family: 'tag36h11', tags: [{ id, centerMm: [0, 0], sizeMm, rotationDeg: 0 }] };
}

/**
 * Detections of every board tag fully inside the frame (all corners ≥ `marginPx`
 * from the image border), with iid Gaussian corner noise σ px per coordinate.
 */
export function observe(
  board: Board,
  k: CameraIntrinsics,
  boardFromCamera: Mat4,
  noise: (() => number) | null,
  sigmaPx: number,
  marginPx = 2,
): TagDetection[] {
  const out: TagDetection[] = [];
  for (const [id, corners] of projectBoardCorners(board, k, boardFromCamera)) {
    const inside = corners.every(
      ([u, v]) =>
        u >= marginPx &&
        v >= marginPx &&
        u <= k.width - 1 - marginPx &&
        v <= k.height - 1 - marginPx,
    );
    if (!inside) continue;
    const c = corners.map(([u, v]) =>
      noise ? ([u + sigmaPx * noise(), v + sigmaPx * noise()] as Vec2) : ([u, v] as Vec2),
    );
    out.push({ id, corners: c as [Vec2, Vec2, Vec2, Vec2], hammingBits: 0, margin: 60 });
  }
  return out;
}

export interface PoseError {
  /** camera position error, mm */
  posMm: number;
  /** rotation error, degrees */
  rotDeg: number;
}

export function poseError(est: Mat4, truth: Mat4): PoseError {
  return {
    posMm: Math.hypot(est[12]! - truth[12]!, est[13]! - truth[13]!, est[14]! - truth[14]!),
    rotDeg: rotationAngleBetween(mat4GetRotation(est), mat4GetRotation(truth)) / DEG,
  };
}

/** Depth of a board point in the CV camera of `boardFromCamera` (GL), mm. */
export function depthMm(boardFromCamera: Mat4, p: Vec3): number {
  const m = boardFromCamera;
  const dx = p[0] - m[12]!;
  const dy = p[1] - m[13]!;
  const dz = p[2] - m[14]!;
  return -(m[8]! * dx + m[9]! * dy + m[10]! * dz);
}

/**
 * Overlay error of board point p: distance between its projections under the
 * true and estimated poses, converted to mm at its (true) depth.
 */
export function overlayErrorMm(k: CameraIntrinsics, est: Mat4, truth: Mat4, p: Vec3): number {
  const a = projectBoardPoint(k, truth, p);
  const b = projectBoardPoint(k, est, p);
  if (!a || !b) return Infinity;
  const px = Math.hypot((a[0] - b[0]) / k.fx, (a[1] - b[1]) / k.fy);
  return px * depthMm(truth, p);
}

export function rms(xs: readonly number[]): number {
  return Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);
}

export function quantile(xs: readonly number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
}

export function fmt(x: number, digits = 3): string {
  return x === 0 || (Math.abs(x) >= 1e-3 && Math.abs(x) < 1e4)
    ? x.toFixed(digits)
    : x.toExponential(1);
}
