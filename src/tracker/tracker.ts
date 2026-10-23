/**
 * `createTracker` (ARCHITECTURE.md §6, §8): camera → frames → worker → pose
 * events, on the main thread.
 *
 * - `start()` opens the camera with lens pinning (src/camera), plays the
 *   `<video>`, starts the worker (or the inline path) and the frame loop.
 * - Frame loop: `requestVideoFrameCallback`; a frame is grabbed only when none
 *   is in flight (late frames are dropped, never queued). For each grab the
 *   `grab` event fires synchronously, then the frame is transferred (§6.2, §7.2).
 *   A frame that came while one was in flight is grabbed when the result comes
 *   back if it is still the video's current frame (`VideoFrame.timestamp` =
 *   its callback's `mediaTime`; `videoframe` path only), else dropped.
 * - Each `result` becomes a `pose` event: the raw pose, the smoothed one
 *   (`createPoseFilter`, with the loss hold, §5.6), detections, intrinsics and
 *   stats.
 * - Lifecycle (§6.4): hidden page or muted track → `paused`; visible and
 *   unmuted → `running`, re-acquiring the camera if the track ended meanwhile.
 * - `camera.maxExposureMs` (§6.1): `EXPOSURE_SETTLE_MS` after each camera
 *   opens (start or reacquire), `shortenExposure` (src/camera/exposure.ts);
 *   its outcome is `stats.camera.exposure`.
 * - Worker failure (constructor throws, `error` before `ready`, or no `ready`
 *   in time) → `worker-failed` error event and the inline path; the state
 *   doesn't change.
 *
 * Everything browser-specific comes from a `TrackerEnv` (`browserEnv()` by
 * default), so the tracker runs in unit tests with fakes. No browser globals at
 * module top level.
 */
import {
  checkCameraEnvironment,
  MatarError,
  openCamera,
  shortenExposure,
  reopenCamera,
  stopStream,
  toCameraError,
  type MediaDevicesLike,
  type OpenedCamera,
} from '../camera/index.js';
import { currentPlatform, type Platform } from '../camera/platform.js';
import { createPoseFilter } from '../pose/index.js';
import type {
  Board,
  CameraExposure,
  CameraIntrinsics,
  FocalSource,
  FrameInfo,
  GrabEvent,
  IntrinsicsEvent,
  MainToWorker,
  PoseEvent,
  PoseFilter,
  StateEvent,
  Tracker,
  TrackerErrorCode,
  TrackerErrorEvent,
  TrackerOptions,
  TrackerState,
  TrackerStats,
  WorkerOptions,
  WorkerToMain,
} from '../types.js';
import { createInlinePort } from '../worker/inline.js';
import { workerPort, type WorkerPort } from '../worker/port.js';
import { canvasFrameSource, defaultFrameSource, type FrameSource } from './grab.js';

/** Everything the tracker takes from the browser (injected in tests). */
export interface TrackerEnv {
  mediaDevices(): MediaDevicesLike | undefined;
  platform(): Platform;
  isSecureContext(): boolean | undefined;
  /** a playsinline, muted video for the tracker to own (not yet in the DOM) */
  createVideo(): HTMLVideoElement;
  /** keeps an owned video in the DOM while running (1 × 1 px, opacity 0) */
  attachVideo(video: HTMLVideoElement): void;
  removeVideo(video: HTMLVideoElement): void;
  /** the bundled module worker; may throw */
  spawnWorker(): WorkerPort;
  inlinePort(): WorkerPort;
  frameSource(): FrameSource;
  canvasSource(): FrameSource;
  hidden(): boolean;
  onVisibilityChange(cb: () => void): () => void;
  screenAngleDeg(): number;
  now(): number;
  /** resolves after `ms` */
  sleep(ms: number): Promise<void>;
  /** how long to wait for the worker's `ready`, ms */
  readyTimeoutMs: number;
}

