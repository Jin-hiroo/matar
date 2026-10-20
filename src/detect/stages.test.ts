import { describe, expect, it } from 'vitest';
import { mulberry32, normalSampler } from '../synth/random.js';
import { BorderFollower } from './contours.js';
import { squareToQuad } from './homography.js';
import { QuadFitter } from './quad.js';
import {
  BLACK,
  UNKNOWN,
  WHITE,
  adaptiveThreshold,
  decimate2x2,
  thresholdScratchSize,
} from './threshold.js';

function scratch(w: number, h: number) {
  const n = thresholdScratchSize(w, h);
  return {
    tileMin: new Uint8Array(n),
    tileMax: new Uint8Array(n),
    dilMin: new Uint8Array(n),
    dilMax: new Uint8Array(n),
  };
}

/** Thresholds `img` and returns the unpadded labels row by row. */
function labels(
  img: Uint8Array,
  w: number,
  h: number,
  minContrast = 10,
  blockExtrema = false,
): number[][] {
  const out = new Uint8Array((w + 2) * (h + 2));
  adaptiveThreshold(img, w, h, minContrast, out, scratch(w, h), blockExtrema);
  const rows: number[][] = [];
  for (let y = 0; y < h; y++)
    rows.push(Array.from(out.subarray((y + 1) * (w + 2) + 1, (y + 1) * (w + 2) + 1 + w)));
  return rows;
}

/** Binary picture from text ('#' = black) as a padded label buffer. */
function padded(rows: string[]): { img: Uint8Array; w: number; h: number } {
  const h = rows.length;
  const w = rows[0]!.length;
  const img = new Uint8Array((w + 2) * (h + 2)).fill(WHITE);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (rows[y]![x] === '#') img[(y + 1) * (w + 2) + x + 1] = BLACK;
  }
  return { img, w, h };
}

function outerBorders(rows: string[]): [number, number][][] {
  const { img, w, h } = padded(rows);
  const f = new BorderFollower(w, h);
  const res: [number, number][][] = [];
  f.run(img, 1, (xs, ys, n) => {
    const pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([xs[i]!, ys[i]!]);
    res.push(pts);
  });
  return res;
}

describe('decimate2x2', () => {
  it('averages 2 × 2 blocks with rounding and drops an odd last row/column', () => {
    const src = Uint8Array.of(0, 1, 10, 20, 99, 2, 3, 30, 41, 99, 7, 7, 7, 7, 7);
    const out = new Uint8Array(2);
    decimate2x2(src, 5, 3, out);
    expect(Array.from(out)).toEqual([2, 25]); // (0+1+2+3+2)>>2, (10+20+30+41+2)>>2
  });
});

describe('adaptiveThreshold', () => {
  it('labels a flat image unknown', () => {
    const rows = labels(new Uint8Array(12 * 9).fill(128), 12, 9);
    expect(rows.flat().every((v) => v === UNKNOWN)).toBe(true);
  });

  it('splits a step at the midpoint of the local extrema', () => {
    const w = 16;
    const h = 8;
    const img = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = x < 8 ? 40 : 200;
    const rows = labels(img, w, h);
    // tiles 1 and 2 have the step in their 3 × 3 neighbourhood; tiles 0 and 3 don't
    expect(rows[3]).toEqual([
      ...Array(4).fill(UNKNOWN),
      ...Array(4).fill(BLACK),
      ...Array(4).fill(WHITE),
      ...Array(4).fill(UNKNOWN),
    ]);
  });

  it('marks pixels far from any edge unknown and respects minContrast', () => {
    const w = 32;
    const h = 4;
    const img = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = x < 16 ? 40 : 200;
    const rows = labels(img, w, h);
    expect(rows[0]![0]).toBe(UNKNOWN); // tiles 0–1 see only 40
    expect(rows[0]![8]).toBe(UNKNOWN); // tile 2 sees tiles 1–3: all 40
    expect(rows[0]![12]).toBe(BLACK); // tile 3 sees the step
    expect(rows[0]![19]).toBe(WHITE); // tile 4 sees the step
    expect(rows[0]![20]).toBe(UNKNOWN); // tile 5 sees tiles 4–6: all 200
    const low = labels(
      img.map((v) => (v === 200 ? 45 : v)),
      w,
      h,
      10,
    );
    expect(low.flat().every((v) => v === UNKNOWN)).toBe(true);
  });

  it('with block extrema, keeps noisy flat paper unknown and real steps unchanged', () => {
    const w = 64;
    const h = 64;
    const rng = mulberry32(11);
    const gauss = normalSampler(rng);
    const flat = new Uint8Array(w * h).map(() => Math.round(200 + 3 * gauss()));
    const pixel = labels(flat, w, h, 15).flat();
    const block = labels(flat, w, h, 15, true).flat();
    expect(pixel.filter((v) => v !== UNKNOWN).length).toBeGreaterThan(500); // speckle
    expect(block.every((v) => v === UNKNOWN)).toBe(true);
    // a noisy step: same labels within a tile of the edge
    const step = flat.map((v, i) => (i % w < 30 ? v - 160 : v));
    const a = labels(step, w, h, 15);
    const b = labels(step, w, h, 15, true);
    for (let y = 0; y < h; y++)
      expect(b[y]!.slice(24, 36), `row ${y}`).toEqual(a[y]!.slice(24, 36));
  });

  it('writes a white frame around the labels and handles partial tiles', () => {
    const w = 7;
    const h = 5;
    const img = new Uint8Array(w * h).map((_, i) => (i % 2 ? 0 : 255));
    const out = new Uint8Array((w + 2) * (h + 2)).fill(1);
    adaptiveThreshold(img, w, h, 10, out, scratch(w, h));
    for (let x = 0; x < w + 2; x++) {
      expect(out[x]).toBe(WHITE);
      expect(out[(h + 1) * (w + 2) + x]).toBe(WHITE);
    }
    for (let y = 0; y < h + 2; y++) {
      expect(out[y * (w + 2)]).toBe(WHITE);
      expect(out[y * (w + 2) + w + 1]).toBe(WHITE);
    }
    expect(out[1 * (w + 2) + 1]).toBe(WHITE); // pixel (0, 0) = 255
    expect(out[1 * (w + 2) + 2]).toBe(BLACK); // pixel (1, 0) = 0
  });
});

