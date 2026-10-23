/**
 * Which pose drives the camera (ARCHITECTURE.md §7.1–7.2): the raw pose of the
 * shown frame by default (no filter lag over the frame it was fitted to), the
 * smoothed one on request or when a frame has no pose; and the `'live'`
 * background, where the newest pose is extrapolated to the newest video frame.
 */
import { Euler, PerspectiveCamera, Quaternion, Scene, VideoTexture } from 'three';
import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics, Mat4 } from '../types.js';
import { FakeTracker } from './__tests__/fake-tracker.js';
import { MatarThree, type MatarThreeRenderer } from './matar-three.js';

const K: CameraIntrinsics = { width: 640, height: 480, fx: 500, fy: 500, cx: 319.5, cy: 239.5 };
const DEG = Math.PI / 180;

/** boardFromCamera (column-major, mm): rotation about +Y by `yawDeg`, translation (x, 400, 300). */
function pose(x: number, yawDeg = 0): Mat4 {
  const c = Math.cos(yawDeg * DEG);
  const s = Math.sin(yawDeg * DEG);
  // prettier-ignore
  return new Float64Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, 400, 300, 1]) as Mat4;
}

const renderer: MatarThreeRenderer = {
  domElement: {
    width: 640,
    height: 480,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
  } as unknown as HTMLCanvasElement,
  initTexture: () => {},
};

/** A `<video>` stand-in whose frame callbacks the test fires. */
function fakeVideo() {
  const cbs: ((now: number, meta: { expectedDisplayTime: number }) => void)[] = [];
  return {
    videoWidth: 640,
    videoHeight: 480,
    requestVideoFrameCallback(cb: (now: number, meta: { expectedDisplayTime: number }) => void) {
      cbs.push(cb);
      return cbs.length;
    },
    cancelVideoFrameCallback() {},
    /** presents a frame at `t` ms */
    present(t: number) {
      for (const cb of cbs.splice(0)) cb(t, { expectedDisplayTime: t });
    },
  };
}

function setup(opts: { background?: 'synced' | 'live' | 'none'; pose?: 'raw' | 'smoothed' }) {
  const video = fakeVideo();
  const tracker = new FakeTracker(video as unknown as HTMLVideoElement);
  const camera = new PerspectiveCamera();
  const scene = new Scene();
  const ar = new MatarThree({ tracker, renderer, camera, scene, ...opts });
  return { video, tracker, camera, scene, ar };
}

const yaw = (q: Quaternion) => new Euler().setFromQuaternion(q, 'YXZ').y / DEG;

describe('pose source', () => {
  it('synced: the raw pose of the shown frame by default, the smoothed one on request', () => {
    for (const kind of ['raw', 'smoothed'] as const) {
      const { tracker, camera, ar } = setup(kind === 'raw' ? {} : { pose: 'smoothed' });
      tracker.grab(1, null);
      tracker.pose(1, pose(10), K, pose(25));
      expect(ar.update().tracking).toBe(true);
      expect(camera.position.x).toBeCloseTo(kind === 'raw' ? 0.025 : 0.01, 12);
    }
  });

  it('falls back to the smoothed (held) pose when no frame had a pose yet', () => {
    const { tracker, camera, ar } = setup({});
    tracker.grab(1, null);
    tracker.pose(1, pose(10), K, null);
    ar.update();
    expect(camera.position.x).toBeCloseTo(0.01, 12);
  });

  it('synced: a frame without a pose gets the raw poses extrapolated to its time', () => {
    const { tracker, camera, ar } = setup({});
    // 1 mm and 1° per 33.3 ms frame; the held smoothed pose lags at 0
    for (const [id, raw] of [
      [1, pose(0, 0)],
      [2, pose(1, 1)],
      [3, null],
    ] as const) {
      tracker.grab(id, null);
      tracker.pose(id, pose(0, 0), K, raw);
      ar.update();
    }
    expect(camera.position.x * 1000).toBeCloseTo(2, 6);
    expect(yaw(camera.quaternion)).toBeCloseTo(2, 6);
    expect(camera.position.y).toBeCloseTo(0.4, 12);
    // a longer dropout: at most 3 intervals (and 100 ms) ahead of the last pose
    tracker.grab(9, null);
    tracker.pose(9, pose(0, 0), K, null);
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(4, 6);
  });

  it('synced: a loss clears the velocity even if update() never shows it', () => {
    const { tracker, camera, ar } = setup({});
    const step = (id: number, t: number, smoothed: Mat4 | null, raw: Mat4 | null, show = true) => {
      tracker.grab(id, null);
      tracker.pose(id, smoothed, K, raw, t);
      if (show) ar.update();
    };
    step(1, 0, pose(0), pose(0));
    step(2, 33, pose(10), pose(10));
    step(3, 100, null, null, false); // lost, then overwritten by the next pose
    step(4, 133, pose(100), pose(100));
    step(5, 166, pose(100), null);
    expect(camera.position.x * 1000).toBeCloseTo(100, 6);
  });

  it('synced: a tracker restart (frame IDs going back) clears the velocity', () => {
    const { tracker, camera, ar } = setup({});
    for (const [id, t, raw] of [
      [10, 0, pose(0)],
      [11, 33, pose(10)],
      [1, 66, pose(100)],
      [2, 99, null],
    ] as const) {
      tracker.grab(id, null);
      tracker.pose(id, pose(0), K, raw, t);
      ar.update();
    }
    expect(camera.position.x * 1000).toBeCloseTo(100, 6);
  });

  it('synced: no extrapolation from poses before a loss', () => {
    const { tracker, camera, ar } = setup({});
    for (const [id, smoothed, raw] of [
      [1, pose(0), pose(0)],
      [2, pose(1), pose(1)],
      [3, null, null], // lost
      [4, pose(5), pose(5)],
      [5, pose(5), null],
    ] as const) {
      tracker.grab(id, null);
      tracker.pose(id, smoothed, K, raw);
      ar.update();
    }
    expect(camera.position.x * 1000).toBeCloseTo(5, 6); // held, no velocity across the loss
  });
});

