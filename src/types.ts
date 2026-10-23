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

// ---------------------------------------------------------------------------
// Pure stages (ARCHITECTURE.md §4, §5): implemented in src/detect and src/pose

/** Options of `createDetector` (ARCHITECTURE.md §4). */
export interface DetectorOptions {
  /** frame size the buffers are allocated for; other sizes reallocate */
  width: number;
  height: number;
  /** `TagFamily.name` */
  family: string;
  /** IDs to decode (the board's), or every ID of the family (debug) */
  ids: readonly number[] | 'all';
  /** default: the family's `maxCorrectedBits` (2 for tag36h11) */
  maxCorrectedBits?: number;
  /** local max − min (of 2 × 2 block means) below this (DN) is "unknown" in the threshold, default 15 */
  minContrast?: number;
  /** quad search on a ×2 box-averaged image; default `'auto'` (§4.1 step 1) */
  decimate?: 1 | 2 | 'auto';
  /**
   * gamma of the camera encoding, used to linearise samples before the edge
   * search (§4.1 step 4); default 2.2, 1 = off
   */
  edgeGamma?: number;
}

export interface Detector {
  /** finds the board's tags; reuses internal buffers (no per-call allocation after warm-up) */
  detect(img: GrayImage): TagDetection[];
  setIds(ids: readonly number[] | 'all'): void;
}

/** One Euro filter parameters (Casiez et al. 2012). */
export interface OneEuroParams {
  /** cutoff at zero speed, Hz */
  minCutoffHz: number;
  /** cutoff increase per unit of speed: Hz per mm/s (position) or per rad/s (rotation) */
  beta: number;
}

/** Options of `createPoseFilter` (ARCHITECTURE.md §5.6). Defaults there. */
export interface PoseFilterOptions {
  position?: Partial<OneEuroParams>;
  rotation?: Partial<OneEuroParams>;
  /** cutoff of the speed estimate, Hz */
  dCutoffHz?: number;
  /** a raw pose this far from the filtered one is a jump: mm, degrees */
  jumpMm?: number;
  jumpDeg?: number;
  /** a jump is taken (filter reset to it) after persisting this many frames */
  jumpFrames?: number;
  /** with no pose for this long, the output becomes null and the filter resets */
  lostAfterMs?: number;
}

/**
 * Smooths `boardFromCamera` (GL, mm, column-major) over time. `update(null, t)`
 * means "no pose this frame": the last output is held until `lostAfterMs` has
 * passed since the last pose, then `null` is returned and the filter resets.
 * Timestamps are frame timestamps, ms.
 */
export interface PoseFilter {
  update(boardFromCamera: Mat4 | null, timestampMs: number): Mat4 | null;
  reset(): void;
}

/** Where the intrinsics in use came from (ARCHITECTURE.md §5.5). */
export type FocalSource = 'prior' | 'provided' | 'estimated';

export interface FocalEstimate {
  intrinsics: CameraIntrinsics;
  source: 'estimated';
  /** standard deviation of f, % of f */
  stdDevPct: number;
  /** keyframes it is based on */
  keyframes: number;
}

/**
 * Focal-length self-calibration (ARCHITECTURE.md §5.5), worker-side state.
 * `add` offers one frame's result; it returns a new accepted estimate when the
 * intrinsics in use should change, else null.
 */
export interface FocalEstimator {
  add(pose: BoardPose, detections: readonly TagDetection[], board: Board): FocalEstimate | null;
  /** drop all keyframes (new board, new camera, new frame size) */
  reset(initial?: { intrinsics: CameraIntrinsics; source: 'prior' | 'provided' }): void;
  readonly intrinsics: CameraIntrinsics;
  readonly source: FocalSource;
  readonly stdDevPct: number | null;
}

// ---------------------------------------------------------------------------
// Worker protocol (ARCHITECTURE.md §6.3): src/worker and src/tracker

/** Per-tracker settings the worker needs. */
export interface WorkerOptions {
  decimate?: 1 | 2 | 'auto';
  maxCorrectedBits?: number;
  minContrast?: number;
  edgeGamma?: number;
  /** long-side field of view for the focal prior, degrees (default 68) */
  fovPriorDeg: number;
  autoFocal: boolean;
  /** read the frame-index strip of test videos into `debugFrameIndex` (§9.2) */
  debug: boolean;
}