export function browserEnv(): TrackerEnv {
  return {
    mediaDevices: () => (typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined),
    platform: currentPlatform,
    isSecureContext: () =>
      typeof globalThis.isSecureContext === 'boolean' ? globalThis.isSecureContext : undefined,
    createVideo() {
      const v = document.createElement('video');
      prepareVideo(v);
      Object.assign(v.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '1px',
        height: '1px',
        opacity: '0',
        pointerEvents: 'none',
      });
      return v;
    },
    attachVideo: (v) => {
      if (!v.isConnected) document.body.appendChild(v);
    },
    removeVideo: (v) => v.remove(),
    spawnWorker: () =>
      workerPort(new Worker(new URL('../worker/main.js', import.meta.url), { type: 'module' })),
    inlinePort: createInlinePort,
    frameSource: defaultFrameSource,
    canvasSource: canvasFrameSource,
    hidden: () => typeof document !== 'undefined' && document.visibilityState === 'hidden',
    onVisibilityChange(cb) {
      document.addEventListener('visibilitychange', cb);
      return () => document.removeEventListener('visibilitychange', cb);
    },
    screenAngleDeg: () =>
      typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0,
    now: () => performance.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readyTimeoutMs: 10_000,
  };
}

function prepareVideo(v: HTMLVideoElement): void {
  v.playsInline = true;
  v.muted = true;
  v.autoplay = true;
  v.setAttribute('playsinline', '');
  v.setAttribute('muted', '');
}

/** Creates a tracker; `start()` (from a user gesture) opens the camera. */
export function createTracker(opts: TrackerOptions, env: TrackerEnv = browserEnv()): Tracker {
  return new TrackerImpl(opts, env);
}

type ResultMsg = Extract<WorkerToMain, { type: 'result' }>;

/** `camera.maxExposureMs`: let the automatic exposure settle this long after the camera opens, ms */
export const EXPOSURE_SETTLE_MS = 1000;
/** …then read the settings back this long after setting the exposure, ms */
export const EXPOSURE_CONFIRM_MS = 500;

const EXPOSURE_OFF: CameraExposure = Object.freeze({ state: 'off', timeMs: null, iso: null });
const EXPOSURE_PENDING: CameraExposure = Object.freeze({
  state: 'pending',
  timeMs: null,
  iso: null,
});

const EMPTY_FRAME: FrameInfo = {
  path: 'videoframe',
  format: null,
  codedWidth: 0,
  codedHeight: 0,
  rotationDeg: 0,
};

class TrackerImpl extends EventTarget implements Tracker {
  readonly video: HTMLVideoElement;
  private readonly ownsVideo: boolean;
  private _state: TrackerState = 'idle';
  private _intrinsics: CameraIntrinsics | null = null;
  private board: Board;
  private camera: OpenedCamera | null = null;
  private exposure: CameraExposure = EXPOSURE_OFF;
  private port: WorkerPort | null = null;
  private ownsPort = false;
  private source: FrameSource;
  private readonly filter: PoseFilter | null;
  private frameId = 0;
  private inFlight: number | null = null;
  /** results of frames up to this ID were computed for the board before `setBoard` */
  private staleUpTo = 0;
  /** bumped by `start` and `stop`: a `start` whose generation is gone stops at its next await */
  private startGen = 0;
  private loopActive = false;
  private rvfcHandle: number | null = null;
  private rafHandle: number | null = null;
  private lastVideoTime = -1;
  /** the newest frame that came while one was in flight, for a late grab */
  private missed: { timestampMs: number; mediaTime: number } | null = null;
  private hiddenNow = false;
  private muted = false;
  private reacquiring: Promise<void> | null = null;
  private cleanups: (() => void)[] = [];
  private trackCleanups: (() => void)[] = [];
  private lastResultMs: number | null = null;
  private fps = 0;
  private focal: { stdDevPct: number | null; source: FocalSource } = {
    stdDevPct: null,
    source: 'prior',
  };

  constructor(
    private readonly opts: TrackerOptions,
    private readonly env: TrackerEnv,
  ) {
    super();
    this.board = opts.board;
    if (opts.video) {
      this.video = opts.video;
      prepareVideo(this.video);
      this.ownsVideo = false;
    } else {
      this.video = env.createVideo();
      this.ownsVideo = true;
    }
    this.source = env.frameSource();
    this.filter = opts.smoothing === false ? null : createPoseFilter(opts.smoothing ?? {});
  }

  get state(): TrackerState {
    return this._state;
  }

  get intrinsics(): CameraIntrinsics | null {
    return this._intrinsics;
  }

