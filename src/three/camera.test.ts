/**
 * T3-1 camera sync and T3-3 taps, with real three.js maths in Node.
 *
 * Oracle: `src/synth` projects board points with its own pinhole model (frame
 * px, integer pixel centres); the §7.3 cover crop then maps frame px to canvas
 * CSS px: X = s(u + 0.5) + ox, Y = s(v + 0.5) + oy. three's side goes
 * board mm × mmToM → `Vector3.project(camera)` → NDC → canvas px.
 */
import {
  Group,
  Matrix4,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLCoordinateSystem,
  WebGPUCoordinateSystem,
  type CoordinateSystem,
} from 'three';
import { describe, expect, it } from 'vitest';
import { projectionFromIntrinsics } from '../pose/frames.js';
import { intrinsicsFromFov, projectBoardPoint, randomViewPose } from '../synth/camera.js';
import { mulberry32, uniform } from '../synth/random.js';
import type { CameraIntrinsics, Mat4, Vec3 } from '../types.js';
import { FakeTracker } from './__tests__/fake-tracker.js';
import { MatarThree, type MatarThreeRenderer } from './matar-three.js';
import { mmToM } from './units.js';

const SEED = 31337;
const CANVASES: [number, number][] = [
  [390, 844], // portrait phone
  [844, 390], // landscape phone
];
const FRAMES: [number, number][] = [
  [720, 1280],
  [1280, 720],
  [480, 640],
  [640, 480],
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `buffer` is the drawing-buffer size (`canvas.width/height`), used when the canvas isn't laid out. */
function fakeRenderer(rect: Rect, buffer = { width: 300, height: 150 }): MatarThreeRenderer {
  const domElement = {
    get width() {
      return buffer.width;
    },
    get height() {
      return buffer.height;
    },
    getBoundingClientRect: () => ({ ...rect }),
  } as unknown as HTMLCanvasElement;
  return { domElement, initTexture: () => {} };
}

function randomIntrinsics(rng: () => number, w: number, h: number): CameraIntrinsics {
  const k = intrinsicsFromFov(w, h, uniform(rng, 50, 80));
  return {
    ...k,
    fy: k.fx * uniform(rng, 0.98, 1.02),
    cx: k.cx + uniform(rng, -40, 40),
    cy: k.cy + uniform(rng, -40, 40),
  };
}

/** §7.3 cover crop, frame px → canvas CSS px (independent of src/three/fit.ts). */
function cropToCanvas(k: CameraIntrinsics, wc: number, hc: number, uv: [number, number]) {
  const s = Math.max(wc / k.width, hc / k.height);
  const ox = (wc - s * k.width) / 2;
  const oy = (hc - s * k.height) / 2;
  return [s * (uv[0] + 0.5) + ox, s * (uv[1] + 0.5) + oy] as const;
}

function threeToCanvas(cam: PerspectiveCamera, wc: number, hc: number, p: Vec3) {
  const ndc = new Vector3(p[0], p[1], p[2]).multiplyScalar(mmToM).project(cam);
  return [((ndc.x + 1) / 2) * wc, ((1 - ndc.y) / 2) * hc] as const;
}

function randomPoint(rng: () => number): Vec3 {
  return [uniform(rng, -200, 200), rng() < 0.5 ? 0 : uniform(rng, 0, 100), uniform(rng, -200, 200)];
}

interface Case {
  wc: number;
  hc: number;
  k: CameraIntrinsics;
  pose: Mat4;
}

/** Every canvas × frame orientation, `perCombo` random poses each. */
function cases(rng: () => number, perCombo: number): Case[] {
  const out: Case[] = [];
  for (const [wc, hc] of CANVASES) {
    for (const [w, h] of FRAMES) {
      for (let i = 0; i < perCombo; i++) {
        out.push({
          wc,
          hc,
          k: randomIntrinsics(rng, w, h),
          pose: randomViewPose(rng, {
            distanceMm: [150, 900],
            tiltDeg: [0, 70],
            rollDeg: [0, 360],
            targetBoxMm: { min: [-100, -100], max: [100, 100] },
          }),
        });
      }
    }
  }
  return out;
}

function setup(
  rect: Rect,
  coordinateSystem: CoordinateSystem = WebGLCoordinateSystem,
  buffer?: { width: number; height: number },
) {
  const tracker = new FakeTracker({} as HTMLVideoElement);
  const camera = new PerspectiveCamera(50, 1, 0.01, 100);
  camera.coordinateSystem = coordinateSystem;
  const scene = new Scene();
  const ar = new MatarThree({
    tracker,
    renderer: fakeRenderer(rect, buffer),
    camera,
    scene,
    background: 'none',
  });
  return { tracker, camera, scene, ar };
}

describe('MatarThree camera sync (T3-1)', () => {
  for (const [name, cs] of [
    ['WebGL', WebGLCoordinateSystem],
    ['WebGPU', WebGPUCoordinateSystem],
  ] as const) {
    it(`board points land on the pinhole + crop pixel to 1e-6 px (${name} coordinates)`, () => {
      const rng = mulberry32(SEED);
      const rect: Rect = { left: 13, top: 27, width: 1, height: 1 };
      const { tracker, camera, ar } = setup(rect, cs);
      let maxErr = 0;
      let checked = 0;
      let frameId = 0;
      for (const c of cases(rng, 40)) {
        rect.width = c.wc;
        rect.height = c.hc;
        tracker.pose(++frameId, c.pose, c.k);
        expect(ar.update()).toEqual({ tracking: true, frameId });
        for (let j = 0; j < 5; j++) {
          const p = randomPoint(rng);
          const uv = projectBoardPoint(c.k, c.pose, p);
          if (!uv) continue;
          const [x, y] = cropToCanvas(c.k, c.wc, c.hc, uv);
          const [x3, y3] = threeToCanvas(camera, c.wc, c.hc, p);
          const err = Math.max(Math.abs(x3 - x), Math.abs(y3 - y));
          if (!(err <= 1e-6)) throw new Error(`seed ${SEED}: case ${frameId} off by ${err} px`);
          maxErr = Math.max(maxErr, err);
          checked++;
        }
      }
      console.info(`T3-1 (${name}): ${checked} points, max error ${maxErr.toExponential(2)} px`);
      expect(checked).toBeGreaterThan(1000);
    });
  }

  it('matches core projectionFromIntrinsics of the crop intrinsics (WebGL)', () => {
    const rng = mulberry32(SEED + 1);
    const rect: Rect = { left: 0, top: 0, width: 1, height: 1 };
    const { tracker, camera, ar } = setup(rect);
    for (const c of cases(rng, 5)) {
      rect.width = c.wc;
      rect.height = c.hc;
      tracker.pose(1, c.pose, c.k);
      ar.update();
      const s = Math.max(c.wc / c.k.width, c.hc / c.k.height);
      const crop: CameraIntrinsics = {
        width: c.wc,
        height: c.hc,
        fx: s * c.k.fx,
        fy: s * c.k.fy,
        cx: s * (c.k.cx + 0.5) + (c.wc - s * c.k.width) / 2 - 0.5,
        cy: s * (c.k.cy + 0.5) + (c.hc - s * c.k.height) / 2 - 0.5,
      };
      const core = projectionFromIntrinsics(crop, camera.near, camera.far);
      const e = camera.projectionMatrix.elements;
      for (let i = 0; i < 16; i++) {
        expect(e[i]).toBeCloseTo(core[i] as number, 12);
      }
      const id = new Matrix4().multiplyMatrices(
        camera.projectionMatrix,
        camera.projectionMatrixInverse,
      );
      for (let i = 0; i < 16; i++) expect(id.elements[i]).toBeCloseTo(i % 5 === 0 ? 1 : 0, 9);
    }
  });

  it('passes coordinateSystem and reversedDepth to makePerspective', () => {
    const rect: Rect = { left: 0, top: 0, width: 400, height: 300 };
    const { tracker, camera, ar } = setup(rect, WebGPUCoordinateSystem);
    // the renderer sets this when it uses a reversed depth buffer
    (camera as unknown as { _reversedDepth: boolean })._reversedDepth = true;
    const k = intrinsicsFromFov(640, 480, 60);
    tracker.pose(
      1,
      randomViewPose(mulberry32(1), { distanceMm: [300, 300], tiltDeg: [20, 20] }),
      k,
    );
    ar.update();
    const n = camera.near;
    // same aspect as the frame: scale only, no crop offsets
    const s = Math.max(400 / 640, 300 / 480);
    const [l, r] = [
      (-n * s * (k.cx + 0.5)) / (s * k.fx),
      (n * s * (640 - k.cx - 0.5)) / (s * k.fx),
    ];
    const [t, b] = [
      (n * s * (k.cy + 0.5)) / (s * k.fy),
      (-n * s * (480 - k.cy - 0.5)) / (s * k.fy),
    ];
    const want = new Matrix4().makePerspective(
      l,
      r,
      t,
      b,
      n,
      camera.far,
      WebGPUCoordinateSystem,
      true,
    );
    for (let i = 0; i < 16; i++) {
      expect(camera.projectionMatrix.elements[i]).toBeCloseTo(want.elements[i] as number, 12);
    }
  });

  it('render keeps the pose: matrixWorld = boardFromCamera with mm → m', () => {
    const rng = mulberry32(SEED + 2);
    const rect: Rect = { left: 0, top: 0, width: 390, height: 844 };
    const { tracker, camera, scene, ar } = setup(rect);
    scene.add(camera); // identity parent is allowed
    let maxRot = 0;
    let maxPosMm = 0;
    for (let i = 0; i < 200; i++) {
      const pose = randomViewPose(rng, {
        distanceMm: [150, 900],
        tiltDeg: [0, 80],
        rollDeg: [0, 360],
      });
      tracker.pose(i, pose, intrinsicsFromFov(720, 1280, 60));
      ar.update();
      // what renderer.render does before drawing
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      expect(camera.matrixAutoUpdate).toBe(true);
      const e: readonly number[] = camera.matrixWorld.elements;
      for (let j = 0; j < 16; j++) {
        const got = e[j] as number;
        if (j >= 12 && j < 15) {
          maxPosMm = Math.max(maxPosMm, Math.abs(got / mmToM - (pose[j] as number)));
        } else {
          maxRot = Math.max(maxRot, Math.abs(got - (pose[j] as number)));
        }
      }
    }
    console.info(
      `T3-1 matrixWorld: max rotation error ${maxRot.toExponential(2)}, position ${maxPosMm.toExponential(2)} mm`,
    );
    expect(maxRot).toBeLessThan(1e-12);
    expect(maxPosMm).toBeLessThan(1e-9);
  });

  it('follows canvas resizes and frame size/orientation changes', () => {
    const rng = mulberry32(SEED + 3);
    const rect: Rect = { left: 5, top: 9, width: 390, height: 844 };
    const buffer = { width: 780, height: 1688 };
    const { tracker, camera, ar } = setup(rect, WebGLCoordinateSystem, buffer);
    const pose = randomViewPose(rng, { distanceMm: [400, 400], tiltDeg: [30, 30] });
    const check = (k: CameraIntrinsics, wc = rect.width, hc = rect.height) => {
      for (let j = 0; j < 20; j++) {
        const p = randomPoint(rng);
        const uv = projectBoardPoint(k, pose, p);
        if (!uv) continue;
        const [x, y] = cropToCanvas(k, wc, hc, uv);
        const [x3, y3] = threeToCanvas(camera, wc, hc, p);
        expect(Math.abs(x3 - x)).toBeLessThan(1e-6);
        expect(Math.abs(y3 - y)).toBeLessThan(1e-6);
      }
    };
    const portrait = randomIntrinsics(rng, 720, 1280);
    tracker.pose(1, pose, portrait);
    ar.update();
    check(portrait);
    // canvas resized (rotated phone), no new pose yet
    rect.width = 844;
    rect.height = 390;
    ar.update();
    check(portrait);
    // frame orientation follows
    const landscape = randomIntrinsics(rng, 1280, 720);
    tracker.pose(2, pose, landscape);
    ar.update();
    check(landscape);
    // canvas not laid out (0 × 0 CSS px): falls back to the drawing-buffer size
    rect.width = rect.height = 0;
    buffer.width = buffer.height = 1000;
    ar.update();
    check(landscape, 1000, 1000);
  });

  it('reports tracking from smoothed and keeps the last pose while lost', () => {
    const rect: Rect = { left: 0, top: 0, width: 400, height: 400 };
    const { tracker, camera, ar } = setup(rect);
    const before = camera.projectionMatrix.clone();
    expect(ar.update()).toEqual({ tracking: false, frameId: -1 });
    expect(camera.projectionMatrix.equals(before)).toBe(true);
    const k = intrinsicsFromFov(640, 480, 60);
    const pose = randomViewPose(mulberry32(5), { distanceMm: [300, 300], tiltDeg: [20, 20] });
    tracker.pose(7, pose, k);
    expect(ar.update()).toEqual({ tracking: true, frameId: 7 });
    const m = camera.matrixWorld.clone();
    tracker.pose(8, null, k);
    expect(ar.update()).toEqual({ tracking: false, frameId: 8 });
    expect(camera.matrixWorld.equals(m)).toBe(true);
    expect(ar.update()).toEqual({ tracking: false, frameId: 8 });
  });

  it('throws if the camera has a non-identity parent', () => {
    const rect: Rect = { left: 0, top: 0, width: 400, height: 400 };
    const camera = new PerspectiveCamera();
    const group = new Group();
    group.position.set(0, 1, 0);
    group.add(camera);
    const opts = {
      tracker: new FakeTracker({} as HTMLVideoElement),
      renderer: fakeRenderer(rect),
      camera,
      scene: new Scene(),
    };
    expect(() => new MatarThree(opts)).toThrow(/identity/);
    group.position.set(0, 0, 0);
    const ar = new MatarThree(opts);
    expect(() => ar.update()).not.toThrow();
    group.rotation.y = 0.1;
    expect(() => ar.update()).toThrow(/identity/);
  });
});

describe('MatarThree taps (T3-3)', () => {
  it('a tap on the projection of a board point gives a ray through it (1e-6 mm)', () => {
    const rng = mulberry32(SEED + 4);
    const rect: Rect = { left: 17, top: 41, width: 1, height: 1 };
    const { tracker, ar } = setup(rect);
    let maxMm = 0;
    let maxNdc = 0;
    let checked = 0;
    let frameId = 0;
    for (const c of cases(rng, 30)) {
      rect.width = c.wc;
      rect.height = c.hc;
      tracker.pose(++frameId, c.pose, c.k);
      ar.update();
      for (let j = 0; j < 5; j++) {
        const p = randomPoint(rng);
        const uv = projectBoardPoint(c.k, c.pose, p);
        if (!uv) continue;
        const [x, y] = cropToCanvas(c.k, c.wc, c.hc, uv);
        const tap = { clientX: rect.left + x, clientY: rect.top + y };
        const ndc = ar.pointerToNdc(tap);
        maxNdc = Math.max(
          maxNdc,
          Math.abs(ndc.x - ((2 * x) / c.wc - 1)),
          Math.abs(ndc.y - (1 - (2 * y) / c.hc)),
        );
        const ray = ar.raycaster(tap).ray;
        const target = new Vector3(p[0], p[1], p[2]).multiplyScalar(mmToM);
        const errMm = ray.distanceToPoint(target) / mmToM;
        expect(target.clone().sub(ray.origin).dot(ray.direction)).toBeGreaterThan(0);
        if (!(errMm <= 1e-6))
          throw new Error(`seed ${SEED + 4}: case ${frameId} ray misses by ${errMm} mm`);
        maxMm = Math.max(maxMm, errMm);
        checked++;
      }
    }
    console.info(`T3-3: ${checked} taps, max ray distance ${maxMm.toExponential(2)} mm`);
    expect(maxNdc).toBeLessThan(1e-12);
    expect(checked).toBeGreaterThan(800);
  });
});
