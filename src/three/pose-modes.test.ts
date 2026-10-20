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

  it('falls back to the smoothed (held) pose when a frame has no pose', () => {
    const { tracker, camera, ar } = setup({});
    tracker.grab(1, null);
    tracker.pose(1, pose(10), K, null);
    ar.update();
    expect(camera.position.x).toBeCloseTo(0.01, 12);
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
