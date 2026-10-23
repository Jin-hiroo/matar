/**
 * Tracker unit tests with fakes for the camera, the video element, the worker
 * and the frame source (TASKS.md C2, C3). Node has `EventTarget`, `Event` and
 * `MessageEvent`; everything else is faked.
 */
import { describe, expect, it } from 'vitest';
import { FakeMediaDevices, domError } from '../camera/__tests__/fake-media.js';
import type {
  Board,
  BoardPose,
  CameraIntrinsics,
  GrabEvent,
  MainToWorker,
  Mat4,
  PoseEvent,
  StateEvent,
  TrackerErrorEvent,
  WorkerToMain,
} from '../types.js';
import type { WorkerPort } from '../worker/port.js';
import type { FrameSource } from './grab.js';
import { createTracker, type TrackerEnv } from './tracker.js';

const BOARD: Board = {
  family: 'tag36h11',
  tags: [{ id: 0, centerMm: [0, 0], sizeMm: 32, rotationDeg: 0 }],
};
const K: CameraIntrinsics = { width: 640, height: 480, fx: 500, fy: 500, cx: 319.5, cy: 239.5 };

class FakeVideo {
  videoWidth = 640;
  videoHeight = 480;
  srcObject: unknown = null;
  playsInline = false;
  muted = false;
  autoplay = false;
  isConnected = false;
  style: Record<string, string> = {};
  /** media time of the current frame, s */
  mediaTime = 0;
  private cbs = new Map<
    number,
    (now: number, meta: { expectedDisplayTime: number; mediaTime: number }) => void
  >();
  private next = 1;
  setAttribute(): void {}
  play(): Promise<void> {
    return Promise.resolve();
  }
  requestVideoFrameCallback(
    cb: (now: number, meta: { expectedDisplayTime: number; mediaTime: number }) => void,
  ) {
    const h = this.next++;
    this.cbs.set(h, cb);
    return h;
  }
  cancelVideoFrameCallback(h: number): void {
    this.cbs.delete(h);
  }
  /** a new video frame (media time `mediaTime` s) is presented and its callbacks run */
  tick(t: number, mediaTime = t / 1000): void {
    this.mediaTime = mediaTime;
    const cbs = [...this.cbs.values()];
    this.cbs.clear();
    for (const cb of cbs) cb(t, { expectedDisplayTime: t, mediaTime });
  }
}

