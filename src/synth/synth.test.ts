import { describe, expect, it } from 'vitest';
import { getFamilyDef, tagCells } from '../tags/index.js';
import type { Board, Mat4, Vec2 } from '../types.js';
import {
  intrinsicsFromFov,
  lookAtPose,
  mulberry32,
  projectBoardCorners,
  projectBoardPoint,
  randomPatches,
  randomViewPose,
  renderBoard,
} from './index.js';
import { familyDistance } from './patches.js';

const K640 = { width: 640, height: 480, fx: 1000, fy: 1000, cx: 319.5, cy: 239.5 };
const ONE_TAG: Board = {
  family: 'tag36h11',
  tags: [{ id: 42, centerMm: [0, 0], sizeMm: 32, rotationDeg: 0 }],
};
// Directly above the origin at 500 mm: 2 px per mm, 8 px per 4 mm cell.
const ABOVE = lookAtPose([0, 500, 0], [0, 0, 0]);

describe('camera helpers', () => {
  it('lookAtPose from above sees the page upright', () => {
    // board +X → image right, board +Z (down the page) → image down
    const c = projectBoardPoint(K640, ABOVE, [0, 0, 0])!;
    const right = projectBoardPoint(K640, ABOVE, [10, 0, 0])!;
    const down = projectBoardPoint(K640, ABOVE, [0, 0, 10])!;
    expect(c[0]).toBeCloseTo(319.5, 9);
    expect(c[1]).toBeCloseTo(239.5, 9);
    expect(right[0] - c[0]).toBeCloseTo(20, 9);
    expect(down[1] - c[1]).toBeCloseTo(20, 9);
  });

  it('projectBoardCorners returns TL, TR, BR, BL clockwise in the image', () => {
    const corners = projectBoardCorners(ONE_TAG, K640, ABOVE).get(42)!;
    expect(corners.map((p) => p.map((v) => +v.toFixed(6)))).toEqual([
      [287.5, 207.5],
      [351.5, 207.5],
      [351.5, 271.5],
      [287.5, 271.5],
    ]);
  });

  it('drops points behind the camera', () => {
    expect(projectBoardPoint(K640, ABOVE, [0, 600, 0])).toBeNull();
  });

  it('randomViewPose keeps the target in view at the requested distance and tilt', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const m = randomViewPose(rng, { distanceMm: [300, 500], tiltDeg: [20, 50] });
      const p = projectBoardPoint(K640, m, [0, 0, 0])!;
      expect(p[0]).toBeCloseTo(319.5, 6);
      expect(p[1]).toBeCloseTo(239.5, 6);
      const d = Math.hypot(m[12]!, m[13]!, m[14]!);
      expect(d).toBeGreaterThanOrEqual(300);
      expect(d).toBeLessThanOrEqual(500);
      const tiltDeg = (Math.acos(m[13]! / d) * 180) / Math.PI;
      expect(tiltDeg).toBeGreaterThanOrEqual(20 - 1e-9);
      expect(tiltDeg).toBeLessThanOrEqual(50 + 1e-9);
    }
  });
});

