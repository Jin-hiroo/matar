/**
 * Synthetic camera helpers: build poses and project board points.
 *
 * Poses are `boardFromCamera` in the GL camera convention (+X right, +Y up,
 * −Z forward), mm, column-major (ARCHITECTURE.md §2.4–2.5). Projection is the
 * pinhole model with pixel centres at integer coordinates:
 * u = fx·X/Z + cx, v = fy·Y/Z + cy in CV camera coordinates (Y down, Z forward).
 *
 * Small rigid-transform maths is duplicated from what src/math will provide;
 * de-duplicate after WS-P lands.
 */
import { boardTagCornersMm } from '../board/corners.js';
import type { Board, CameraIntrinsics, Mat4, Vec2, Vec3 } from '../types.js';
import { uniform } from './random.js';

const DEG = Math.PI / 180;

function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n === 0) throw new Error('matar/testing: zero-length vector');
  return [v[0] / n, v[1] / n, v[2] / n];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Camera at `eyeMm` looking at `targetMm` (board frame). `upHint` is the board
 * direction that should appear "up" in the image; default −Z (toward the top of
 * the printed page), so a camera above the board sees the page upright.
 * Returns `boardFromCamera` (GL, mm, column-major).
 */
export function lookAtPose(eyeMm: Vec3, targetMm: Vec3, upHint: Vec3 = [0, 0, -1]): Mat4 {
  const z = normalize([eyeMm[0] - targetMm[0], eyeMm[1] - targetMm[1], eyeMm[2] - targetMm[2]]);
  const x = normalize(cross(upHint, z));
  const y = cross(z, x);
  return Float64Array.of(...x, 0, ...y, 0, ...z, 0, eyeMm[0], eyeMm[1], eyeMm[2], 1) as Mat4;
}

/** Applies an extra roll (rotation about the camera's viewing axis), degrees, positive = image turns clockwise. */
export function rollPose(boardFromCamera: Mat4, rollDeg: number): Mat4 {
  // camera-local rotation about +Z (GL): rotating the camera counter-clockwise
  // about its viewing axis makes the image content turn clockwise.
  const c = Math.cos(rollDeg * DEG);
  const s = Math.sin(rollDeg * DEG);
  const m = boardFromCamera;
  const out = Float64Array.from(m) as Mat4;
  for (let r = 0; r < 3; r++) {
    const xr = m[r] as number;
    const yr = m[4 + r] as number;
    out[r] = c * xr + s * yr;
    out[4 + r] = -s * xr + c * yr;
  }
  return out;
}

/** Pinhole intrinsics for a w × h frame with a horizontal field of view (degrees, along width). */
export function intrinsicsFromFov(
  width: number,
  height: number,
  hfovDeg: number,
): CameraIntrinsics {
  const f = width / 2 / Math.tan((hfovDeg * DEG) / 2);
  return { width, height, fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
}

/**
 * Projects a board point (mm) to pixels. Returns null if it is behind the camera.
 * `boardFromCamera`: GL, mm, column-major.
 */
export function projectBoardPoint(
  k: CameraIntrinsics,
  boardFromCamera: Mat4,
  p: Vec3,
): Vec2 | null {
  const m = boardFromCamera;
  const dx = p[0] - (m[12] as number);
  const dy = p[1] - (m[13] as number);
  const dz = p[2] - (m[14] as number);
  // camera (GL) = Rᵀ (p − t); columns of R are the camera axes in board coordinates
  const xg = (m[0] as number) * dx + (m[1] as number) * dy + (m[2] as number) * dz;
  const yg = (m[4] as number) * dx + (m[5] as number) * dy + (m[6] as number) * dz;
  const zg = (m[8] as number) * dx + (m[9] as number) * dy + (m[10] as number) * dz;
  // CV: X = xg, Y = −yg, Z = −zg
  const zc = -zg;
  if (zc <= 1e-9) return null;
  return [k.fx * (xg / zc) + k.cx, k.fy * (-yg / zc) + k.cy];
}

/**
 * Ground-truth image corners of every board tag in front of the camera,
 * TL, TR, BR, BL (same order as `TagDetection.corners`). Tags with any corner
 * behind the camera are omitted; corners outside the frame are kept.
 */
export function projectBoardCorners(
  board: Board,
  k: CameraIntrinsics,
  boardFromCamera: Mat4,
): Map<number, [Vec2, Vec2, Vec2, Vec2]> {
  const out = new Map<number, [Vec2, Vec2, Vec2, Vec2]>();
  for (const tag of board.tags) {
    const pts = boardTagCornersMm(tag).map((c) =>
      projectBoardPoint(k, boardFromCamera, [c[0], 0, c[1]]),
    );
    if (pts.every((p) => p !== null)) out.set(tag.id, pts as [Vec2, Vec2, Vec2, Vec2]);
  }
  return out;
}

export interface RandomViewOptions {
  /** distance from the target, mm */
  distanceMm: [number, number];
  /** angle between the viewing direction and the board normal, degrees */
  tiltDeg: [number, number];
  /** target point on the board is drawn uniformly from this [x, z] box, mm */
  targetBoxMm?: { min: Vec2; max: Vec2 };
  /** extra roll about the viewing axis, degrees */
  rollDeg?: [number, number];
}

/** A random camera above the board looking at a point on it. `boardFromCamera`, GL, mm. */
export function randomViewPose(rng: () => number, o: RandomViewOptions): Mat4 {
  const d = uniform(rng, o.distanceMm[0], o.distanceMm[1]);
  const tilt = uniform(rng, o.tiltDeg[0], o.tiltDeg[1]) * DEG;
  const azimuth = uniform(rng, 0, 2 * Math.PI);
  const box = o.targetBoxMm ?? { min: [0, 0], max: [0, 0] };
  const tx = uniform(rng, box.min[0], box.max[0]);
  const tz = uniform(rng, box.min[1], box.max[1]);
  const eye: Vec3 = [
    tx + d * Math.sin(tilt) * Math.cos(azimuth),
    d * Math.cos(tilt),
    tz + d * Math.sin(tilt) * Math.sin(azimuth),
  ];
  const pose = lookAtPose(eye, [tx, 0, tz], [0, 0, -1]);
  const roll = o.rollDeg ? uniform(rng, o.rollDeg[0], o.rollDeg[1]) : 0;
  return roll === 0 ? pose : rollPose(pose, roll);
}