export type MainToWorker =
  | {
      type: 'init';
      board: Board;
      /** null → the worker builds the prior from the first frame's size */
      intrinsics: CameraIntrinsics | null;
      options: WorkerOptions;
    }
  | { type: 'board'; board: Board }
  | { type: 'intrinsics'; intrinsics: CameraIntrinsics; source: 'provided' | 'prior' }
  | {
      type: 'frame';
      frameId: number;
      timestampMs: number;
      /** what the `<video>` shows (`videoWidth`/`videoHeight`), to detect transposed frames (§6.2) */
      displayWidth: number;
      displayHeight: number;
      /** `screen.orientation.angle` at grab time, degrees */
      screenAngleDeg: number;
      /** exactly one of `videoFrame` (transferred) and `gray` (fallback, tests) */
      videoFrame?: VideoFrame;
      gray?: { width: number; height: number; data: ArrayBuffer };
    }
  | { type: 'dispose' };

/** Source of an analysed frame, as reported in results and stats. */
export interface FrameInfo {
  path: 'videoframe' | 'canvas' | 'gray';
  /** `VideoFrame.format` (null: opaque); null on the canvas/gray paths */
  format: string | null;
  codedWidth: number;
  codedHeight: number;
  /** clockwise rotation applied to reach the displayed orientation, degrees */
  rotationDeg: number;
}

export interface FrameTimingsMs {
  gray: number;
  detect: number;
  pose: number;
  focal: number;
  total: number;
}

export type WorkerToMain =
  | { type: 'ready' }
  | {
      type: 'result';
      frameId: number;
      timestampMs: number;
      /** analysed image size (after rotation) */
      width: number;
      height: number;
      detections: TagDetection[];
      /** raw, unsmoothed */
      pose: BoardPose | null;
      /** the intrinsics this frame was solved with */
      intrinsics: CameraIntrinsics;
      focalSource: FocalSource;
      timingsMs: FrameTimingsMs;
      /** gray buffer handed back for reuse (fallback path) */
      returned?: ArrayBuffer;
      /** with `debug`: the frame index read from the test video's strip, or null */
      debugFrameIndex?: number | null;
      /** what the frame looked like before conversion (for the debug HUD) */
      frame: FrameInfo;
      /** with `debug`: a ≤ 160 px wide copy of the analysed gray image */
      thumbnail?: { width: number; height: number; data: ArrayBuffer };
    }
  | {
      /** the frame couldn't be read (opaque format): switch to the canvas path */
      type: 'fallback';
      frameId: number;
      reason: 'opaque-frame';
    }
  | {
      type: 'intrinsics';
      intrinsics: CameraIntrinsics;
      source: 'estimated';
      stdDevPct: number;
    }
  | { type: 'error'; code: TrackerErrorCode; message: string; frameId?: number };

// ---------------------------------------------------------------------------
// Tracker (ARCHITECTURE.md §6.4, §8): src/tracker; consumed by src/three

export type TrackerState = 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export type TrackerErrorCode =
  | 'insecure-context'
  | 'no-camera-api'
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'overconstrained'
  | 'worker-failed'
  | 'unknown';

export type LensKind = 'pinned' | 'virtual' | 'unknown';

/** What became of `TrackerOptions.camera.maxExposureMs` (ARCHITECTURE.md §6.1). */
export type ExposureState =
  /** not asked for */
  | 'off'
  /** waiting for the automatic exposure to settle, or for the camera to confirm */
  | 'pending'
  /** no manual exposure with ISO control on this camera or browser (e.g. iOS Safari), or none shorter */
  | 'unsupported'
  /** the automatic exposure was already that short: left alone */
  | 'auto'
  /** set to the maximum, and the camera reports it */
  | 'short'
  /**
   * refused, or the camera reported another time: automatic exposure asked for
   * again (`timeMs` and `iso` are what the camera reports after that)
   */
  | 'refused';

export interface CameraExposure {
  readonly state: ExposureState;
  /** the camera's exposure time when last checked, ms; null if not reported */
  readonly timeMs: number | null;
  /** its ISO then; null if not reported */
  readonly iso: number | null;
}