describe('BorderFollower', () => {
  it('reports outer borders only, counter-clockwise, once each', () => {
    const borders = outerBorders([
      '..........',
      '.######...',
      '.#....#...',
      '.#.##.#...',
      '.#.##.#...',
      '.#....#...',
      '.######...',
      '..........',
      '.......##.',
      '..........',
    ]);
    // the ring's outer border, the 2 × 2 block inside its hole, and the small bar
    expect(borders.length).toBe(3);
    const [ring, block, bar] = borders;
    expect(ring!.length).toBe(20);
    expect(ring![0]).toEqual([1, 1]);
    expect(ring![1]).toEqual([1, 2]); // goes down first: counter-clockwise on screen
    expect(block).toEqual([
      [3, 3],
      [3, 4],
      [4, 4],
      [4, 3],
    ]);
    expect(bar).toEqual([
      [7, 8],
      [8, 8],
    ]);
  });

  it('skips borders touching the image edge', () => {
    expect(outerBorders(['##....', '##....', '......', '...##.', '...##.', '......']).length).toBe(
      1,
    );
  });

  it('follows 8-connected diagonals and single pixels', () => {
    const borders = outerBorders([
      '......',
      '.#....',
      '..#...',
      '...#..',
      '......',
      '....#.',
      '......',
    ]);
    expect(borders.length).toBe(1); // the diagonal; the isolated pixel records nothing
    expect(borders[0]).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
      [2, 2],
    ]);
  });
});

