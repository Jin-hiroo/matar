/**
 * Renders a fake camera video of a board for Chromium's fake capture
 * (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>`)
 * plus the ground-truth pose of every frame (TASKS.md S2, ARCHITECTURE.md §9.2).
 *
 *   pnpm fake-video                       # tests/out/fake-camera.{y4m,json}
 *   pnpm fake-video --seconds 2 --static  # one held pose
 *   pnpm fake-video --board my-board.json --width 1280 --height 720
 *
 * The camera path is periodic, so Chromium's looping playback never jumps.
 * Y4M: 4:2:0 (`C420jpeg`, as ffmpeg writes for yuv420p), luma = the rendered
 * gray levels (full range), chroma = 128.
 *
 * Each frame carries its index in the top-left corner (ARCHITECTURE.md §9.2):
 * 16 blocks of 8 × 8 px in a row, bit 15 first, white = 1, black = 0. With
 * `?debug` the worker reads it back into `result.debugFrameIndex`, so e2e tests
 * can pick the right ground-truth pose despite capture start-up and looping.
 */
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  intrinsicsFromFov,
  lookAtPose,
  projectBoardCorners,
  renderBoard,
  rollPose,
} from '../src/synth/index.js';
import type { Board, Mat4, Vec2, Vec3 } from '../src/types.js';

const DEG = Math.PI / 180;
const INDEX_BITS = 16;
const INDEX_BLOCK_PX = 8;

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: 'tests/out/fake-camera' },
    board: { type: 'string' },
    width: { type: 'string', default: '640' },
    height: { type: 'string', default: '480' },
    fps: { type: 'string', default: '30' },
    seconds: { type: 'string', default: '3' },
    /** horizontal field of view, degrees (along the width) */
    hfov: { type: 'string', default: '68' },
    noise: { type: 'string', default: '2' },
    blur: { type: 'string', default: '0.8' },
    static: { type: 'boolean', default: false },
  },
});

const width = int(args.width, 'width');
const height = int(args.height, 'height');
const fps = int(args.fps, 'fps');
const frameCount = Math.round(num(args.seconds, 'seconds') * fps);
if (width % 2 || height % 2) throw new Error('width and height must be even (4:2:0)');
if (frameCount < 1) throw new Error('need at least one frame');
if (frameCount > 2 ** INDEX_BITS) throw new Error(`at most ${2 ** INDEX_BITS} frames`);
if (width < INDEX_BITS * INDEX_BLOCK_PX) throw new Error('width too small for the frame index');

const board: Board = args.board
  ? (JSON.parse(readFileSync(args.board, 'utf8')) as Board)
  : defaultBoard();
// A4 portrait around the board origin; outside it the background shows.
const pageMm = { min: [-105, -148.5] as Vec2, max: [105, 148.5] as Vec2 };
const intrinsics = intrinsicsFromFov(width, height, num(args.hfov, 'hfov'));

const out = resolve(args.out);
mkdirSync(dirname(out), { recursive: true });
const fd = openSync(`${out}.y4m`, 'w');
writeSync(fd, `YUV4MPEG2 W${width} H${height} F${fps}:1 Ip A1:1 C420jpeg\n`);
const chroma = new Uint8Array((width / 2) * (height / 2) * 2).fill(128);

const poses: number[][] = [];
let stripHits = 0;
const t0 = performance.now();
for (let i = 0; i < frameCount; i++) {
  const pose = cameraPath(args.static ? 0 : i / frameCount);
  poses.push(Array.from(pose));
  const img = renderBoard({
    board,
    intrinsics,
    boardFromCamera: pose,
    pageMm,
    blurSigmaPx: num(args.blur, 'blur'),
    noiseSigma: num(args.noise, 'noise'),
    seed: i + 1,
  });
  if (tagsNearIndexStrip(pose)) stripHits++;
  writeFrameIndex(img.data, width, i);
  writeSync(fd, 'FRAME\n');
  writeSync(fd, img.data);
  writeSync(fd, chroma);
  if ((i + 1) % 10 === 0 || i + 1 === frameCount) {
    process.stdout.write(`\rframe ${i + 1}/${frameCount}`);
  }
}
closeSync(fd);
if (stripHits) {
  console.warn(
    `\nwarning: in ${stripHits} frame(s) a tag comes within 4 px of the frame-index strip`,
  );
}