describe('raw pose spikes', () => {
  /** synced frames 1, 2, … each with this raw pose (null: none); the smoothed one is not used */
  function run(raws: (Mat4 | null)[], opts: { pose?: 'raw' | 'smoothed' } = {}) {
    const { tracker, camera, ar } = setup(opts);
    const xs: number[] = [];
    raws.forEach((raw, i) => {
      tracker.grab(i + 1, null);
      tracker.pose(i + 1, opts.pose === 'smoothed' ? raw : pose(0), K, raw);
      ar.update();
      xs.push(Math.round(camera.position.x * 1e6) / 1e3); // mm, 3 decimals
    });
    return { camera, xs };
  }

  it('a raw pose > 20 mm from the extrapolated motion is drawn like a frame without a pose', () => {
    // 1 mm per frame, then a frame whose few blurred tags put the camera 60 mm off
    const { xs } = run([pose(0), pose(1), pose(2), pose(60), pose(4), pose(5)]);
    expect(xs).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('so is one > 5° off, and the spike adds nothing to the velocity', () => {
    const { camera, xs } = run([pose(0, 0), pose(1, 1), pose(2, 12), pose(3, 3), null]);
    expect(xs).toEqual([0, 1, 2, 3, 4]);
    expect(yaw(camera.quaternion)).toBeCloseTo(4, 6);
  });

  it('three in a row: the motion restarts at the third', () => {
    const { xs } = run([pose(0), pose(1), pose(100), pose(100), pose(100), pose(101), null]);
    expect(xs).toEqual([0, 1, 2, 3, 100, 101, 102]);
  });

  it('not where the prediction does not reach: after a dropout, or with one pose', () => {
    // 10 mm per frame (300 mm/s), 5 frames without a pose: extrapolation stops
    // 100 ms after the last pose, the motion doesn't
    const after = run([pose(0), pose(10), null, null, null, null, null, pose(70), pose(80)]);
    expect(after.xs.slice(-2)).toEqual([70, 80]);
    // one pose (no velocity yet): nothing to compare with
    expect(run([pose(0), pose(60)]).xs).toEqual([0, 60]);
    // a spike, a dropout, then the pose beyond reach: the motion restarts there
    const spike = run([pose(0), pose(1), pose(60), null, null, pose(60), pose(61), null]);
    expect(spike.xs).toEqual([0, 1, 2, 3, 4, 60, 61, 62]);
  });

  it('a wrong first or second pose does not set the velocity that judges the next ones', () => {
    // the first pose: the next two set a velocity of −60 mm per frame, the third is near the last one
    expect(run([pose(60), pose(0), pose(0), pose(0), pose(0)]).xs).toEqual([60, 0, 0, 0, 0]);
    // the second: the third is near the first, so the second is dropped from the velocity
    expect(run([pose(0), pose(60), pose(0), pose(0), null]).xs).toEqual([0, 60, 0, 0, 0]);
    // once a pose matched the prediction, a spike near an older pose is still a spike
    const moving = run([pose(0), pose(10), pose(20), pose(-9), pose(40), pose(50), pose(60)]);
    expect(moving.xs).toEqual([0, 10, 20, 30, 40, 50, 60]);
  });

  it('a new orientation or a tracker stop/restart starts a new motion', () => {
    const K2: CameraIntrinsics = { ...K, width: 480, height: 640, cx: 239.5, cy: 319.5 };
    const turned = setup({});
    for (const [id, k, raw] of [
      [1, K, pose(0, 0)],
      [2, K, pose(0, 0)],
      [3, K2, pose(0, 90)], // portrait: the camera frame turned 90°
    ] as const) {
      turned.tracker.grab(id, null);
      turned.tracker.pose(id, pose(0), k, raw);
      turned.ar.update();
    }
    expect(yaw(turned.camera.quaternion)).toBeCloseTo(90, 6);
    // frame IDs keep counting across stop() / start(); the state events mark
    // it. A pose queued before (not shown yet) doesn't carry the old motion over.
    for (const background of ['synced', 'live'] as const) {
      const { video, tracker, camera, ar } = setup({ background });
      const step = (id: number, t: number, raw: Mat4 | null, show = true) => {
        if (background === 'synced') tracker.grab(id, null);
        tracker.pose(id, pose(100), K, raw, t);
        if (background === 'live') video.present(t);
        if (show) ar.update();
      };
      step(1, 0, pose(0));
      step(2, 33, pose(10));
      step(3, 66, pose(20), false);
      for (const [state, previous] of [
        ['stopped', 'running'],
        ['starting', 'stopped'],
        ['running', 'starting'],
      ] as const) {
        tracker.dispatchEvent(Object.assign(new Event('state'), { state, previous }));
      }
      ar.update();
      step(4, 99, pose(100));
      step(5, 132, null);
      expect(camera.position.x * 1000, background).toBeCloseTo(100, 6);
    }
  });

  it('is not applied to the smoothed pose (the filter gates it)', () => {
    const { xs } = run([pose(0), pose(1), pose(60)], { pose: 'smoothed' });
    expect(xs).toEqual([0, 1, 60]);
  });
});

describe("background: 'live'", () => {
  it('shows the video texture and extrapolates the newest pose to the newest frame', () => {
    const { video, tracker, camera, scene, ar } = setup({ background: 'live' });
    ar.update();
    expect(scene.background).toBeInstanceOf(VideoTexture);
    // 1 mm and 1° per 33.3 ms frame
    tracker.pose(1, null, K, pose(0, 0), 0);
    ar.update();
    tracker.pose(2, null, K, pose(1, 1), 100 / 3);
    video.present(50); // the frame on screen is 16.7 ms newer than the last pose
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(1.5, 6);
    expect(yaw(camera.quaternion)).toBeCloseTo(1.5, 6);
    expect(camera.position.y).toBeCloseTo(0.4, 12);
  });

  it('extrapolates at most 100 ms (and 3 pose intervals) ahead', () => {
    const { video, tracker, camera, ar } = setup({ background: 'live' });
    tracker.pose(1, null, K, pose(0, 0), 0);
    ar.update();
    tracker.pose(2, null, K, pose(1, 1), 100 / 3);
    video.present(5000);
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(4, 6); // 1 + 3 × 1
    expect(yaw(camera.quaternion)).toBeCloseTo(4, 6);
  });

  it('a frame without a pose adds nothing to the velocity (the hold pose lags)', () => {
    const { video, tracker, camera, ar } = setup({ background: 'live' });
    tracker.pose(1, pose(0, 0), K, pose(0, 0), 0);
    ar.update();
    tracker.pose(2, pose(0, 0), K, pose(1, 1), 100 / 3);
    ar.update();
    tracker.pose(3, pose(0, 0), K, null, 200 / 3);
    video.present(75);
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(2.25, 6); // 1 mm/frame from the raw poses
    expect(yaw(camera.quaternion)).toBeCloseTo(2.25, 6);
  });

  it('a raw pose taken for a spike adds nothing to the velocity', () => {
    const { video, tracker, camera, ar } = setup({ background: 'live' });
    tracker.pose(1, pose(0), K, pose(0, 0), 0);
    ar.update();
    tracker.pose(2, pose(0), K, pose(1, 1), 100 / 3);
    ar.update();
    tracker.pose(3, pose(0), K, pose(50, 0), 200 / 3);
    video.present(75);
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(2.25, 6); // 1 mm/frame from the first two
    expect(yaw(camera.quaternion)).toBeCloseTo(2.25, 6);
  });

  it('built during a loss hold: the hold pose until a raw one arrives', () => {
    const { video, tracker, camera, ar } = setup({ background: 'live' });
    tracker.pose(1, pose(40), K, null, 0);
    video.present(10);
    expect(ar.update().tracking).toBe(true);
    expect(camera.position.x * 1000).toBeCloseTo(40, 6);
  });

  it('does not extrapolate across a gap or a restart', () => {
    const { video, tracker, camera, ar } = setup({ background: 'live' });
    tracker.pose(1, null, K, pose(0, 0), 0);
    ar.update();
    tracker.pose(2, null, K, pose(50, 0), 1000); // 1 s later: no velocity from that
    video.present(1050);
    ar.update();
    expect(camera.position.x * 1000).toBeCloseTo(50, 6);
  });

  it('dispose removes the video texture', () => {
    const { scene, ar } = setup({ background: 'live' });
    ar.update();
    ar.dispose();
    expect(scene.background).toBeNull();
  });
});
