/**
 * Shared types: the contract between workstreams (CLAUDE.md). Change them
 * deliberately and say so in the commit message.
 *
 * Frames and units (ARCHITECTURE.md §2):
 * - Board frame: right-handed, Y up, paper on the XZ plane, +X right, +Z toward
 *   the bottom edge of the printed page. Millimetres.
 * - Page frame (SVG): x right, y down, mm. board (x, z) = page (x, y) − originMm.
 * - Camera, CV convention (internal): +X right, +Y down, +Z forward.
 * - Camera, GL convention (public poses): +X right, +Y up, −Z forward.
 * - Image: pixels, x right, y down, pixel centres at integer coordinates.
 */

/** [x, y] in pixels, or [x, z] in board mm on the paper plane, as documented per field. */
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** 3×3 matrix, **row-major**, length 9. */
export type Mat3 = Float64Array;

/** 4×4 matrix, **column-major** (three.js `Matrix4.elements` order), length 16. */
export type Mat4 = Float64Array;

/** 8-bit grayscale image, row-major, stride = width. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Tags and boards

/** A square fiducial tag family (code table + geometry). See `src/tags/`. */
export interface TagFamily {
  /** stable identifier stored by integrators, e.g. `'tag36h11'` */
  readonly name: string;
  /** data cells per side (6 for a 36-bit family) */
  readonly dataCells: number;
  /**
   * cells per side of the printed black square including its black border
   * (dataCells + 2). `BoardTag.sizeMm` spans exactly these cells.
   */
  readonly squareCells: number;
  /** minimum Hamming distance between codes, over all four rotations */
  readonly minHamming: number;
  /** bit errors corrected when decoding (≤ ⌊(minHamming − 1) / 2⌋) */
  readonly maxCorrectedBits: number;
  /** number of valid IDs (IDs are 0 … count − 1) */
  readonly count: number;
}

/** One printed tag on a board. */
export interface BoardTag {
  /** tag ID within the board's family */
  id: number;
  /** centre on the paper plane, board frame [x, z], mm */
  centerMm: Vec2;
  /** edge length of the black square (outer edge of the black border), mm */
  sizeMm: number;
  /**
   * in-plane rotation, degrees, positive = clockwise on the printed page
   * (same sense as SVG `rotate()`), i.e. clockwise seen from above (+Y).
   */
  rotationDeg: number;
}

/** A planar board: the tags printed on the mat, in board coordinates. */
export interface Board {
  /** `TagFamily.name` */
  family: string;
  tags: readonly BoardTag[];
}

// ---------------------------------------------------------------------------
// Detection

/**
 * A decoded tag in one image. Corners are in image pixels, in the tag's own
 * printed order: top-left, top-right, bottom-right, bottom-left of the
 * unrotated tag as printed (clockwise on the page). The same order as
 * `boardTagCornersMm()`.
 */
export interface TagDetection {
  id: number;
  corners: [Vec2, Vec2, Vec2, Vec2];
  /** bits corrected while decoding */
  hammingBits: number;
  /** decoding confidence: mean |intensity − threshold| over data cells, 0–255 */
  margin: number;
}

// ---------------------------------------------------------------------------
// Camera and pose

/** Pinhole intrinsics of the frames the detector sees (no distortion). */
export interface CameraIntrinsics {
  /** frame size, px */
  width: number;
  height: number;
  /** focal lengths, px */
  fx: number;
  fy: number;
  /** principal point, px (image centre is ((w − 1) / 2, (h − 1) / 2)) */
  cx: number;
  cy: number;
}

/** Board pose estimated from one frame. */
export interface BoardPose {
  /**
   * Maps camera coordinates (GL convention) to board coordinates, mm,
   * column-major. With the board as the world this is the camera's world matrix
   * (before mm → m).
   */
  boardFromCamera: Mat4;
  /** RMS reprojection error over the inlier corners, px */
  rmsErrPx: number;
  /** IDs of the tags used in the fit */
  usedTagIds: number[];
  /** IDs detected but rejected as outliers or unknown to the board */
  rejectedTagIds: number[];
}