writeFileSync(
  `${out}.json`,
  JSON.stringify(
    {
      format: 'matar-fake-video/1',
      note: 'boardFromCamera per frame: GL camera convention, mm, column-major (ARCHITECTURE.md §2.5)',
      width,
      height,
      fps,
      frames: frameCount,
      intrinsics,
      pageMm,
      board,
      frameIndex: {
        x: 0,
        y: 0,
        blockPx: INDEX_BLOCK_PX,
        bits: INDEX_BITS,
        msbFirst: true,
        white: 1,
      },
      boardFromCamera: poses,
    },
    null,
    1,
  ),
);
const secs = ((performance.now() - t0) / 1000).toFixed(1);
console.log(`\nwrote ${out}.y4m and ${out}.json (${frameCount} frames in ${secs} s)`);

/**
 * Camera at phase u ∈ [0, 1): seen from the bottom edge of the page, page
 * upright in the image, swaying left/right, up/down and in distance. Periodic in u.
 */
function cameraPath(u: number): Mat4 {
  const p = 2 * Math.PI * u;
  const azimuth = (90 + 25 * Math.sin(p)) * DEG; // 90° = camera on the +Z side
  const tilt = (35 + 10 * Math.sin(2 * p)) * DEG; // from the board normal
  const d = 400 + 40 * Math.cos(p);
  const target: Vec3 = [15 * Math.sin(p), 0, 10 * Math.sin(2 * p)];
  const eye: Vec3 = [
    target[0] + d * Math.sin(tilt) * Math.cos(azimuth),
    d * Math.cos(tilt),
    target[2] + d * Math.sin(tilt) * Math.sin(azimuth),
  ];
  return rollPose(lookAtPose(eye, target), 5 * Math.sin(p));
}

/** Writes `index` as INDEX_BITS blocks along the top-left edge, bit 15 first, white = 1. */
function writeFrameIndex(gray: Uint8Array, w: number, index: number): void {
  for (let b = 0; b < INDEX_BITS; b++) {
    const v = (index >> (INDEX_BITS - 1 - b)) & 1 ? 255 : 0;
    for (let y = 0; y < INDEX_BLOCK_PX; y++) {
      gray.fill(v, y * w + b * INDEX_BLOCK_PX, y * w + (b + 1) * INDEX_BLOCK_PX);
    }
  }
}

/** Does any tag (with its white ring) come within 4 px of the frame-index strip? */
function tagsNearIndexStrip(pose: Mat4): boolean {
  const xMax = INDEX_BITS * INDEX_BLOCK_PX + 4;
  const yMax = INDEX_BLOCK_PX + 4;
  const ringed: Board = {
    family: board.family,
    tags: board.tags.map((t) => ({ ...t, sizeMm: t.sizeMm * 1.25 })),
  };
  for (const corners of projectBoardCorners(ringed, intrinsics, pose).values()) {
    const xs = corners.map((c) => c[0]);
    const ys = corners.map((c) => c[1]);
    if (Math.min(...xs) < xMax && Math.min(...ys) < yMax) return true;
  }
  return false;
}

/** 12 × 32 mm tags around an A4 page (IDs 0–11), origin at the page centre. */
function defaultBoard(): Board {
  const centres: Vec2[] = [
    [-77, -124.5],
    [0, -124.5],
    [77, -124.5],
    [77, -62],
    [77, 0],
    [77, 62],
    [77, 124.5],
    [0, 124.5],
    [-77, 124.5],
    [-77, 62],
    [-77, 0],
    [-77, -62],
  ];
  return {
    family: 'tag36h11',
    tags: centres.map((centerMm, id) => ({ id, centerMm, sizeMm: 32, rotationDeg: 0 })),
  };
}

function num(v: string | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

function int(v: string | undefined, name: string): number {
  const n = num(v, name);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
  return n;
}
