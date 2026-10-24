/**
 * Worker host + processor with the real stages on a rendered board (TASKS.md
 * C2/C3): a fake NV12 `VideoFrame` (padded stride, sensor-rotated) and the gray
 * path both give a pose; the frame-index strip is read in debug mode; every
 * frame message gets exactly one reply.
 */
import { describe, expect, it } from 'vitest';
import { createBoard, layoutBorderTags, pickTagIds } from '../board/index.js';
import { intrinsicsFromFov, lookAtPose, renderBoard } from '../synth/index.js';
import type { GrayImage, MainToWorker, WorkerOptions, WorkerToMain } from '../types.js';
import type { VideoFrameLike } from './frame.js';
import { rotateGray } from './gray.js';
import { createHost } from './host.js';
import { createInlinePort } from './inline.js';
import { defaultStages } from './stages.js';

const W = 640;
const H = 480;
const board = createBoard({
  tags: layoutBorderTags({
    areaMm: { x: 0, y: 0, width: 210, height: 297 },
    originMm: [105, 148.5],
    sizeMm: 32,
    ids: pickTagIds('tag36h11', 16, 'host-test'),
  }),
});
const k = intrinsicsFromFov(W, H, 68);
const truth = lookAtPose([0, 420, 260], [0, 0, 0]);
const image: GrayImage = renderBoard({
  board,
  intrinsics: k,
  boardFromCamera: truth,
  pageMm: { min: [-105, -148.5], max: [105, 148.5] },
  blurSigmaPx: 0.8,
  noiseSigma: 1,
});
const OPTIONS: WorkerOptions = { fovPriorDeg: 68, autoFocal: true, debug: true };

/** An NV12 frame of `img` with a padded Y stride, optionally stored sensor-rotated. */
function nv12Frame(
  img: GrayImage,
  storedRotationCcw: 0 | 90,
): VideoFrameLike & { closed: boolean; close(): void } {
  let src = img.data;
  let w = img.width;
  let h = img.height;
  if (storedRotationCcw === 90) {
    const out = new Uint8Array(w * h);
    [w, h] = rotateGray(img.data, w, h, 270, out); // stored = display turned 90° ccw
    src = out;
  }
  const stride = w + 32;
  const ySize = stride * h;
  const buf = new Uint8Array(ySize + (stride * h) / 2).fill(128);
  for (let y = 0; y < h; y++) buf.set(src.subarray(y * w, y * w + w), y * stride);
  return {
    format: 'NV12',
    codedWidth: stride,
    codedHeight: h,
    visibleRect: { width: w, height: h },
    closed: false,
    allocationSize: () => buf.length,
    copyTo(dest) {
      dest.set(buf);
      return Promise.resolve([
        { offset: 0, stride },
        { offset: ySize, stride },
      ]);
    },
    close() {
      this.closed = true;
    },
  };
}

function withIndexStrip(img: GrayImage, index: number): GrayImage {
  const data = img.data.slice();
  for (let b = 0; b < 16; b++) {
    const v = (index >> (15 - b)) & 1 ? 255 : 0;
    for (let y = 0; y < 8; y++) data.fill(v, y * img.width + b * 8, y * img.width + b * 8 + 8);
  }
  return { ...img, data };
}

async function run(msgs: MainToWorker[]): Promise<WorkerToMain[]> {
  const out: WorkerToMain[] = [];
  const handle = createHost((m) => out.push(m), defaultStages);
  for (const m of msgs) await handle(m);
  return out;
}

const frameBase = { displayWidth: W, displayHeight: H, screenAngleDeg: 0 };

