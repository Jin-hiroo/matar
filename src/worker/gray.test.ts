import { describe, expect, it } from 'vitest';
import {
  grayFromLumaPlane,
  grayFromPacked,
  grayKind,
  normaliseRotation,
  readFrameIndex,
  rotateGray,
  rotationFor,
} from './gray.js';

/** w × h image whose pixel (x, y) = (y · w + x) mod 251 (distinct enough to catch index errors). */
function pattern(w: number, h: number): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let i = 0; i < a.length; i++) a[i] = i % 251;
  return a;
}

describe('grayKind', () => {
  it('maps planar YUV to the luma plane and packed RGB by channel order', () => {
    for (const f of ['I420', 'I420A', 'I422', 'I444', 'NV12'])
      expect(grayKind(f)).toBe('luma-plane');
    expect(grayKind('RGBA')).toBe('rgb');
    expect(grayKind('RGBX')).toBe('rgb');
    expect(grayKind('BGRA')).toBe('bgr');
    expect(grayKind('BGRX')).toBe('bgr');
    expect(grayKind(null)).toBeNull();
    expect(grayKind('I420P10')).toBeNull();
  });
});

describe('grayFromLumaPlane', () => {
  it('copies a tight plane', () => {
    const src = pattern(6, 4);
    const out = new Uint8Array(24);
    grayFromLumaPlane(src, { offset: 0, stride: 6 }, 6, 4, out);
    expect(out).toEqual(src);
  });

  it('honours offset and stride (padding bytes ignored)', () => {
    const w = 5;
    const h = 3;
    const stride = 8;
    const offset = 7;
    const img = pattern(w, h);
    const src = new Uint8Array(offset + stride * h + 16).fill(255);
    for (let y = 0; y < h; y++) src.set(img.subarray(y * w, y * w + w), offset + y * stride);
    const out = new Uint8Array(w * h);
    grayFromLumaPlane(src, { offset, stride }, w, h, out);
    expect(out).toEqual(img);
  });
});

describe('grayFromPacked', () => {
  it('computes (77 R + 150 G + 29 B) >> 8 in both channel orders with stride', () => {
    const w = 3;
    const h = 2;
    const stride = 16; // 12 bytes of pixels + 4 padding
    const rgb = [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 255],
      [10, 20, 30],
      [0, 0, 0],
    ];
    const expected = rgb.map(([r, g, b]) => (77 * r! + 150 * g! + 29 * b!) >> 8);
    for (const order of ['rgb', 'bgr'] as const) {
      const src = new Uint8Array(4 + stride * h).fill(9);
      rgb.forEach(([r, g, b], i) => {
        const s = 4 + Math.floor(i / w) * stride + (i % w) * 4;
        src[s] = order === 'rgb' ? r! : b!;
        src[s + 1] = g!;
        src[s + 2] = order === 'rgb' ? b! : r!;
        src[s + 3] = 255;
      });
      const out = new Uint8Array(w * h);
      grayFromPacked(src, { offset: 4, stride }, w, h, order, out);
      expect(Array.from(out)).toEqual(expected);
    }
  });
});

describe('rotation', () => {
  it('normalises angles', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
    expect(normaliseRotation(45)).toBe(0);
    expect(normaliseRotation(Number.NaN)).toBe(0);
  });

  it('rotateGray: 90° cw moves the top-left pixel to the top-right; 4 × 90° is identity', () => {
    const w = 4;
    const h = 3;
    const src = pattern(w, h);
    const a = new Uint8Array(w * h);
    expect(rotateGray(src, w, h, 90, a)).toEqual([3, 4]);
    expect(a[0 * 3 + 2]).toBe(src[0]); // (0, 0) → (h − 1, 0)
    expect(a[3 * 3 + 2]).toBe(src[3]); // (w − 1, 0) → (h − 1, w − 1)
    expect(a[0]).toBe(src[(h - 1) * w]); // (0, h − 1) → (0, 0)
    // 270 is the inverse of 90; 180 twice is identity
    const b = new Uint8Array(w * h);
    rotateGray(a, 3, 4, 270, b);
    expect(b).toEqual(src);
    const c = new Uint8Array(w * h);
    const d = new Uint8Array(w * h);
    rotateGray(src, w, h, 180, c);
    rotateGray(c, w, h, 180, d);
    expect(d).toEqual(src);
    expect(c[0]).toBe(src[w * h - 1]);
    // four quarter turns
    let cur = src;
    let cw = w;
    let ch = h;
    for (let k = 0; k < 4; k++) {
      const next = new Uint8Array(w * h);
      [cw, ch] = rotateGray(cur, cw, ch, 90, next);
      cur = next;
    }
    expect([cw, ch]).toEqual([w, h]);
    expect(cur).toEqual(src);
  });

  it('rotationFor prefers frame.rotation, then a transposed frame, else 0', () => {
    expect(rotationFor(90, 1280, 720, 720, 1280, 0)).toBe(90);
    expect(rotationFor(270, 1280, 720, 1280, 720, 0)).toBe(270);
    expect(rotationFor(0, 1280, 720, 1280, 720, 0)).toBe(0);
    expect(rotationFor(0, 1280, 720, 720, 1280, 0)).toBe(90);
    expect(rotationFor(0, 1280, 720, 720, 1280, 180)).toBe(270);
    expect(rotationFor(0, 720, 720, 720, 720, 0)).toBe(0); // square: can't tell
    expect(rotationFor(0, 1280, 720, 0, 0, 0)).toBe(0); // display size unknown
  });
});

describe('readFrameIndex', () => {
  function stripImage(w: number, h: number, index: number, bg = 90): Uint8Array {
    const g = new Uint8Array(w * h).fill(bg);
    for (let b = 0; b < 16; b++) {
      const v = (index >> (15 - b)) & 1 ? 255 : 0;
      for (let y = 0; y < 8; y++) g.fill(v, y * w + b * 8, y * w + b * 8 + 8);
    }
    return g;
  }

  it('reads the 16-bit index written by the fake-video script', () => {
    for (const i of [0, 1, 89, 0x8000, 0xffff, 12345]) {
      expect(readFrameIndex(stripImage(640, 480, i), 640, 480)).toBe(i);
    }
  });

  it('returns null without a strip or for tiny images', () => {
    expect(readFrameIndex(new Uint8Array(640 * 480).fill(128), 640, 480)).toBeNull();
    expect(readFrameIndex(new Uint8Array(100 * 100), 100, 100)).toBeNull();
  });
});