export interface TrackerOptions {
  board: Board;
  /** created if omitted: playsinline, muted, kept in the DOM (1 × 1 px, opacity 0) */
  video?: HTMLVideoElement;
  camera?: {
    width?: number;
    height?: number;
    frameRate?: number;
    deviceId?: string;
    /**
     * Shorter exposure against motion blur, ms (Android Chrome: Image Capture
     * manual exposure). About 1 s after the camera opens, an automatic
     * exposure longer than this is set to it, with the ISO raised by the same
     * factor; fixed from then on (it doesn't follow the light). Undone if the
     * camera doesn't confirm it. Elsewhere nothing changes. See
     * `stats.camera.exposure`.
     */
    maxExposureMs?: number;
  };
  /** restore a saved calibration (used only for the same frame size and orientation) */
  intrinsics?: CameraIntrinsics;
  /** long-side FOV prior, degrees, default 68 (§5.5) */
  fovPriorDeg?: number;
  /** focal self-calibration, default true */
  autoFocal?: boolean;
  /** pose smoothing and loss hold (§5.6); `false`: `smoothed` = raw pose, no hold */
  smoothing?: PoseFilterOptions | false;
  /** default: the bundled module worker; `false`: run inline on the main thread */
  worker?: Worker | false;
  /** detector settings passed to the worker */
  detector?: Pick<DetectorOptions, 'decimate' | 'maxCorrectedBits' | 'minContrast' | 'edgeGamma'>;
  /** read test videos' frame-index strip (§9.2) */
  debug?: boolean;
}

export interface TrackerStats {
  fps: number;
  workerMs: number;
  timingsMs: FrameTimingsMs;
  camera: {
    label: string;
    lens: LensKind;
    devices: readonly string[];
    exposure: CameraExposure;
  };
  focal: { fx: number; source: FocalSource; stdDevPct: number | null };
  worker: 'module' | 'inline';
  frame: FrameInfo;
}

/** `'pose'`: one per analysed frame. */
export interface PoseEvent extends Event {
  readonly frameId: number;
  readonly timestampMs: number;
  /** this frame's raw estimate; null if the frame gave none */
  readonly pose: BoardPose | null;
  /**
   * filtered `boardFromCamera` (GL, mm, column-major); holds the last value
   * through short gaps, null once lost (§5.6). Tracking ⇔ `smoothed !== null`.
   */
  readonly smoothed: Mat4 | null;
  readonly detections: readonly TagDetection[];
  /** used for this frame */
  readonly intrinsics: CameraIntrinsics;
  readonly stats: TrackerStats;
  /** with `debug`: the test video's frame index */
  readonly debugFrameIndex: number | null;
  /** with `debug`: a small copy of the analysed gray image */
  readonly thumbnail: GrayImage | null;
}

/**
 * `'grab'`: dispatched synchronously in the frame callback that grabs frame
 * `frameId`, before `frame` is transferred to the worker (§7.2). Listeners
 * that want the pixels (texture upload) must use them inside the handler.
 */
export interface GrabEvent extends Event {
  readonly frameId: number;
  readonly video: HTMLVideoElement;
  /** null on the canvas fallback path (no `VideoFrame`) */
  readonly frame: VideoFrame | null;
}

/** `'intrinsics'`: the intrinsics in use changed. */
export interface IntrinsicsEvent extends Event {
  readonly intrinsics: CameraIntrinsics;
  readonly source: FocalSource;
  readonly stdDevPct: number | null;
}

/** `'state'`: `tracker.state` changed. */
export interface StateEvent extends Event {
  readonly state: TrackerState;
  readonly previous: TrackerState;
}

/** `'error'`: also moves the tracker to `'error'` unless it recovered (e.g. worker → inline). */
export interface TrackerErrorEvent extends Event {
  readonly code: TrackerErrorCode;
  readonly message: string;
  readonly cause?: unknown;
}

export interface TrackerEventMap {
  pose: PoseEvent;
  grab: GrabEvent;
  intrinsics: IntrinsicsEvent;
  state: StateEvent;
  error: TrackerErrorEvent;
}

export interface Tracker extends EventTarget {
  readonly state: TrackerState;
  readonly video: HTMLVideoElement;
  /** null until the first frame's size is known */
  readonly intrinsics: CameraIntrinsics | null;
  /** asks for the camera; call from a user gesture */
  start(): Promise<void>;
  stop(): void;
  setBoard(board: Board): void;
  addEventListener<K extends keyof TrackerEventMap>(
    type: K,
    listener: (ev: TrackerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof TrackerEventMap>(
    type: K,
    listener: (ev: TrackerEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
}