describe('renderBoard', () => {
  it('reproduces tagCells exactly for an aligned fronto-parallel tag', () => {
    const img = renderBoard({ board: ONE_TAG, intrinsics: K640, boardFromCamera: ABOVE });
    const cells = tagCells('tag36h11', 42);
    // tag spans x 287.5…351.5, y 207.5…271.5: pixels 288…351, 208…271, 8 px per cell
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const want = cells[r * 8 + c] ? 210 : 30;
        for (let dy = 0; dy < 8; dy++) {
          for (let dx = 0; dx < 8; dx++) {
            expect(img.data[(208 + r * 8 + dy) * 640 + 288 + c * 8 + dx]).toBe(want);
          }
        }
      }
    }
    // white ring and paper around it
    expect(img.data[204 * 640 + 300]).toBe(210);
    expect(img.data[0]).toBe(210);
  });

  it('places tilted edges where the projection says (coverage within 0.02 px on average)', () => {
    // a big ink rectangle, linear encoding, no blur: coverage per row = ink width at the row centre.
    // 16 × 16 samples so quantisation stays well under the target (8 × 8 gives ≈ 0.02 px).
    const board: Board = { family: 'tag36h11', tags: [] };
    const rect = { centerMm: [0, 0] as Vec2, sizeMm: [120, 80] as Vec2, rotationDeg: 17 };
    const k = intrinsicsFromFov(640, 480, 65);
    const errs: number[] = [];
    const rng = mulberry32(3);
    for (let trial = 0; trial < 5; trial++) {
      const m = randomViewPose(rng, {
        distanceMm: [350, 450],
        tiltDeg: [25, 45],
        rollDeg: [0, 360],
      });
      const img = renderBoard({
        board,
        intrinsics: k,
        boardFromCamera: m,
        patches: [rect],
        gamma: 1,
        inkLevel: 0,
        paperLevel: 255,
        supersample: 16,
      });
      const poly = rectCornersMm(rect).map((c) => projectBoardPoint(k, m, [c[0], 0, c[1]])!);
      for (let y = 20; y < 460; y += 3) {
        const span = polygonSpanAtRow(poly, y);
        if (!span || span[0] < 2 || span[1] > 637 || nearVertex(poly, y)) continue;
        let coverage = 0;
        for (let x = 0; x < 640; x++) coverage += 1 - img.data[y * 640 + x]! / 255;
        errs.push(coverage - (span[1] - span[0]));
      }
    }
    expect(errs.length).toBeGreaterThan(200);
    const abs = errs.map(Math.abs);
    const bias = errs.reduce((a, b) => a + b, 0) / errs.length;
    expect(Math.abs(bias)).toBeLessThan(0.005); // no half-pixel or scale error
    expect(abs.reduce((a, b) => a + b, 0) / abs.length).toBeLessThan(0.02);
    expect(Math.max(...abs)).toBeLessThan(0.07);
  });

  it('is deterministic per seed', () => {
    const o = {
      board: ONE_TAG,
      intrinsics: K640,
      boardFromCamera: ABOVE,
      noiseSigma: 3,
      blurSigmaPx: 1,
    };
    const a = renderBoard({ ...o, seed: 5 });
    const b = renderBoard({ ...o, seed: 5 });
    const c = renderBoard({ ...o, seed: 6 });
    expect(Buffer.from(a.data).equals(Buffer.from(b.data))).toBe(true);
    expect(Buffer.from(a.data).equals(Buffer.from(c.data))).toBe(false);
  });

  it('renders background beyond the page and above the horizon', () => {
    const sideways = lookAtPose([0, 50, 600], [0, 50, 0], [0, 1, 0]); // looking along −Z, level
    const img = renderBoard({
      board: ONE_TAG,
      intrinsics: K640,
      boardFromCamera: sideways,
      pageMm: { min: [-105, -148.5], max: [105, 148.5] },
    });
    expect(img.data[10 * 640 + 320]).toBe(90); // sky
    const pageCut = renderBoard({
      board: ONE_TAG,
      intrinsics: K640,
      boardFromCamera: lookAtPose([0, 300, 0], [0, 0, 0]),
      pageMm: { min: [-50, -50], max: [50, 50] },
    });
    expect(pageCut.data[5 * 640 + 5]).toBe(90);
  });

  it('averages poses for motion blur', () => {
    const shifted: Mat4 = Float64Array.from(ABOVE);
    shifted[12] = 1; // 1 mm = 2 px to the right
    const img = renderBoard({
      board: ONE_TAG,
      intrinsics: K640,
      boardFromCamera: [ABOVE, shifted],
    });
    // pixels 286–287 are white ring in one pose and black border in the other
    const v = img.data[240 * 640 + 287]!;
    expect(v).toBeGreaterThan(30);
    expect(v).toBeLessThan(210);
  });

  it('renders 1280 × 720 with clutter in reasonable time', () => {
    const tags = Array.from({ length: 12 }, (_, i) => ({
      id: i,
      centerMm: [-80 + (i % 6) * 32, i < 6 ? -110 : 110] as Vec2,
      sizeMm: 24,
      rotationDeg: 0,
    }));
    const board: Board = { family: 'tag36h11', tags };
    const rng = mulberry32(11);
    const patches = randomPatches(rng, {
      areaMm: { min: [-100, -140], max: [100, 140] },
      count: 40,
      avoid: board,
    });
    const k = intrinsicsFromFov(1280, 720, 68);
    const t0 = performance.now();
    const img = renderBoard({
      board,
      intrinsics: k,
      boardFromCamera: lookAtPose([60, 380, 260], [0, 0, 0]),
      patches,
      blurSigmaPx: 1,
      noiseSigma: 2,
    });
    const ms = performance.now() - t0;
    expect(img.data.length).toBe(1280 * 720);
    expect(patches.length).toBe(40);
    expect(ms).toBeLessThan(3000);
  });
});

describe('randomPatches', () => {
  it('keeps tag-like squares ≥ 5 bits from every tag36h11 code in every rotation', () => {
    const def = getFamilyDef('tag36h11');
    // sanity: a real tag, rotated or not, is at distance 0
    expect(familyDistance(def, tagCells('tag36h11', 42))).toBe(0);
    const patches = randomPatches(mulberry32(5), {
      areaMm: { min: [-100, -140], max: [100, 140] },
      count: 300,
    });
    const squares = patches.filter((p) => p.cells);
    expect(squares.length).toBeGreaterThan(50);
    for (const p of squares) expect(familyDistance(def, p.cells!)).toBeGreaterThanOrEqual(5);
  });
});

function rectCornersMm(r: { centerMm: Vec2; sizeMm: Vec2; rotationDeg: number }): Vec2[] {
  const c = Math.cos((r.rotationDeg * Math.PI) / 180);
  const s = Math.sin((r.rotationDeg * Math.PI) / 180);
  const hw = r.sizeMm[0] / 2;
  const hh = r.sizeMm[1] / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => [r.centerMm[0] + x! * c - y! * s, r.centerMm[1] + x! * s + y! * c]);
}

/** [xmin, xmax] of a convex polygon at image row y, or null. */
function polygonSpanAtRow(poly: Vec2[], y: number): [number, number] | null {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
      xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
  }
  return xs.length === 2 ? [Math.min(xs[0]!, xs[1]!), Math.max(xs[0]!, xs[1]!)] : null;
}

function nearVertex(poly: Vec2[], y: number): boolean {
  return poly.some((p) => Math.abs(p[1] - y) < 1.5);
}
