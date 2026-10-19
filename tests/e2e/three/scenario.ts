/**
 * Shared by the real-three fixture page (fixture.ts, browser) and its spec
 * (ring.spec.ts, Node): frame colours, the fixture's geometry and the event
 * script. Pure data, no DOM.
 *
 * Frame N is painted solid `frameRgb(N)` (a hue per frame, 22.5° apart over 16
 * frames, consecutive frames 157.5° apart), with a white band over the top
 * `BAND_TOP` rows and black bands `BAND_SIDE` px wide on the left and right.
 * In the 200 × 200 canvas the 160 × 120 frame is cover-cropped horizontally
 * (s = 5/3, ox = −33.3 px), so the side bands must be cut off and the top band
 * must stay at the top.
 */

export const FRAME_W = 160;
export const FRAME_H = 120;
export const CANVAS = 200;
export const BAND_TOP = 24;
export const BAND_SIDE = 12;

/** Canvas sample points (CSS px from the top-left) and what they should show. */
export const SAMPLES = {
  /** frame colour, below the overlay */
  centre: [100, 150],
  /** frame colour if the side bands are cropped off (frame col ≈ 21 / 138) */
  left: [2, 150],
  right: [197, 150],
  /** the white top band (frame row ≈ 7) */
  top: [100, 12],
  /** the gray 20 mm overlay square at the board origin */
  overlay: [100, 100],
} as const;
export type SampleName = keyof typeof SAMPLES;

export const OVERLAY_RGB: Rgb = [128, 128, 128];

export type Rgb = [number, number, number];

/** sRGB colour of frame `n`: hue (n · 157.5°) mod 360, full saturation, lightness 0.5. */
export function frameRgb(n: number): Rgb {
  const h = (((n * 157.5) % 360) + 360) % 360;
  const f = (k: number) => {
    const kk = (k + h / 30) % 12;
    return Math.round(255 * (0.5 - 0.5 * Math.max(-1, Math.min(kk - 3, 9 - kk, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** Index n ∈ [0, 16) whose colour is nearest to `rgb`, and the max channel difference. */
export function nearestFrame(rgb: readonly number[]): { frame: number; diff: number } {
  let best = { frame: -1, diff: Infinity };
  for (let n = 0; n < 16; n++) {
    const c = frameRgb(n);
    const diff = Math.max(...c.map((v, i) => Math.abs(v - (rgb[i] ?? 0))));
    if (diff < best.diff) best = { frame: n, diff };
  }
  return best;
}

/**
 * Where the frames come from and what MatarThree uploads:
 * - `canvas-frame`: VideoFrames made from the painted canvas, `textureSource: 'frame'`
 * - `video-frame`: `<video>` fed by `canvas.captureStream()`, VideoFrames made
 *   from the video (as the tracker does), `textureSource: 'frame'`
 * - `video-video`: same video and frames, `textureSource: 'video'`
 * - `video-null`: same video, grab events without a VideoFrame (canvas path),
 *   `textureSource: 'frame'` → falls back to the video
 */
export type Variant = 'canvas-frame' | 'video-frame' | 'video-video' | 'video-null';

export type Op = { grab: number } | { pose: number } | { render: number };

/**
 * The event script: `render: N` = `update()` + `render()`, after which frame N
 * must be on screen with pose N. Frame N is painted (and reaches the video)
 * just before `grab: N`.
 */
export const SCRIPT: Op[] = [
  { grab: 0 },
  { pose: 0 },
  { render: 0 },
  { grab: 1 }, // the video now shows frame 1, pose 1 not there yet
  { render: 0 },
  { pose: 1 },
  { render: 1 },
  { grab: 2 }, // no pose for frame 2
  { grab: 3 },
  { pose: 3 },
  { render: 3 },
  { pose: 2 }, // late: older than the frame on screen
  { render: 3 },
  { grab: 4 },
  { grab: 5 },
  { grab: 6 }, // overwrites frame 4's texture (frame 3 is on screen)
  { pose: 4 }, // skipped
  { render: 3 },
  { pose: 6 },
  { render: 6 },
  { pose: 5 }, // older than frame 6
  { render: 6 },
  ...[7, 8, 9, 10, 11, 12, 13, 14, 15].flatMap((n): Op[] => [
    { grab: n },
    { pose: n },
    { render: n },
  ]),
];

export interface Step {
  /** index into SCRIPT */
  op: number;
  expected: number;
  result: { tracking: boolean; frameId: number };
  samples: Record<SampleName, Rgb>;
}
