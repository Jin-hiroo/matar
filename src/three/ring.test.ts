/**
 * T3-2 texture ring (ARCHITECTURE.md §7.2) with a fake renderer: the fake's
 * `initTexture` snapshots what each texture holds "on the GPU" at upload time
 * (frame N's VideoFrame, or the `<video>` showing frame N), so the tests check
 * what would be drawn, not just `texture.image`.
 *
 * Invariant (checked after every event, since a `grab` can come between
 * `update()` and `render()`): the background shows the pixels of the frame
 * whose pose is applied. The oracle reads which frames are still intact from
 * the fake's uploads, so it doesn't depend on the slot policy.
 */
import {
  Color,
  LinearFilter,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  VideoFrameTexture,
  type Texture,
} from 'three';
import { describe, expect, it } from 'vitest';
import { intrinsicsFromFov, randomViewPose } from '../synth/camera.js';
import { mulberry32 } from '../synth/random.js';
import type { Mat4 } from '../types.js';
import { FakeTracker } from './__tests__/fake-tracker.js';
import { MatarThree, type MatarThreeOptions } from './matar-three.js';
import { mmToM } from './units.js';

const SEED = 2718;
const K = intrinsicsFromFov(640, 480, 60);

/** A fake `<video>` that knows which frame it shows, and fake VideoFrames. */
interface FakeVideo {
  showing: number;
}
interface FakeFrame {
  frameId: number;
}

function setup(opts: Partial<MatarThreeOptions> = {}) {
  const video: FakeVideo = { showing: -1 };
  const uploads = new Map<Texture, string>();
  const textures = new Set<Texture>();
  const renderer = {
    domElement: {
      width: 390,
      height: 844,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 844 }),
    } as unknown as HTMLCanvasElement,
    initTexture(tex: Texture) {
      const img = tex.image as unknown;
      uploads.set(
        tex,
        img === video ? `video:${video.showing}` : `frame:${(img as FakeFrame).frameId}`,
      );
      textures.add(tex);
    },
  };
  const tracker = new FakeTracker(video as unknown as HTMLVideoElement);
  const camera = new PerspectiveCamera();
  const scene = new Scene();
  const ar = new MatarThree({ tracker, renderer, camera, scene, ...opts });
  const poses = new Map<number, Mat4>();
  const rng = mulberry32(SEED);
  const poseOf = (id: number): Mat4 => {
    let p = poses.get(id);
    if (!p) {
      p = randomViewPose(rng, { distanceMm: [200, 800], tiltDeg: [0, 60], rollDeg: [0, 360] });
      poses.set(id, p);
    }
    return p;
  };
  return {
    video,
    uploads,
    textures,
    tracker,
    camera,
    scene,
    ar,
    poseOf,
    /** frame `id` reaches the video and is grabbed (`withFrame`: a VideoFrame too) */
    grab(id: number, withFrame = true) {
      video.showing = id;
      tracker.grab(id, withFrame ? ({ frameId: id } as unknown as VideoFrame) : null);
    },
    pose(id: number, lost = false) {
      tracker.pose(id, lost ? null : poseOf(id), K);
    },
    /** what the background shows on the GPU, e.g. `frame:3` */
    shown(): string | undefined {
      const bg = scene.background;
      return bg && (bg as Texture).isTexture ? uploads.get(bg as Texture) : undefined;
    },
  };
}

type Setup = ReturnType<typeof setup>;

/** camera.matrixWorld equals the pose of frame `id` (mm → m). */
function expectCameraAt(s: Setup, id: number): void {
  const want = s.poseOf(id);
  const e: readonly number[] = s.camera.matrixWorld.elements;
  for (let i = 0; i < 16; i++) {
    const w = (want[i] as number) * (i >= 12 && i < 15 ? mmToM : 1);
    expect(Math.abs((e[i] as number) - w)).toBeLessThan(1e-12);
  }
}