  async start(): Promise<void> {
    if (this._state === 'starting' || this._state === 'running' || this._state === 'paused') {
      return;
    }
    this.setState('starting');
    const gen = ++this.startGen;
    if (this.ownsVideo) this.env.attachVideo(this.video);
    try {
      const md = this.env.mediaDevices();
      const envError = checkCameraEnvironment({
        isSecureContext: this.env.isSecureContext(),
        hasGetUserMedia: typeof md?.getUserMedia === 'function',
      });
      if (envError || !md) throw new MatarError(envError ?? 'no-camera-api');
      const { width, height, frameRate, deviceId } = this.opts.camera ?? {};
      const request = { width, height, frameRate, deviceId }; // what getUserMedia takes
      const camera = await openCamera(md, this.env.platform(), request);
      if (!this.live(gen)) return stopStream(camera.stream);
      this.camera = camera;
      await this.attachStream();
      if (!this.live(gen)) return;
      void this.applyExposure(camera, gen);
      await this.startPort(gen);
      if (!this.live(gen)) return;
      this.hiddenNow = this.env.hidden();
      this.cleanups.push(this.env.onVisibilityChange(() => this.onVisibility()));
      this.setState(this.hiddenNow ? 'paused' : 'running');
      this.startLoop();
    } catch (e) {
      // stopped meanwhile (e.g. `play()` aborted by stop() clearing srcObject): not an error
      if (!this.live(gen)) return;
      const err = toCameraError(e);
      this.releaseCamera();
      this.emitError(err.code, err.message, e);
      this.setState('error');
      throw err;
    }
  }

  /** true while the `start` of generation `gen` is the current one and not stopped */
  private live(gen: number): boolean {
    return gen === this.startGen && !this.stopped();
  }

  stop(): void {
    if (this._state === 'stopped' || this._state === 'idle') {
      this.setState('stopped');
      return;
    }
    // tear down first, then tell listeners: one that calls start() from the
    // 'stopped' event gets a clean tracker and a fresh generation
    const previous = this._state;
    this._state = 'stopped';
    this.startGen++;
    this.stopLoop();
    this.releaseCamera();
    for (const c of this.cleanups.splice(0)) c();
    if (this.port) {
      this.port.postMessage({ type: 'dispose' });
      if (this.ownsPort) this.port.terminate();
      this.port = null;
    }
    this.inFlight = null;
    this.filter?.reset();
    if (this.ownsVideo) this.env.removeVideo(this.video);
    this.emitState('stopped', previous);
  }

  setBoard(board: Board): void {
    this.board = board;
    this.filter?.reset();
    this.staleUpTo = this.frameId; // a frame in flight is solved for the old board
    this.port?.postMessage({ type: 'board', board });
  }

  // ---------------------------------------------------------------------------
  // camera

  private async attachStream(): Promise<void> {
    const cam = this.camera;
    if (!cam) return;
    for (const c of this.trackCleanups.splice(0)) c();
    const track = cam.track;
    const on = (type: string, fn: () => void) => {
      track.addEventListener(type, fn);
      this.trackCleanups.push(() => track.removeEventListener(type, fn));
    };
    on('mute', () => {
      this.muted = true;
      this.updatePause();
    });
    on('unmute', () => {
      this.muted = false;
      this.updatePause();
    });
    on('ended', () => {
      if (!this.hiddenNow && !this.stopped()) void this.reacquire();
    });
    this.muted = false;
    this.video.srcObject = cam.stream;
    await this.video.play();
  }

  private releaseCamera(): void {
    for (const c of this.trackCleanups.splice(0)) c();
    if (this.camera) stopStream(this.camera.stream);
    this.camera = null;
    this.exposure = EXPOSURE_OFF;
    this.video.srcObject = null;
  }

  /** `camera.maxExposureMs` on a newly opened camera (§6.1); never throws. */
  private async applyExposure(camera: OpenedCamera, gen: number): Promise<void> {
    const maxMs = this.opts.camera?.maxExposureMs;
    if (maxMs === undefined || !(maxMs > 0) || !Number.isFinite(maxMs)) return;
    // the tracker's camera, still live (reacquire stops the old track before
    // replacing it; stop() releases it)
    const current = () =>
      this.live(gen) && this.camera === camera && camera.track.readyState === 'live';
    if (!current()) return;
    this.exposure = EXPOSURE_PENDING;
    try {
      await this.env.sleep(EXPOSURE_SETTLE_MS);
      if (!current()) return;
      const wait = () => this.env.sleep(EXPOSURE_CONFIRM_MS);
      const result = await shortenExposure(camera.track, maxMs, wait, current);
      if (result && current()) this.exposure = Object.freeze(result);
    } catch {
      // only the settle wait can throw here; nothing was applied
      if (current()) this.exposure = EXPOSURE_OFF;
    }
  }