describe('worker host with the real stages', () => {
  it('reads an NV12 VideoFrame with a padded stride and solves the pose', async () => {
    const vf = nv12Frame(withIndexStrip(image, 1234), 0);
    const out = await run([
      { type: 'init', board, intrinsics: null, options: OPTIONS },
      {
        type: 'frame',
        frameId: 7,
        timestampMs: 1,
        ...frameBase,
        videoFrame: vf as unknown as VideoFrame,
      },
    ]);
    expect(out[0]).toEqual({ type: 'ready' });
    const r = out.find((m) => m.type === 'result');
    if (r?.type !== 'result') throw new Error('no result');
    expect(r.frameId).toBe(7);
    expect(r.detections.length).toBeGreaterThanOrEqual(12);
    expect(r.pose).not.toBeNull();
    expect(
      Math.hypot(
        r.pose!.boardFromCamera[12]! - truth[12]!,
        r.pose!.boardFromCamera[13]! - truth[13]!,
      ),
    ).toBeLessThan(1);
    expect(r.focalSource).toBe('prior');
    expect(r.debugFrameIndex).toBe(1234);
    expect(r.thumbnail!.width).toBe(160);
    expect(r.frame).toMatchObject({ path: 'videoframe', format: 'NV12', rotationDeg: 0 });
    expect(vf.closed).toBe(true);
  });

  it('rotates a transposed (sensor-oriented) frame to the display orientation', async () => {
    const vf = nv12Frame(image, 90);
    const out = await run([
      { type: 'init', board, intrinsics: null, options: OPTIONS },
      {
        type: 'frame',
        frameId: 1,
        timestampMs: 1,
        ...frameBase,
        videoFrame: vf as unknown as VideoFrame,
      },
    ]);
    const r = out.find((m) => m.type === 'result');
    if (r?.type !== 'result') throw new Error('no result');
    expect([r.width, r.height]).toEqual([W, H]);
    expect(r.frame.rotationDeg).toBe(90);
    expect(r.pose).not.toBeNull();
  });

  it('handles gray frames, opaque frames and errors with exactly one reply each', async () => {
    const opaque: VideoFrameLike & { close(): void } = {
      format: null,
      codedWidth: W,
      codedHeight: H,
      visibleRect: { width: W, height: H },
      allocationSize: () => {
        throw new Error('NotSupportedError');
      },
      copyTo: () => Promise.reject(new Error('NotSupportedError')),
      close() {},
    };
    const gray = image.data.slice().buffer;
    const out = await run([
      { type: 'init', board, intrinsics: null, options: OPTIONS },
      {
        type: 'frame',
        frameId: 1,
        timestampMs: 1,
        ...frameBase,
        gray: { width: W, height: H, data: gray },
      },
      {
        type: 'frame',
        frameId: 2,
        timestampMs: 2,
        ...frameBase,
        videoFrame: opaque as unknown as VideoFrame,
      },
      { type: 'frame', frameId: 3, timestampMs: 3, ...frameBase },
    ]);
    const replies = out.filter((m) => m.type !== 'ready' && m.type !== 'intrinsics');
    expect(replies.map((m) => m.type)).toEqual(['result', 'fallback', 'error']);
    const r = replies[0];
    if (r?.type !== 'result') throw new Error('no result');
    expect(r.pose).not.toBeNull();
    expect(r.returned).toBe(gray);
  });

  it("posts a frame's result before the estimate the frame led to", async () => {
    // a focal estimator that jumps on its first frame
    const jumped = { ...k, fx: k.fx * 1.2, fy: k.fy * 1.2 };
    const out: WorkerToMain[] = [];
    const handle = createHost((m) => out.push(m), {
      ...defaultStages,
      createFocalEstimator: (initial) => {
        let est: { intrinsics: typeof k; source: 'prior' | 'provided' | 'estimated' } = initial;
        return {
          add: () => {
            est = { intrinsics: jumped, source: 'estimated' };
            return { intrinsics: jumped, source: 'estimated', stdDevPct: 0.5, keyframes: 5 };
          },
          reset: () => undefined,
          get intrinsics() {
            return est.intrinsics;
          },
          get source() {
            return est.source;
          },
          stdDevPct: null,
        };
      },
    });
    await handle({ type: 'init', board, intrinsics: null, options: OPTIONS });
    await handle({
      type: 'frame',
      frameId: 1,
      timestampMs: 1,
      ...frameBase,
      gray: { width: W, height: H, data: image.data.slice().buffer },
    });
    const replies = out.filter((m) => m.type !== 'ready');
    expect(replies.map((m) => m.type)).toEqual(['result', 'intrinsics']);
    const [r] = replies;
    if (r?.type !== 'result') throw new Error('no result');
    expect(r.focalSource).toBe('prior'); // what frame 1 was solved with
  });

  it('uses provided intrinsics only for their own frame size', async () => {
    const provided = { ...k, fx: k.fx * 1.02, fy: k.fy * 1.02 };
    const out = await run([
      { type: 'init', board, intrinsics: provided, options: OPTIONS },
      {
        type: 'frame',
        frameId: 1,
        timestampMs: 1,
        ...frameBase,
        gray: { width: W, height: H, data: image.data.slice().buffer },
      },
    ]);
    const r = out.find((m) => m.type === 'result');
    if (r?.type !== 'result') throw new Error('no result');
    expect(r.focalSource).toBe('provided');
    expect(r.intrinsics.fx).toBeCloseTo(provided.fx, 9);
  });

  it('the inline port answers like a worker', async () => {
    const port = createInlinePort();
    const got: WorkerToMain[] = [];
    port.addEventListener('message', (e) => got.push((e as MessageEvent<WorkerToMain>).data));
    port.postMessage({ type: 'init', board, intrinsics: null, options: OPTIONS });
    port.postMessage({
      type: 'frame',
      frameId: 1,
      timestampMs: 1,
      ...frameBase,
      gray: { width: W, height: H, data: image.data.slice().buffer },
    });
    for (let i = 0; i < 100 && !got.some((m) => m.type === 'result'); i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(got[0]?.type).toBe('ready');
    const r = got.find((m) => m.type === 'result');
    expect(r?.type === 'result' && r.pose !== null).toBe(true);
    port.terminate();
  });
});