describe('QuadFitter', () => {
  /** Rasterises a convex polygon (pixel centres inside) as a padded label image. */
  function rasterise(poly: [number, number][], w: number, h: number) {
    const rows: string[] = [];
    for (let y = 0; y < h; y++) {
      let row = '';
      for (let x = 0; x < w; x++) {
        let inside = true;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i]!;
          const b = poly[(i + 1) % poly.length]!;
          if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) inside = false;
        }
        row += inside ? '#' : '.';
      }
      rows.push(row);
    }
    return padded(rows);
  }

  function fitAll(poly: [number, number][], w: number, h: number, decimate = 1): Float64Array[] {
    const { img } = rasterise(poly, w, h);
    const f = new BorderFollower(w, h);
    const fitter = new QuadFitter(f.maxPoints);
    const res: Float64Array[] = [];
    f.run(img, 8, (xs, ys, n) => {
      const out = new Float64Array(8);
      if (fitter.fit(xs, ys, n, { minPerimeterPx: 32, minSidePx: 8, decimate }, out)) res.push(out);
    });
    return res;
  }

  it('fits a rotated square, clockwise, within a pixel of its corners', () => {
    // clockwise on screen (y down)
    const poly: [number, number][] = [
      [20, 8],
      [52, 20],
      [40, 52],
      [8, 40],
    ];
    const quads = fitAll(poly, 64, 64);
    expect(quads.length).toBe(1);
    const q = quads[0]!;
    // find the corner nearest poly[0], then check the clockwise order
    const start = [0, 1, 2, 3].reduce((best, i) =>
      Math.hypot(q[2 * i]! - 20, q[2 * i + 1]! - 8) <
      Math.hypot(q[2 * best]! - 20, q[2 * best + 1]! - 8)
        ? i
        : best,
    );
    for (let i = 0; i < 4; i++) {
      const c = poly[i]!;
      const j = (start + i) & 3;
      expect(Math.hypot(q[2 * j]! - c[0], q[2 * j + 1]! - c[1])).toBeLessThan(1);
    }
  });

  it('maps decimated corners to full resolution with (p + 0.5)·2 − 0.5', () => {
    const poly: [number, number][] = [
      [10, 10],
      [40, 10],
      [40, 40],
      [10, 40],
    ];
    const one = fitAll(poly, 52, 52, 1)[0]!;
    const two = fitAll(poly, 52, 52, 2)[0]!;
    for (let i = 0; i < 8; i++) expect(two[i]).toBeCloseTo((one[i]! + 0.5) * 2 - 0.5, 9);
  });

  it('drops a mid-edge vertex left by far-point seeding (adjacent seed corners)', () => {
    // As in two tags missed in a D3 run: the contour starts near TR, the
    // farthest point from it is BL, and the farthest from BL is the adjacent BR.
    // Douglas–Peucker then splits the top edge at a 1 px bump mid-way.
    const ccw: [number, number][] = [
      [6, 0], // TL
      [0, 30], // BL
      [55, 30], // BR
      [40, 0], // TR
      [30, -1], // bump on the top edge
    ];
    const pts: [number, number][] = [];
    for (let i = 0; i < ccw.length; i++) {
      const a = ccw[i]!;
      const b = ccw[(i + 1) % ccw.length]!;
      const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      for (let s = 0; s < steps; s++) {
        pts.push([
          Math.round(a[0] + ((b[0] - a[0]) * s) / steps),
          Math.round(a[1] + ((b[1] - a[1]) * s) / steps),
        ]);
      }
    }
    const start = pts.findIndex((p) => p[0] === 37 && p[1] === 0);
    const order = [...pts.slice(start), ...pts.slice(0, start)];
    const xs = Int32Array.from(order, (p) => p[0]);
    const ys = Int32Array.from(order, (p) => p[1]);
    const out = new Float64Array(8);
    const fitter = new QuadFitter(order.length);
    const opts = { minPerimeterPx: 32, minSidePx: 8, decimate: 1 };
    expect(fitter.fit(xs, ys, order.length, opts, out)).toBe(true);
    // clockwise from TL: TL, TR, BR, BL (a seed for the edge refinement: within 2 px)
    const want = [6, 0, 40, 0, 55, 30, 0, 30];
    const tl = [0, 1, 2, 3].find((i) => Math.hypot(out[2 * i]! - 6, out[2 * i + 1]!) < 2)!;
    for (let i = 0; i < 4; i++) {
      const j = (tl + i) & 3;
      expect(
        Math.hypot(out[2 * j]! - want[2 * i]!, out[2 * j + 1]! - want[2 * i + 1]!),
      ).toBeLessThan(2);
    }
  });

  it('rejects triangles, pentagons, slivers and tiny squares', () => {
    expect(
      fitAll(
        [
          [10, 10],
          [50, 12],
          [30, 50],
        ],
        60,
        60,
      ),
    ).toEqual([]);
    expect(
      fitAll(
        [
          [30, 6],
          [54, 24],
          [44, 52],
          [16, 52],
          [6, 24],
        ],
        60,
        60,
      ),
    ).toEqual([]);
    expect(
      fitAll(
        [
          [5, 20],
          [55, 20],
          [55, 24],
          [5, 24],
        ],
        60,
        60,
      ),
    ).toEqual([]); // 4 px side
    expect(
      fitAll(
        [
          [20, 20],
          [26, 20],
          [26, 26],
          [20, 26],
        ],
        60,
        60,
      ),
    ).toEqual([]); // perimeter < 32
  });
});

describe('squareToQuad', () => {
  it('maps the unit square corners onto the quad', () => {
    const q = Float64Array.of(10, 12, 90, 5, 80, 70, 15, 60);
    const m = new Float64Array(9);
    expect(squareToQuad(q, m)).toBe(true);
    const uv = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    uv.forEach(([u, v], i) => {
      const z = m[6]! * u! + m[7]! * v! + 1;
      expect((m[0]! * u! + m[1]! * v! + m[2]!) / z).toBeCloseTo(q[2 * i]!, 9);
      expect((m[3]! * u! + m[4]! * v! + m[5]!) / z).toBeCloseTo(q[2 * i + 1]!, 9);
    });
  });

  it('rejects a degenerate quad', () => {
    expect(squareToQuad(Float64Array.of(0, 0, 1, 1, 2, 2, 3, 3), new Float64Array(9))).toBe(false);
  });
});
