/**
 * Browser fixture for the real-three texture-ring test (T3-2, ARCHITECTURE.md
 * §7.2): a `FakeTracker` replays `SCRIPT` with frames painted on a canvas, a
 * real `WebGLRenderer` draws, and `gl.readPixels` samples the result. The page
 * exposes `window.matarThreeFixture.run(variant)`; ring.spec.ts asserts.
 *
 * Board/scene: a fixed pose 300 mm above the board origin looking down, and a
 * 20 mm gray square on the board at the origin (metres in three.js).
 */
import {
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { FakeTracker } from '../../../src/three/__tests__/fake-tracker.js';
import { MatarThree, mmToM } from '../../../src/three/index.js';
import type { CameraIntrinsics } from '../../../src/types.js';
import {
  BAND_SIDE,
  BAND_TOP,
  CANVAS,
  FRAME_H,
  FRAME_W,
  OVERLAY_RGB,
  SAMPLES,
  SCRIPT,
  frameRgb,
  nearestFrame,
  type Rgb,
  type SampleName,
  type Step,
  type Variant,
} from './scenario.js';

const K: CameraIntrinsics = {
  width: FRAME_W,
  height: FRAME_H,
  fx: 150,
  fy: 150,
  cx: (FRAME_W - 1) / 2,
  cy: (FRAME_H - 1) / 2,
};
/** boardFromCamera (GL, mm, column-major): camera at y = 300 mm, looking down, page upright. */
const POSE = Float64Array.of(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 300, 0, 1);

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

async function run(variant: Variant): Promise<Step[]> {
  const src = document.createElement('canvas');
  src.width = FRAME_W;
  src.height = FRAME_H;
  const ctx = src.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const paint = (n: number) => {
    ctx.fillStyle = css(frameRgb(n));
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, BAND_SIDE, FRAME_H);
    ctx.fillRect(FRAME_W - BAND_SIDE, 0, BAND_SIDE, FRAME_H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, FRAME_W, BAND_TOP);
  };

  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  document.body.append(video);
  const useVideo = variant !== 'canvas-frame';
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) throw new Error('no 2d context');
  probe.canvas.width = FRAME_W;
  probe.canvas.height = FRAME_H;
  let track: CanvasCaptureMediaStreamTrack | null = null;
  if (useVideo) {
    paint(0);
    const stream = src.captureStream(0);
    track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    video.srcObject = stream;
    track.requestFrame();
    await video.play();
  }
  /** paint frame n and, with a video, wait until the video shows it */
  const show = async (n: number) => {
    paint(n);
    if (!track) return;
    track.requestFrame();
    const deadline = performance.now() + 5000;
    for (;;) {
      if (video.readyState >= 2) {
        probe.drawImage(video, 0, 0, FRAME_W, FRAME_H);
        const d = probe.getImageData(FRAME_W / 2, (FRAME_H * 3) / 4, 1, 1).data;
        if (nearestFrame([d[0] ?? 0, d[1] ?? 0, d[2] ?? 0]).frame === n % 16) return;
      }
      if (performance.now() > deadline) throw new Error(`the video never showed frame ${n}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(CANVAS, CANVAS);
  document.body.append(renderer.domElement);
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 10);
  const square = new Mesh(
    new PlaneGeometry(20 * mmToM, 20 * mmToM),
    new MeshBasicMaterial({ color: css(OVERLAY_RGB) }),
  );
  square.rotation.x = -Math.PI / 2; // on the paper (XZ), facing +Y
  scene.add(square);

  const tracker = new FakeTracker(video);
  const ar = new MatarThree({
    tracker,
    renderer,
    camera,
    scene,
    textureSource: variant === 'video-video' ? 'video' : 'frame',
  });

  const gl = renderer.getContext();
  const px = (x: number, y: number): Rgb => {
    const b = new Uint8Array(4);
    gl.readPixels(x, CANVAS - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b);
    return [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0];
  };

  const steps: Step[] = [];
  for (let i = 0; i < SCRIPT.length; i++) {
    const op = SCRIPT[i];
    if (!op) continue;
    if ('grab' in op) {
      await show(op.grab);
      const frame =
        variant === 'canvas-frame'
          ? new VideoFrame(src, { timestamp: op.grab * 33_333 })
          : variant === 'video-null'
            ? null
            : new VideoFrame(video, { timestamp: op.grab * 33_333 });
      tracker.grab(op.grab, frame);
      frame?.close(); // the tracker transfers it to the worker right after the event
    } else if ('pose' in op) {
      tracker.pose(op.pose, POSE, K);
    } else {
      const result = ar.update();
      renderer.render(scene, camera);
      const samples = {} as Record<SampleName, Rgb>;
      for (const [name, [x, y]] of Object.entries(SAMPLES)) {
        samples[name as SampleName] = px(x, y);
      }
      steps.push({ op: i, expected: op.render, result, samples });
    }
  }
  ar.dispose();
  renderer.dispose();
  return steps;
}

(window as unknown as { matarThreeFixture: { run: typeof run } }).matarThreeFixture = { run };