  private reacquire(): Promise<void> {
    if (this.reacquiring) return this.reacquiring;
    const prev = this.camera;
    const md = this.env.mediaDevices();
    if (!prev || !md) return Promise.resolve();
    const gen = this.startGen;
    this.reacquiring = (async () => {
      try {
        stopStream(prev.stream);
        const camera = await reopenCamera(md, prev);
        // stopped (and maybe restarted with its own camera) meanwhile
        if (!this.live(gen)) return stopStream(camera.stream);
        this.camera = camera;
        await this.attachStream();
        if (!this.live(gen)) return;
        void this.applyExposure(camera, gen);
        this.filter?.reset();
        this.updatePause();
      } catch (e) {
        if (!this.live(gen)) return;
        const err = toCameraError(e);
        this.emitError(err.code, err.message, e);
        this.setState('error');
      } finally {
        this.reacquiring = null;
      }
    })();
    return this.reacquiring;
  }

  private onVisibility(): void {
    this.hiddenNow = this.env.hidden();
    if (!this.hiddenNow && this.camera?.track.readyState === 'ended') {
      void this.reacquire();
      return;
    }
    this.updatePause();
  }

  private updatePause(): void {
    if (this._state !== 'running' && this._state !== 'paused') return;
    const pause = this.hiddenNow || this.muted;
    this.setState(pause ? 'paused' : 'running');
  }

  // ---------------------------------------------------------------------------
  // worker

  private async startPort(gen: number): Promise<void> {
    if (this.port) return;
    if (this.opts.worker === false) {
      await this.connect(this.env.inlinePort(), true);
      return;
    }
    let port: WorkerPort | null = null;
    try {
      port = this.opts.worker ? workerPort(this.opts.worker) : this.env.spawnWorker();
      await this.connect(port, !this.opts.worker);
    } catch (e) {
      if (port && this.port === port) this.port = null;
      if (port && !this.opts.worker) port.terminate();
      if (!this.live(gen)) return;
      this.emitError('worker-failed', 'the tracking worker failed to start; running inline', e);
      if (!this.live(gen)) return; // an error listener stopped the tracker
      await this.connect(this.env.inlinePort(), true);
    }
  }

