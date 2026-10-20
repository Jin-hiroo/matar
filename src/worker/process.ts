/**
 * `FrameProcessor`: the per-frame pipeline shared by the worker and the inline
 * path (ARCHITECTURE.md §1, §6.3): gray image → detect (§4) → pose (§5) →
 * focal self-calibration (§5.5) → a `result` message.
 *
 * Input: a gray image (analysis resolution, already in display orientation),
 * the frame ID and timestamp. Output: `WorkerToMain` messages (`result`, and
 * `intrinsics` when the estimate changes).
 *
 * Intrinsics are kept **per frame size** (`w×h`): a rotation to landscape gets
 * its own prior/estimate, and turning back finds the old one again (§5.5 step
 * 7: intrinsics are reused only for the same size and orientation). Provided
 * intrinsics apply to their own size only.
 *
 * The stages are injected (`Stages`) so tests can use fakes; the defaults are
 * in `./stages.ts`.
 */
import type {
  Board,
  BoardPose,
  CameraIntrinsics,
  Detector,
  DetectorOptions,
  FocalEstimator,
  FocalSource,
  FrameInfo,
  GrayImage,
  Mat4,
  TagDetection,
  WorkerOptions,
  WorkerToMain,
} from '../types.js';
import { readFrameIndex } from './gray.js';

export interface Stages {
  createDetector(opts: DetectorOptions): Detector;
  estimatePose(
    detections: readonly TagDetection[],
    board: Board,
    intrinsics: CameraIntrinsics,
    previous?: Mat4,
  ): BoardPose | null;
  createFocalEstimator(initial: {
    intrinsics: CameraIntrinsics;
    source: 'prior' | 'provided';
  }): FocalEstimator;
  focalPrior(width: number, height: number, fovPriorDeg?: number): CameraIntrinsics;
}

type ResultMessage = Extract<WorkerToMain, { type: 'result' }>;
type IntrinsicsMessage = Extract<WorkerToMain, { type: 'intrinsics' }>;

interface SizeState {
  focal: FocalEstimator;
}

const THUMB_MAX_W = 160;

export class FrameProcessor {
  private board: Board;
  private detector: Detector | null = null;
  private readonly sizes = new Map<string, SizeState>();
  private provided: CameraIntrinsics | null;
  private previous: Mat4 | undefined;
  private previousKey = '';

  constructor(
    private readonly stages: Stages,
    board: Board,
    intrinsics: CameraIntrinsics | null,
    private readonly options: WorkerOptions,
  ) {
    this.board = board;
    this.provided = intrinsics;
  }

  setBoard(board: Board): void {
    this.board = board;
    this.detector?.setIds(board.tags.map((t) => t.id));
    this.previous = undefined;
    for (const s of this.sizes.values()) s.focal.reset();
  }

  /** New provided (or reset-to-prior) intrinsics; applies to their own frame size. */
  setIntrinsics(k: CameraIntrinsics, source: 'provided' | 'prior'): void {
    const key = sizeKey(k.width, k.height);
    if (source === 'provided') this.provided = k;
    else if (this.provided && sizeKey(this.provided.width, this.provided.height) === key) {
      this.provided = null;
    }
    this.sizes.delete(key);
  }

  /** Intrinsics in use for a frame size (creating the prior/provided state on first use). */
  intrinsicsFor(width: number, height: number): { k: CameraIntrinsics; source: FocalSource } {
    const s = this.stateFor(width, height);
    return { k: s.focal.intrinsics, source: s.focal.source };
  }

  process(
    gray: GrayImage,
    frameId: number,
    timestampMs: number,
    frame: FrameInfo,
    grayMs: number,
  ): { result: ResultMessage; intrinsics: IntrinsicsMessage | null } {
    const t0 = now();
    const { width, height } = gray;
    const key = sizeKey(width, height);
    const state = this.stateFor(width, height);
    if (key !== this.previousKey) {
      this.previous = undefined; // a pose from another orientation is no hint
      this.previousKey = key;
    }

    const detector = this.detectorFor(width, height);
    const detections = detector.detect(gray);
    const t1 = now();

    const k = state.focal.intrinsics;
    const focalSource = state.focal.source;
    const pose = detections.length
      ? this.stages.estimatePose(detections, this.board, k, this.previous)
      : null;
    this.previous = pose?.boardFromCamera ?? this.previous;
    const t2 = now();

    let intrinsicsMsg: IntrinsicsMessage | null = null;
    if (pose && this.options.autoFocal) {
      const est = state.focal.add(pose, detections, this.board);
      if (est) {
        intrinsicsMsg = {
          type: 'intrinsics',
          intrinsics: est.intrinsics,
          source: 'estimated',
          stdDevPct: est.stdDevPct,
        };
      }
    }
    const t3 = now();

    const result: ResultMessage = {
      type: 'result',
      frameId,
      timestampMs,
      width,
      height,
      detections,
      pose,
      intrinsics: k,
      focalSource,
      timingsMs: {
        gray: grayMs,
        detect: t1 - t0,
        pose: t2 - t1,
        focal: t3 - t2,
        total: grayMs + (t3 - t0),
      },
      frame,
    };
    if (this.options.debug) {
      result.debugFrameIndex = readFrameIndex(gray.data, width, height);
      result.thumbnail = thumbnail(gray);
    }
    return { result, intrinsics: intrinsicsMsg };
  }

  private stateFor(width: number, height: number): SizeState {
    const key = sizeKey(width, height);
    let s = this.sizes.get(key);
    if (!s) {
      const p = this.provided;
      const initial =
        p && p.width === width && p.height === height
          ? { intrinsics: p, source: 'provided' as const }
          : {
              intrinsics: this.stages.focalPrior(width, height, this.options.fovPriorDeg),
              source: 'prior' as const,
            };
      s = { focal: this.stages.createFocalEstimator(initial) };
      this.sizes.set(key, s);
    }
    return s;
  }

  private detectorFor(width: number, height: number): Detector {
    if (!this.detector) {
      const o = this.options;
      const opts: DetectorOptions = {
        width,
        height,
        family: this.board.family,
        ids: this.board.tags.map((t) => t.id),
      };
      if (o.decimate !== undefined) opts.decimate = o.decimate;
      if (o.maxCorrectedBits !== undefined) opts.maxCorrectedBits = o.maxCorrectedBits;
      if (o.minContrast !== undefined) opts.minContrast = o.minContrast;
      if (o.edgeGamma !== undefined) opts.edgeGamma = o.edgeGamma;
      this.detector = this.stages.createDetector(opts);
    }
    return this.detector; // it reallocates by itself when the frame size changes (§4)
  }
}

function sizeKey(w: number, h: number): string {
  return `${w}x${h}`;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Point-sampled copy of `gray`, at most THUMB_MAX_W wide (debug HUD only). */
function thumbnail(gray: GrayImage): { width: number; height: number; data: ArrayBuffer } {
  const step = Math.max(1, Math.ceil(gray.width / THUMB_MAX_W));
  const w = Math.floor(gray.width / step);
  const h = Math.floor(gray.height / step);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * step * gray.width;
    for (let x = 0; x < w; x++) out[y * w + x] = gray.data[row + x * step]!; // `!`: in range
  }
  return { width: w, height: h, data: out.buffer };
}