describe('MatarThree texture ring (T3-2)', () => {
  it('configures 3 VideoFrameTextures and shows the frame of the applied pose', () => {
    const s = setup();
    s.grab(0);
    s.pose(0);
    expect(s.ar.update()).toEqual({ tracking: true, frameId: 0 });
    const bg = s.scene.background as VideoFrameTexture;
    expect(bg).toBeInstanceOf(VideoFrameTexture);
    expect(bg.colorSpace).toBe(SRGBColorSpace);
    expect(bg.generateMipmaps).toBe(false);
    expect(bg.minFilter).toBe(LinearFilter);
    expect(bg.magFilter).toBe(LinearFilter);
    expect(s.shown()).toBe('frame:0');
    expectCameraAt(s, 0);
    for (let i = 1; i < 6; i++) {
      s.grab(i);
      s.pose(i);
      s.ar.update();
    }
    expect(s.textures.size).toBe(3);
  });

  it('sets repeat/offset for the cover crop', () => {
    const s = setup();
    s.grab(0);
    s.pose(0);
    s.ar.update();
    const bg = s.scene.background as Texture;
    const sc = Math.max(390 / 640, 844 / 480);
    const rx = 390 / (sc * 640);
    expect(bg.repeat.x).toBeCloseTo(rx, 12);
    expect(bg.repeat.y).toBeCloseTo(1, 12);
    expect(bg.offset.x).toBeCloseTo((1 - rx) / 2, 12);
    expect(bg.offset.y).toBeCloseTo(0, 12);
  });

  it('keeps showing frame N until pose N + 1 arrives, even though the video moved on', () => {
    const s = setup({ textureSource: 'video' });
    s.grab(0);
    s.pose(0);
    s.ar.update();
    expect(s.shown()).toBe('video:0');
    s.grab(1); // the <video> now shows frame 1
    expect(s.ar.update()).toEqual({ tracking: true, frameId: 0 });
    expect(s.shown()).toBe('video:0');
    expectCameraAt(s, 0);
    s.pose(1);
    expect(s.ar.update().frameId).toBe(1);
    expect(s.shown()).toBe('video:1');
    expectCameraAt(s, 1);
  });

  it('skips late (out-of-order) poses and poses whose texture was overwritten', () => {
    const s = setup();
    s.grab(0);
    s.pose(0);
    s.ar.update();
    s.grab(1); // pose 1 dropped
    s.grab(2);
    s.pose(2);
    expect(s.ar.update().frameId).toBe(2);
    s.pose(1); // late: older than the frame on screen
    expect(s.ar.update().frameId).toBe(2);
    expect(s.shown()).toBe('frame:2');
    s.grab(3);
    s.grab(4);
    s.grab(5); // overwrites frame 3 (frame 2 is on screen)
    s.pose(3); // its texture is gone: skipped
    expect(s.ar.update().frameId).toBe(2);
    expect(s.shown()).toBe('frame:2');
    expectCameraAt(s, 2);
    s.pose(5);
    expect(s.ar.update().frameId).toBe(5);
    s.pose(4); // still in the ring but older than the frame on screen
    expect(s.ar.update().frameId).toBe(5);
    expect(s.shown()).toBe('frame:5');
    s.pose(77); // never grabbed
    expect(s.ar.update().frameId).toBe(5);
  });

  it('uploads the <video> when the grab has no VideoFrame (canvas path)', () => {
    const s = setup();
    s.grab(0, false);
    s.pose(0);
    s.ar.update();
    expect(s.shown()).toBe('video:0');
  });

  it('tracking follows smoothed; the background still advances while lost', () => {
    const s = setup();
    s.grab(0);
    s.pose(0);
    s.ar.update();
    s.grab(1);
    s.pose(1, true);
    expect(s.ar.update()).toEqual({ tracking: false, frameId: 1 });
    expect(s.shown()).toBe('frame:1');
    expectCameraAt(s, 0);
  });

  it('survives a frame-ID reset (tracker restart)', () => {
    const s = setup();
    for (let i = 10; i < 13; i++) {
      s.grab(i);
      s.pose(i);
      s.ar.update();
    }
    s.grab(0);
    s.pose(0);
    expect(s.ar.update().frameId).toBe(0);
    expect(s.shown()).toBe('frame:0');
  });

  for (const source of ['frame', 'video'] as const) {
    it(`one frame in flight: every pose is shown with its own frame (${source})`, () => {
      const s = setup({ textureSource: source });
      const rng = mulberry32(SEED + 1);
      let id = 0;
      for (let n = 0; n < 1000; n++) {
        id += rng() < 0.2 ? 2 : 1; // frames the tracker didn't grab
        s.grab(id);
        for (let u = Math.floor(rng() * 3); u > 0; u--) s.ar.update();
        if (rng() < 0.1) continue; // no result for this frame
        s.pose(id, rng() < 0.1);
        const updates = Math.floor(rng() * 3);
        for (let u = 0; u < updates; u++) {
          expect(s.ar.update().frameId).toBe(id);
          expect(s.shown()).toBe(`${source}:${id}`);
        }
      }
    });
  }

  it('random event orders: the shown texture always matches the applied pose', () => {
    const rng = mulberry32(SEED + 2);
    for (let run = 0; run < 20; run++) {
      const s = setup();
      const intact = (f: number) => [...s.uploads.values()].includes(`frame:${f}`);
      const posed = new Set<number>(); // poses received while their frame was intact
      let next = 0;
      let shown = -1;
      const check = () => {
        if (shown >= 0) expect(s.shown(), `seed ${SEED + 2} run ${run}`).toBe(`frame:${shown}`);
      };
      for (let op = 0; op < 400; op++) {
        const r = rng();
        if (r < 0.4) {
          next += 1 + Math.floor(rng() * 2);
          s.grab(next);
        } else if (r < 0.75) {
          const f = next - 6 + Math.floor(rng() * 8); // recent, overwritten, never grabbed, future
          if (intact(f)) posed.add(f);
          s.pose(f, rng() < 0.1);
        } else {
          const cands = [...posed].filter((f) => intact(f) && f > shown);
          if (cands.length) shown = Math.max(...cands);
          const res = s.ar.update();
          expect(res.frameId, `seed ${SEED + 2} run ${run} op ${op}`).toBe(shown);
        }
        check();
      }
    }
  });

  it("background 'none' leaves scene.background alone and uploads nothing", () => {
    const s = setup({ background: 'none' });
    const bg = new Color(0x123456);
    s.scene.background = bg;
    expect(s.tracker.listeners.get('grab') ?? 0).toBe(0);
    s.grab(0);
    s.pose(0);
    expect(s.ar.update()).toEqual({ tracking: true, frameId: 0 });
    expect(s.scene.background).toBe(bg);
    expect(s.uploads.size).toBe(0);
    expectCameraAt(s, 0);
  });

  it('dispose removes the listeners and disposes the textures', () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      s.grab(i);
      s.pose(i);
      s.ar.update();
    }
    expect(s.tracker.listeners.get('grab')).toBe(1);
    expect(s.tracker.listeners.get('pose')).toBe(1);
    let disposed = 0;
    for (const t of s.textures) t.addEventListener('dispose', () => disposed++);
    s.ar.dispose();
    expect(s.tracker.listeners.get('grab')).toBe(0);
    expect(s.tracker.listeners.get('pose')).toBe(0);
    expect(disposed).toBe(3);
    expect(s.scene.background).toBeNull();
    s.grab(3);
    s.pose(3);
    expect(s.ar.update().frameId).toBe(2);
  });
});