/** A worker that answers `init` with `ready` and records frames; results are sent by the test. */
class FakePort extends EventTarget implements WorkerPort {
  readonly sent: MainToWorker[] = [];
  terminated = false;
  constructor(
    readonly kind: 'module' | 'inline',
    private readonly behaviour: 'ok' | 'error' | 'silent' = 'ok',
  ) {
    super();
  }
  postMessage(msg: MainToWorker): void {
    this.sent.push(msg);
    if (msg.type === 'init') {
      setTimeout(() => {
        if (this.behaviour === 'ok') this.reply({ type: 'ready' });
        if (this.behaviour === 'error') this.dispatchEvent(new Event('error'));
      }, 0);
    }
  }
  override addEventListener(type: string, fn: (e: Event) => void): void {
    super.addEventListener(type, fn);
  }
  override removeEventListener(type: string, fn: (e: Event) => void): void {
    super.removeEventListener(type, fn);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(msg: WorkerToMain): void {
    this.dispatchEvent(new MessageEvent('message', { data: msg }));
  }
  frames(): Extract<MainToWorker, { type: 'frame' }>[] {
    return this.sent.filter(
      (m): m is Extract<MainToWorker, { type: 'frame' }> => m.type === 'frame',
    );
  }
  /** answers frame `frameId` with a result carrying `pose` */
  result(frameId: number, timestampMs: number, pose: BoardPose | null): void {
    this.reply({
      type: 'result',
      frameId,
      timestampMs,
      width: 640,
      height: 480,
      detections: [],
      pose,
      intrinsics: K,
      focalSource: 'prior',
      timingsMs: { gray: 0, detect: 1, pose: 1, focal: 0, total: 2 },
      frame: { path: 'gray', format: null, codedWidth: 640, codedHeight: 480, rotationDeg: 0 },
    });
  }
}

function grayFrameSource(): FrameSource & { grabs: number } {
  return {
    path: 'canvas',
    grabs: 0,
    grab() {
      this.grabs++;
      return { frame: null, gray: { width: 640, height: 480, data: new ArrayBuffer(640 * 480) } };
    },
    recycle() {},
  };
}

/** `new VideoFrame(video)` stand-in: frames carry the video's current media time. */
function videoFrameSource(video: FakeVideo): FrameSource & { closed: number } {
  return {
    path: 'videoframe',
    closed: 0,
    grab() {
      const close = () => this.closed++;
      const frame = { timestamp: Math.round(video.mediaTime * 1e6), close };
      return { frame: frame as unknown as VideoFrame, gray: null };
    },
    recycle() {},
  };
}

interface Harness {
  env: TrackerEnv;
  video: FakeVideo;
  md: FakeMediaDevices;
  worker: FakePort;
  inline: FakePort;
  setHidden(h: boolean): void;
}

function harness(
  over: Partial<TrackerEnv> = {},
  worker = new FakePort('module'),
  inline = new FakePort('inline'),
): Harness {
  const video = new FakeVideo();
  const md = new FakeMediaDevices([{ deviceId: 'cam0', label: 'camera2 0, facing back' }], 'cam0');
  let hidden = false;
  const listeners: (() => void)[] = [];
  const env: TrackerEnv = {
    mediaDevices: () => md,
    platform: () => 'android',
    isSecureContext: () => true,
    createVideo: () => video as unknown as HTMLVideoElement,
    attachVideo: () => {
      video.isConnected = true;
    },
    removeVideo: () => {
      video.isConnected = false;
    },
    spawnWorker: () => worker,
    inlinePort: () => inline,
    frameSource: grayFrameSource,
    canvasSource: grayFrameSource,
    hidden: () => hidden,
    onVisibilityChange(cb) {
      listeners.push(cb);
      return () => listeners.splice(listeners.indexOf(cb), 1);
    },
    screenAngleDeg: () => 0,
    now: () => 0,
    readyTimeoutMs: 50,
    ...over,
  };
  return {
    env,
    video,
    md,
    worker,
    inline,
    setHidden(h) {
      hidden = h;
      for (const l of [...listeners]) l();
    },
  };
}

function pose(x: number): BoardPose {
  const m = new Float64Array(16) as Mat4;
  m[0] = m[5] = m[10] = m[15] = 1;
  m[12] = x;
  m[13] = 400;
  return { boardFromCamera: m, rmsErrPx: 0.2, usedTagIds: [0], rejectedTagIds: [] };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('tracker', () => {
  it('starts, keeps one frame in flight, and turns results into pose events', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD }, h.env);
    const states: string[] = [];
    tracker.addEventListener('state', (e) => states.push((e as StateEvent).state));
    const grabs: number[] = [];
    tracker.addEventListener('grab', (e) => grabs.push((e as GrabEvent).frameId));
    const poses: PoseEvent[] = [];
    tracker.addEventListener('pose', (e) => poses.push(e as PoseEvent));

    await tracker.start();
    expect(states).toEqual(['starting', 'running']);
    expect(h.video.isConnected).toBe(true);
    expect(h.worker.sent[0]?.type).toBe('init');

    h.video.tick(100);
    h.video.tick(133); // worker busy: dropped, not queued
    expect(h.worker.frames().map((f) => f.frameId)).toEqual([1]);
    expect(grabs).toEqual([1]);

    h.worker.result(1, 100, pose(5));
    expect(poses).toHaveLength(1);
    expect(poses[0]!.pose?.boardFromCamera[12]).toBe(5);
    expect(poses[0]!.smoothed?.[12]).toBeCloseTo(5, 9);
    expect(poses[0]!.stats.worker).toBe('module');
    expect(tracker.intrinsics).toEqual(K);

    h.video.tick(166);
    expect(h.worker.frames().map((f) => f.frameId)).toEqual([1, 2]);
    // the grab event fires before the frame is sent
    expect(grabs).toEqual([1, 2]);
    tracker.stop();
    expect(tracker.state).toBe('stopped');
    expect(h.worker.terminated).toBe(true);
    expect(h.video.isConnected).toBe(false);
    expect(h.md.opened[0]!.stopped).toBe(true);
  });

