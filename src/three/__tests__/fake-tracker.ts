/**
 * Test double of the `Tracker` interface (src/types.ts) for `matar/three`
 * tests, in Node (vitest) and in the browser fixture (tests/e2e/three). It
 * dispatches `grab` and `pose` events shaped like `GrabEvent` / `PoseEvent`;
 * poses are `boardFromCamera` (GL, mm, column-major). Not part of the build.
 */
import type {
  Board,
  CameraIntrinsics,
  GrabEvent,
  Mat4,
  PoseEvent,
  Tracker,
  TrackerState,
  TrackerStats,
} from '../../types.js';

const STATS: TrackerStats = {
  fps: 30,
  workerMs: 0,
  timingsMs: { gray: 0, detect: 0, pose: 0, focal: 0, total: 0 },
  camera: { label: 'fake', lens: 'unknown', devices: [] },
  focal: { fx: 0, source: 'provided', stdDevPct: null },
  worker: 'inline',
  frame: { path: 'gray', format: null, codedWidth: 0, codedHeight: 0, rotationDeg: 0 },
};

export class FakeTracker extends EventTarget implements Tracker {
  state: TrackerState = 'running';
  intrinsics: CameraIntrinsics | null = null;

  constructor(readonly video: HTMLVideoElement) {
    super();
  }

  async start(): Promise<void> {}
  stop(): void {}
  setBoard(_board: Board): void {}

  /** Number of listeners per type (to check `dispose`). */
  readonly listeners = new Map<string, number>();

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) + 1);
    super.addEventListener(type, listener, options);
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    this.listeners.set(type, (this.listeners.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener, options);
  }

  grab(frameId: number, frame: VideoFrame | null): void {
    const e: GrabEvent = Object.assign(new Event('grab'), { frameId, video: this.video, frame });
    this.dispatchEvent(e);
  }

  pose(frameId: number, smoothed: Mat4 | null, intrinsics: CameraIntrinsics): void {
    this.intrinsics = intrinsics;
    const e: PoseEvent = Object.assign(new Event('pose'), {
      frameId,
      timestampMs: frameId * (1000 / 30),
      pose: null,
      smoothed,
      detections: [],
      intrinsics,
      stats: STATS,
      debugFrameIndex: null,
      thumbnail: null,
    });
    this.dispatchEvent(e);
  }
}