  /** Attaches listeners, sends `init` and waits for `ready` (rejects on error/timeout). */
  private connect(port: WorkerPort, owns: boolean): Promise<void> {
    this.port = port;
    this.ownsPort = owns;
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        if (!ready) fail(new Error('no ready from the worker'));
      }, this.env.readyTimeoutMs);
      const fail = (e: unknown) => {
        clearTimeout(timer);
        port.removeEventListener('message', onMessage);
        port.removeEventListener('error', onError);
        reject(e instanceof Error ? e : new Error('worker error'));
      };
      const onError = (e: Event) => {
        if (!ready) {
          fail(e);
          return;
        }
        // the worker died after starting: continue inline
        port.removeEventListener('message', onMessage);
        port.removeEventListener('error', onError);
        if (this.port !== port) return;
        this.port = null;
        this.inFlight = null;
        if (this.ownsPort) port.terminate();
        this.emitError('worker-failed', 'the tracking worker stopped; running inline', e);
        if (this.stopped()) return; // an error listener stopped the tracker
        void this.connect(this.env.inlinePort(), true).catch((err: unknown) =>
          this.emitError('worker-failed', 'the inline processor failed', err),
        );
      };
      const onMessage = (e: Event) => {
        const msg = (e as MessageEvent<WorkerToMain>).data;
        if (msg.type === 'ready') {
          ready = true;
          clearTimeout(timer);
          resolve();
          return;
        }
        this.onWorkerMessage(msg);
      };
      port.addEventListener('message', onMessage);
      port.addEventListener('error', onError);
      this.cleanups.push(() => {
        clearTimeout(timer);
        port.removeEventListener('message', onMessage);
        port.removeEventListener('error', onError);
        if (!ready) resolve(); // stopped while waiting: `start` sees it and returns
      });
      port.postMessage({
        type: 'init',
        board: this.board,
        intrinsics: this.opts.intrinsics ?? null,
        options: this.workerOptions(),
      });
    });
  }

  private workerOptions(): WorkerOptions {
    const o: WorkerOptions = {
      fovPriorDeg: this.opts.fovPriorDeg ?? 68,
      autoFocal: this.opts.autoFocal ?? true,
      debug: this.opts.debug ?? false,
    };
    const d = this.opts.detector;
    if (d?.decimate !== undefined) o.decimate = d.decimate;
    if (d?.maxCorrectedBits !== undefined) o.maxCorrectedBits = d.maxCorrectedBits;
    if (d?.minContrast !== undefined) o.minContrast = d.minContrast;
    if (d?.edgeGamma !== undefined) o.edgeGamma = d.edgeGamma;
    return o;
  }

  private onWorkerMessage(msg: WorkerToMain): void {
    switch (msg.type) {
      case 'result':
        if (msg.frameId === this.inFlight) this.inFlight = null;
        if (msg.returned) this.source.recycle(msg.returned);
        if (msg.frameId > this.staleUpTo) this.onResult(msg);
        this.grabMissed();
        return;
      case 'intrinsics':
        this._intrinsics = msg.intrinsics;
        this.focal = { stdDevPct: msg.stdDevPct, source: msg.source };
        this.dispatchEvent(
          Object.assign(new Event('intrinsics'), {
            intrinsics: msg.intrinsics,
            source: msg.source,
            stdDevPct: msg.stdDevPct,
          }) as IntrinsicsEvent,
        );
        return;
      case 'fallback':
        if (msg.frameId === this.inFlight) this.inFlight = null;
        this.source = this.env.canvasSource();
        return;
      case 'error':
        if (msg.frameId !== undefined && msg.frameId === this.inFlight) this.inFlight = null;
        this.emitError(msg.code, msg.message);
        return;
      case 'ready':
        return;
    }
  }

  private onResult(msg: ResultMsg): void {
    if (this.stopped()) return;
    const t = msg.timestampMs;
    if (this.lastResultMs !== null && t > this.lastResultMs) {
      const inst = 1000 / (t - this.lastResultMs);
      this.fps = this.fps ? this.fps + 0.1 * (inst - this.fps) : inst;
    }
    this.lastResultMs = t;
    const prevK = this._intrinsics;
    this._intrinsics = msg.intrinsics;
    if (msg.focalSource !== 'estimated') this.focal = { stdDevPct: null, source: msg.focalSource };
    if (prevK && (prevK.width !== msg.intrinsics.width || prevK.height !== msg.intrinsics.height)) {
      this.filter?.reset(); // new orientation: the old pose isn't comparable
    }
    const smoothed = this.filter
      ? this.filter.update(msg.pose?.boardFromCamera ?? null, t)
      : (msg.pose?.boardFromCamera ?? null);
    const cam = this.camera;
    const stats: TrackerStats = {
      fps: this.fps,
      workerMs: msg.timingsMs.total,
      timingsMs: msg.timingsMs,
      camera: {
        label: cam?.label ?? '',
        lens: cam?.lens ?? 'unknown',
        devices: cam?.devices.map((d) => d.label) ?? [],
        exposure: this.exposure,
      },
      focal: { fx: msg.intrinsics.fx, source: this.focal.source, stdDevPct: this.focal.stdDevPct },
      worker: this.port?.kind ?? 'inline',
      frame: msg.frame ?? EMPTY_FRAME,
    };
    const thumb = msg.thumbnail;
    const event = Object.assign(new Event('pose'), {
      frameId: msg.frameId,
      timestampMs: t,
      pose: msg.pose,
      smoothed,
      detections: msg.detections,
      intrinsics: msg.intrinsics,
      stats,
      debugFrameIndex: msg.debugFrameIndex ?? null,
      thumbnail: thumb
        ? { width: thumb.width, height: thumb.height, data: new Uint8Array(thumb.data) }
        : null,
    }) as PoseEvent;
    this.dispatchEvent(event);
  }

  // ---------------------------------------------------------------------------
  // frame loop

  private startLoop(): void {
    if (this.loopActive) return;
    this.loopActive = true;
    this.scheduleNext();
  }

  private stopLoop(): void {
    this.loopActive = false;
    const v = this.video as HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void };
    if (this.rvfcHandle !== null) v.cancelVideoFrameCallback?.(this.rvfcHandle);
    if (this.rafHandle !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rvfcHandle = this.rafHandle = null;
    this.missed = null;
  }

  private scheduleNext(): void {
    if (!this.loopActive) return;
    const v = this.video;
    if (typeof v.requestVideoFrameCallback === 'function') {
      this.rvfcHandle = v.requestVideoFrameCallback((now, meta) => {
        this.rvfcHandle = null;
        this.onVideoFrame(meta.expectedDisplayTime || now, meta.mediaTime);
        this.scheduleNext();
      });
    } else {
      // no rVFC (old browsers): poll on animation frames for a new video time
      this.rafHandle = requestAnimationFrame((now) => {
        this.rafHandle = null;
        if (v.currentTime !== this.lastVideoTime) {
          this.lastVideoTime = v.currentTime;
          this.onVideoFrame(now);
        }
        this.scheduleNext();
      });
    }
  }

  private onVideoFrame(timestampMs: number, mediaTime?: number): void {
    if (this._state !== 'running' || !this.port) return;
    if (this.inFlight !== null) {
      this.missed =
        mediaTime !== undefined && this.source.path === 'videoframe'
          ? { timestampMs, mediaTime }
          : null;
      return;
    }
    this.missed = null;
    this.sendFrame(timestampMs, null);
  }

  /**
   * After a result: grabs the frame that came while the worker was busy, if
   * the video still shows it. Frames 16.7 ms apart (camera frames presented on
   * a 60 Hz display) otherwise lose every frame that follows a short interval
   * whenever the worker takes longer than that.
   */
  private grabMissed(): void {
    const m = this.missed;
    this.missed = null;
    if (!m || this._state !== 'running' || this.inFlight !== null || !this.port) return;
    this.sendFrame(m.timestampMs, m.mediaTime);
  }

  /** `expectMediaTime` (s): send only if the grabbed frame is that one. */
  private sendFrame(timestampMs: number, expectMediaTime: number | null): void {
    const port = this.port;
    if (!port) return;
    const source = this.source;
    const grabbed = source.grab(this.video);
    if (!grabbed) return;
    const drop = () => {
      grabbed.frame?.close();
      if (grabbed.gray) source.recycle(grabbed.gray.data);
    };
    if (
      expectMediaTime !== null &&
      (!grabbed.frame || Math.abs(grabbed.frame.timestamp - expectMediaTime * 1e6) > 500)
    ) {
      // a newer frame is current (its callback is on the way), or this
      // browser's timestamps don't match: drop it as before
      drop();
      return;
    }
    const frameId = ++this.frameId;
    this.dispatchEvent(
      Object.assign(new Event('grab'), {
        frameId,
        video: this.video,
        frame: grabbed.frame,
      }) as GrabEvent,
    );
    // a `grab` listener may have stopped or paused the tracker
    if (this.port !== port || this._state !== 'running') {
      drop();
      return;
    }
    const base = {
      type: 'frame' as const,
      frameId,
      timestampMs,
      displayWidth: this.video.videoWidth,
      displayHeight: this.video.videoHeight,
      screenAngleDeg: this.env.screenAngleDeg(),
    };
    let msg: MainToWorker;
    let transfer: Transferable[];
    if (grabbed.frame) {
      msg = { ...base, videoFrame: grabbed.frame };
      transfer = [grabbed.frame];
    } else if (grabbed.gray) {
      msg = { ...base, gray: grabbed.gray };
      transfer = [grabbed.gray.data];
    } else {
      return;
    }
    this.inFlight = frameId;
    port.postMessage(msg, port.kind === 'module' ? transfer : []);
  }

  // ---------------------------------------------------------------------------
  // events

  private stopped(): boolean {
    return this._state === 'stopped';
  }

  private setState(state: TrackerState): void {
    const previous = this._state;
    if (previous === state) return;
    this._state = state;
    this.emitState(state, previous);
  }

  private emitState(state: TrackerState, previous: TrackerState): void {
    this.dispatchEvent(Object.assign(new Event('state'), { state, previous }) as StateEvent);
  }

  private emitError(code: TrackerErrorCode, message: string, cause?: unknown): void {
    const fields: { code: TrackerErrorCode; message: string; cause?: unknown } = { code, message };
    if (cause !== undefined) fields.cause = cause;
    this.dispatchEvent(Object.assign(new Event('error'), fields) as TrackerErrorEvent);
  }
}