  it('grabs a frame that came while the worker was busy if the video still shows it', async () => {
    const h = harness();
    const source = videoFrameSource(h.video);
    h.env.frameSource = () => source;
    const tracker = createTracker({ board: BOARD }, h.env);
    const grabs: number[] = [];
    tracker.addEventListener('grab', (e) => grabs.push((e as GrabEvent).frameId));
    await tracker.start();
    const sent = () => h.worker.frames().map((f) => [f.frameId, f.timestampMs]);

    h.video.tick(100);
    h.video.tick(117); // 16.7 ms later, worker busy
    expect(sent()).toEqual([[1, 100]]);
    h.worker.result(1, 100, pose(5));
    expect(sent()).toEqual([
      [1, 100],
      [2, 117],
    ]); // grabbed late, with its own timestamp
    expect(grabs).toEqual([1, 2]);

    // the video moved on before the result: the newer frame's callback grabs it
    h.video.tick(150); // busy with 2
    h.video.mediaTime = 0.183; // presented, callback not run yet
    h.worker.result(2, 117, pose(5));
    expect(sent()).toHaveLength(2);
    expect(source.closed).toBe(1);
    expect(grabs).toEqual([1, 2]);
    h.video.tick(183);
    expect(sent().at(-1)).toEqual([3, 183]);

    // one in flight at a time, still
    h.video.tick(200);
    h.video.tick(217);
    expect(sent()).toHaveLength(3);
    tracker.stop();
  });

