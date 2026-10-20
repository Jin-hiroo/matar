/**
 * `VideoFrame` → gray image, in the worker (ARCHITECTURE.md §6.2).
 *
 * `FrameReader.read(frame, display)`:
 * 1. `allocationSize()` → `copyTo()` into a reused buffer (the frame's
 *    `visibleRect`, native format). For `format === null` (opaque frames) it
 *    asks for `{ format: 'RGBA' }` instead; if the browser can't, it returns
 *    `'opaque'` and the tracker switches to the canvas path.
 * 2. Y plane or packed RGB → gray (src/worker/gray.ts).
 * 3. Rotation to the displayed orientation (`rotationFor`).
 *
 * The returned `GrayImage.data` is a view into a reused buffer: valid until the
 * next `read`. The caller closes the frame.
 */
import type { FrameInfo, GrayImage } from '../types.js';
import {
  grayFromLumaPlane,
  grayFromPacked,
  grayKind,
  rotateGray,
  rotationFor,
  type PlaneLayoutLike,
} from './gray.js';

/** What the reader needs from a `VideoFrame` (structural, so tests can fake it). */
export interface VideoFrameLike {
  readonly format: string | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly visibleRect: { width: number; height: number } | null;
  /** Chrome 138+; absent elsewhere */
  readonly rotation?: number;
  allocationSize(options?: { format?: string }): number;
  copyTo(dest: Uint8Array, options?: { format?: string }): Promise<readonly PlaneLayoutLike[]>;
}

export interface DisplayInfo {
  displayWidth: number;
  displayHeight: number;
  screenAngleDeg: number;
}

export class FrameReader {
  private raw = new Uint8Array(0);
  private gray = new Uint8Array(0);
  private rotated = new Uint8Array(0);

  async read(
    frame: VideoFrameLike,
    display: DisplayInfo,
  ): Promise<{ image: GrayImage; info: FrameInfo } | 'opaque'> {
    let kind = grayKind(frame.format);
    let copyOptions: { format: string } | undefined;
    if (kind === null) {
      kind = 'rgb';
      copyOptions = { format: 'RGBA' };
    }
    let layout: readonly PlaneLayoutLike[];
    try {
      const size = frame.allocationSize(copyOptions);
      if (this.raw.length < size) this.raw = new Uint8Array(size);
      layout = await frame.copyTo(this.raw, copyOptions);
    } catch {
      if (copyOptions) return 'opaque';
      throw new Error(`matar: VideoFrame.copyTo failed for format ${frame.format}`);
    }
    const plane = layout[0];
    if (!plane) throw new Error('matar: VideoFrame.copyTo returned no planes');
    const w = frame.visibleRect?.width ?? frame.codedWidth;
    const h = frame.visibleRect?.height ?? frame.codedHeight;
    const n = w * h;
    if (this.gray.length < n) this.gray = new Uint8Array(n);
    const gray = this.gray.subarray(0, n);
    if (kind === 'luma-plane') grayFromLumaPlane(this.raw, plane, w, h, gray);
    else grayFromPacked(this.raw, plane, w, h, kind, gray);

    const rot = rotationFor(
      frame.rotation ?? 0,
      w,
      h,
      display.displayWidth,
      display.displayHeight,
      display.screenAngleDeg,
    );
    const info: FrameInfo = {
      path: 'videoframe',
      format: frame.format,
      codedWidth: frame.codedWidth,
      codedHeight: frame.codedHeight,
      rotationDeg: rot,
    };
    if (rot === 0) return { image: { width: w, height: h, data: gray }, info };
    if (this.rotated.length < n) this.rotated = new Uint8Array(n);
    const out = this.rotated.subarray(0, n);
    const [rw, rh] = rotateGray(gray, w, h, rot, out);
    return { image: { width: rw, height: rh, data: out }, info };
  }
}
