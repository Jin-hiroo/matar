/**
 * Camera frames → the gray image the detector analyses (ARCHITECTURE.md §6.2).
 *
 * Pure functions on typed arrays; the worker calls them on reused buffers.
 *
 * - Planar YUV (`I420`, `I420A`, `I422`, `I444`, `NV12`, …): the Y plane is the
 *   gray image; copy it row by row honouring `offset` and `stride`.
 * - Packed RGB (`RGBA`, `RGBX`, `BGRA`, `BGRX`): luma = (77 R + 150 G + 29 B) >> 8.
 * - Rotation by 90/180/270° clockwise, so the analysed image has the
 *   orientation of what `<video>` shows (`rotationFor`).
 *
 * Sizes are the frame's visible size (`visibleRect` of `VideoFrame.copyTo`'s
 * default), never `getSettings()` (it can report landscape for portrait frames).
 */

/** Byte layout of one plane, as returned by `VideoFrame.copyTo`. */
export interface PlaneLayoutLike {
  offset: number;
  stride: number;
}

export type GrayKind = 'luma-plane' | 'rgb' | 'bgr' | null;

/** How a `VideoFrame.format` maps to gray; null = not convertible (opaque or unknown). */
export function grayKind(format: string | null): GrayKind {
  switch (format) {
    case 'I420':
    case 'I420A':
    case 'I422':
    case 'I444':
    case 'NV12':
      return 'luma-plane'; // 8-bit planes only; 10-bit formats fall to null
    case 'RGBA':
    case 'RGBX':
      return 'rgb';
    case 'BGRA':
    case 'BGRX':
      return 'bgr';
    default:
      return null;
  }
}

/** Copies the Y plane (8 bit) of a w × h frame into `out` (w·h bytes, stride w). */
export function grayFromLumaPlane(
  src: Uint8Array,
  plane: PlaneLayoutLike,
  w: number,
  h: number,
  out: Uint8Array,
): void {
  if (plane.stride === w && plane.offset === 0) {
    out.set(src.subarray(0, w * h));
    return;
  }
  for (let y = 0; y < h; y++) {
    const s = plane.offset + y * plane.stride;
    out.set(src.subarray(s, s + w), y * w);
  }
}

/** Luma of a packed 4-byte RGB(A/X) or BGR(A/X) w × h frame into `out` (stride w). */
export function grayFromPacked(
  src: Uint8Array,
  plane: PlaneLayoutLike,
  w: number,
  h: number,
  order: 'rgb' | 'bgr',
  out: Uint8Array,
): void {
  const r0 = order === 'rgb' ? 0 : 2;
  const b0 = order === 'rgb' ? 2 : 0;
  for (let y = 0; y < h; y++) {
    let s = plane.offset + y * plane.stride;
    let d = y * w;
    for (let x = 0; x < w; x++, s += 4, d++) {
      out[d] = (77 * src[s + r0]! + 150 * src[s + 1]! + 29 * src[s + b0]!) >> 8; // `!`: s < offset + h·stride
    }
  }
}

export type Rotation = 0 | 90 | 180 | 270;

/** Normalises any multiple of 90° to 0 | 90 | 180 | 270 (other angles → 0). */
export function normaliseRotation(deg: number): Rotation {
  const q = Math.round(deg / 90);
  if (!Number.isFinite(deg) || Math.abs(deg - q * 90) > 1e-6) return 0;
  return ((((q % 4) + 4) % 4) * 90) as Rotation;
}

/**
 * Clockwise rotation that makes a `frameW × frameH` frame look like the
 * `displayW × displayH` video (§6.2):
 * 1. `frame.rotation` (Chrome 138+) when non-zero;
 * 2. else, when the frame is the transpose of the display size (sensor
 *    orientation leaked through), 90° in portrait-primary or landscape-primary
 *    screens and 270° otherwise (direction checked on devices, DEVICE-TESTS.md);
 * 3. else 0.
 */
export function rotationFor(
  frameRotationDeg: number,
  frameW: number,
  frameH: number,
  displayW: number,
  displayH: number,
  screenAngleDeg: number,
): Rotation {
  const fr = normaliseRotation(frameRotationDeg);
  if (fr !== 0) return fr;
  const transposed =
    displayW > 0 && displayH > 0 && frameW !== frameH && frameW === displayH && frameH === displayW;
  if (!transposed) return 0;
  const a = normaliseRotation(screenAngleDeg);
  return a === 0 || a === 90 ? 90 : 270;
}

/**
 * Rotates a w × h gray image clockwise by `rot` into `out` (w·h bytes).
 * Returns the output size [w', h'] (swapped for 90/270).
 */
export function rotateGray(
  src: Uint8Array,
  w: number,
  h: number,
  rot: Rotation,
  out: Uint8Array,
): [number, number] {
  if (rot === 0) {
    out.set(src.subarray(0, w * h));
    return [w, h];
  }
  if (rot === 180) {
    const n = w * h;
    for (let i = 0; i < n; i++) out[i] = src[n - 1 - i]!; // `!`: i < n
    return [w, h];
  }
  // 90° cw: output is h wide, w tall; out(x', y') = src(x = y', y = h − 1 − x')
  // 270° cw: out(x', y') = src(x = w − 1 − y', y = x')
  const ow = h;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const v = src[row + x]!; // `!`: in range by the loop bounds
      if (rot === 90) out[x * ow + (h - 1 - y)] = v;
      else out[(w - 1 - x) * ow + y] = v;
    }
  }
  return [h, w];
}

/**
 * Reads the frame index that `scripts/make-fake-video.ts` writes into test
 * videos (ARCHITECTURE.md §9.2): 16 blocks of 8 × 8 px along the top-left
 * edge, bit 15 first, white = 1. Each block's central 2 × 2 px are averaged;
 * null if any block is ambiguous (64 … 192) or the image is too small.
 */
export function readFrameIndex(gray: Uint8Array, w: number, h: number): number | null {
  const bits = 16;
  const block = 8;
  if (w < bits * block || h < block) return null;
  let v = 0;
  for (let b = 0; b < bits; b++) {
    const x = b * block + 3;
    const i = 3 * w + x;
    const m = (gray[i]! + gray[i + 1]! + gray[i + w]! + gray[i + w + 1]!) / 4; // `!`: inside the strip
    if (m > 64 && m < 192) return null;
    v = (v << 1) | (m >= 128 ? 1 : 0);
  }
  return v;
}