  it('holds the smoothed pose through short gaps and drops it after lostAfterMs', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD, smoothing: { lostAfterMs: 300 } }, h.env);
    const smoothed: (number | null)[] = [];
    tracker.addEventListener('pose', (e) => smoothed.push((e as PoseEvent).smoothed?.[12] ?? null));
    await tracker.start();
    let t = 0;
    const step = (p: BoardPose | null) => {
      t += 33;
      h.video.tick(t);
      const id = h.worker.frames().at(-1)!.frameId;
      h.worker.result(id, t, p);
    };
    step(pose(0));
    step(null); // 33 ms gap: held
    for (let i = 0; i < 12; i++) step(null); // > 300 ms: lost
    expect(smoothed[1]).toBe(0);
    expect(smoothed.at(-1)).toBeNull();
    tracker.stop();
  });

  it('pauses when hidden or muted and resumes; re-acquires an ended track', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD }, h.env);
    await tracker.start();
    h.setHidden(true);
    expect(tracker.state).toBe('paused');
    h.video.tick(10);
    expect(h.worker.frames()).toHaveLength(0);
    h.setHidden(false);
    expect(tracker.state).toBe('running');

    const track = h.md.opened[0]!;
    track.mute();
    expect(tracker.state).toBe('paused');
    track.unmute();
    expect(tracker.state).toBe('running');

    // iOS ends the track in the background; coming back re-opens the same device
    h.setHidden(true);
    track.end();
    expect(h.md.opened).toHaveLength(1); // not while hidden
    h.setHidden(false);
    await tick();
    await tick();
    expect(h.md.opened).toHaveLength(2);
    expect(h.md.calls.at(-1)?.video).toMatchObject({ deviceId: { exact: 'cam0' } });
    expect(tracker.state).toBe('running');
    tracker.stop();
  });

  it('falls back to inline when the worker fails, without entering the error state', async () => {
    for (const over of [
      {
        spawnWorker: () => {
          throw new Error('no module workers');
        },
      },
      {},
    ]) {
      const failing = new FakePort('module', 'error');
      const h = harness(over, failing);
      const tracker = createTracker({ board: BOARD }, h.env);
      const errors: string[] = [];
      tracker.addEventListener('error', (e) => errors.push((e as TrackerErrorEvent).code));
      await tracker.start();
      expect(errors).toEqual(['worker-failed']);
      expect(tracker.state).toBe('running');
      h.video.tick(1);
      expect(h.inline.frames()).toHaveLength(1);
      h.inline.result(1, 1, null);
      tracker.stop();
    }
  });

  it('falls back to inline when the worker never says ready', async () => {
    const h = harness({}, new FakePort('module', 'silent'));
    const tracker = createTracker({ board: BOARD }, h.env);
    const errors: string[] = [];
    tracker.addEventListener('error', (e) => errors.push((e as TrackerErrorEvent).code));
    await tracker.start();
    expect(errors).toEqual(['worker-failed']);
    expect(tracker.state).toBe('running');
    tracker.stop();
  });

  it('runs inline when asked, and maps camera errors to codes', async () => {
    const h = harness();
    const inline = createTracker({ board: BOARD, worker: false }, h.env);
    await inline.start();
    expect(h.inline.sent[0]?.type).toBe('init');
    expect(h.worker.sent).toHaveLength(0);
    inline.stop();

    const denied = harness();
    denied.md.fail.push(domError('NotAllowedError'));
    const t = createTracker({ board: BOARD }, denied.env);
    const codes: string[] = [];
    t.addEventListener('error', (e) => codes.push((e as TrackerErrorEvent).code));
    await expect(t.start()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(codes).toEqual(['permission-denied']);
    expect(t.state).toBe('error');

    const insecure = harness({ isSecureContext: () => false });
    const t2 = createTracker({ board: BOARD }, insecure.env);
    await expect(t2.start()).rejects.toMatchObject({ code: 'insecure-context' });
  });

  it('switches to the canvas source when the worker reports an opaque frame', async () => {
    let canvasMade = 0;
    const h = harness({
      canvasSource: () => {
        canvasMade++;
        return grayFrameSource();
      },
    });
    const tracker = createTracker({ board: BOARD }, h.env);
    await tracker.start();
    h.video.tick(1);
    h.worker.reply({ type: 'fallback', frameId: 1, reason: 'opaque-frame' });
    expect(canvasMade).toBe(1);
    h.video.tick(2); // in-flight cleared by the fallback
    expect(h.worker.frames()).toHaveLength(2);
    tracker.stop();
  });

  it('stop() during start: start settles quietly and leaves nothing running', async () => {
    // while waiting for the worker's `ready`
    const h = harness({ readyTimeoutMs: 60_000 }, new FakePort('module', 'silent'));
    const tracker = createTracker({ board: BOARD }, h.env);
    const errors: string[] = [];
    tracker.addEventListener('error', (e) => errors.push((e as TrackerErrorEvent).code));
    const started = tracker.start();
    for (let i = 0; i < 20 && !h.worker.sent.length; i++) await tick();
    expect(h.worker.sent[0]?.type).toBe('init');
    tracker.stop();
    await expect(started).resolves.toBeUndefined();
    expect(tracker.state).toBe('stopped');
    expect(h.worker.terminated).toBe(true);
    expect(h.inline.sent).toEqual([]); // no inline fallback
    expect(errors).toEqual([]);

    // while `video.play()` is pending (stop() clearing srcObject aborts it)
    let spawned = 0;
    const h2 = harness({
      spawnWorker: () => {
        spawned++;
        return new FakePort('module');
      },
    });
    let abort: ((e: unknown) => void) | null = null;
    h2.video.play = () => new Promise<void>((_, reject) => (abort = reject));
    const tracker2 = createTracker({ board: BOARD }, h2.env);
    const errors2: string[] = [];
    tracker2.addEventListener('error', (e) => errors2.push((e as TrackerErrorEvent).code));
    const started2 = tracker2.start();
    for (let i = 0; i < 20 && !abort; i++) await tick();
    expect(abort).not.toBeNull(); // play() is pending
    tracker2.stop();
    abort!(domError('AbortError')); // `!`: checked above
    await expect(started2).resolves.toBeUndefined();
    expect(tracker2.state).toBe('stopped');
    expect(spawned).toBe(0);
    expect(errors2).toEqual([]);
  });

  it('start() from the stopped event restarts cleanly', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD }, h.env);
    await tracker.start();
    let restarted: Promise<void> | null = null;
    const onState = (e: Event) => {
      if ((e as StateEvent).state !== 'stopped') return;
      tracker.removeEventListener('state', onState);
      restarted = tracker.start();
    };
    tracker.addEventListener('state', onState);
    tracker.stop();
    expect(restarted).not.toBeNull();
    await restarted;
    expect(tracker.state).toBe('running');
    expect(h.video.isConnected).toBe(true);
    expect(h.md.opened.map((t) => t.stopped)).toEqual([true, false]);
    tracker.stop();
  });

  it('stop() from a worker-failed listener: no inline fallback starts', async () => {
    const h = harness({}, new FakePort('module', 'error'));
    const tracker = createTracker({ board: BOARD }, h.env);
    tracker.addEventListener('error', () => tracker.stop());
    await tracker.start();
    expect(tracker.state).toBe('stopped');
    expect(h.inline.sent).toEqual([]);
  });

  it('a camera reacquire still pending across stop() and start() leaves the new camera alone', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD }, h.env);
    await tracker.start();
    // the track ends while visible; hold its reopen
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const gum = h.md.getUserMedia.bind(h.md);
    h.md.getUserMedia = (c) => gate.then(() => gum(c));
    h.md.opened[0]!.end();
    await tick();
    tracker.stop();
    h.md.getUserMedia = gum;
    await tracker.start();
    release();
    for (let i = 0; i < 5; i++) await tick();
    // opened: the first camera, the restart's, the stale reopen (stopped at once)
    expect(h.md.opened.map((t) => t.stopped)).toEqual([true, false, true]);
    expect(tracker.state).toBe('running');
    tracker.stop();
    expect(h.md.opened.every((t) => t.stopped)).toBe(true);
  });

  it('stop() from a grab listener: the frame is closed, not sent', async () => {
    const h = harness();
    const source = videoFrameSource(h.video);
    h.env.frameSource = () => source;
    const tracker = createTracker({ board: BOARD }, h.env);
    await tracker.start();
    tracker.addEventListener('grab', () => tracker.stop());
    expect(() => h.video.tick(100)).not.toThrow();
    expect(h.worker.frames()).toEqual([]);
    expect(source.closed).toBe(1);
    expect(tracker.state).toBe('stopped');
  });

  it('setBoard: the result of a frame in flight (solved for the old board) is not published', async () => {
    const h = harness();
    const tracker = createTracker({ board: BOARD }, h.env);
    const poses: PoseEvent[] = [];
    tracker.addEventListener('pose', (e) => poses.push(e as PoseEvent));
    await tracker.start();
    h.video.tick(100);
    tracker.setBoard({ ...BOARD });
    expect(h.worker.sent.at(-1)?.type).toBe('board');
    h.worker.result(1, 100, pose(5));
    expect(poses).toEqual([]);
    h.video.tick(133);
    h.worker.result(2, 133, pose(7));
    expect(poses.map((p) => p.frameId)).toEqual([2]);
    expect(poses[0]!.smoothed?.[12]).toBeCloseTo(7, 9);
    tracker.stop();
  });

  it('passes the board and settings to the worker', async () => {
    const h = harness();
    const tracker = createTracker(
      {
        board: BOARD,
        intrinsics: K,
        fovPriorDeg: 60,
        autoFocal: false,
        debug: true,
        detector: { edgeGamma: 1 },
      },
      h.env,
    );
    await tracker.start();
    expect(h.worker.sent[0]).toEqual({
      type: 'init',
      board: BOARD,
      intrinsics: K,
      options: { fovPriorDeg: 60, autoFocal: false, debug: true, edgeGamma: 1 },
    });
    const b2: Board = { ...BOARD, tags: [] };
    tracker.setBoard(b2);
    expect(h.worker.sent.at(-1)).toEqual({ type: 'board', board: b2 });
    tracker.stop();
  });
});

describe('module hygiene', () => {
  it('importing the browser-facing modules in Node does not touch browser globals', async () => {
    const mods = await Promise.all([
      import('../camera/index.js'),
      import('./index.js'),
      import('../worker/main.js'),
      import('../worker/inline.js'),
      import('../worker/host.js'),
    ]);
    expect(mods).toHaveLength(5);
  });
});
