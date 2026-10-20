/**
 * Main-thread frame grabbing (ARCHITECTURE.md §6.2).
 *
 * - `videoframe` path: `new VideoFrame(video)`, transferred to the worker.
 * - `canvas` path (no `VideoFrame`, or opaque frames the worker can't read):
 *   `drawImage(video)` into a canvas at the video's size → `getImageData` →
 *   luma on the main thread → a transferable gray buffer. Slower (Safari's
 *   fingerprinting protection can make `getImageData` very slow), so it is
 *   only a fallback.
 *
 * `FrameSource` is an interface so tracker tests can fake it.
 */
import { grayFromPacked } from '../worker/gray.js';

export interface GrabbedFrame {
  /** null on the canvas path */
  frame: VideoFrame | null;
  /** set on the canvas path: display-oriented gray, buffer transferred to the worker */
  gray: { width: number; height: number; data: ArrayBuffer } | null;
}

export interface FrameSource {
  readonly path: 'videoframe' | 'canvas';
  grab(video: HTMLVideoElement): GrabbedFrame | null;
  /** a buffer handed back by the worker, for reuse */
  recycle(buf: ArrayBuffer): void;
}

export function videoFrameSource(): FrameSource {
  return {
    path: 'videoframe',
    grab(video) {
      if (!video.videoWidth || !video.videoHeight) return null;
      return { frame: new VideoFrame(video), gray: null };
    },
    recycle() {},
  };
}

export function canvasFrameSource(): FrameSource {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  const spare: ArrayBuffer[] = [];
  return {
    path: 'canvas',
    grab(video) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return null;
      if (!canvas) {
        canvas = document.createElement('canvas');
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      if (!ctx) return null;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(video, 0, 0, w, h);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      let buf = spare.pop();
      if (!buf || buf.byteLength !== w * h) buf = new ArrayBuffer(w * h);
      const src = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
      grayFromPacked(src, { offset: 0, stride: w * 4 }, w, h, 'rgb', new Uint8Array(buf));
      return { frame: null, gray: { width: w, height: h, data: buf } };
    },
    recycle(buf) {
      if (spare.length < 2) spare.push(buf);
    },
  };
}

/** The best source this browser supports. */
export function defaultFrameSource(): FrameSource {
  return typeof VideoFrame === 'function' ? videoFrameSource() : canvasFrameSource();
}
