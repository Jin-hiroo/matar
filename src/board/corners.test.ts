import { describe, expect, it } from 'vitest';
import type { BoardTag } from '../types.js';
import { boardTagCornersMm } from './corners.js';

const round = (pts: number[][]) => pts.map((p) => p.map((v) => +v.toFixed(9) + 0));

describe('boardTagCornersMm', () => {
  const tag = (rotationDeg: number): BoardTag => ({
    id: 0,
    centerMm: [100, 50],
    sizeMm: 20,
    rotationDeg,
  });

  it('returns TL, TR, BR, BL for an unrotated tag (page y down = board z)', () => {
    expect(round(boardTagCornersMm(tag(0)))).toEqual([
      [90, 40],
      [110, 40],
      [110, 60],
      [90, 60],
    ]);
  });

  it('rotates clockwise on the page like SVG rotate()', () => {
    // after 90° clockwise the printed TL corner sits at the top-right
    expect(round(boardTagCornersMm(tag(90)))).toEqual([
      [110, 40],
      [110, 60],
      [90, 60],
      [90, 40],
    ]);
    expect(round(boardTagCornersMm(tag(180)))[0]).toEqual([110, 60]);
    expect(round(boardTagCornersMm(tag(270)))[0]).toEqual([90, 60]);
  });

  it('keeps the corners clockwise seen from +Y for any rotation', () => {
    for (const deg of [0, 30, 90, 135, 200, 330]) {
      const c = boardTagCornersMm(tag(deg));
      // signed area in (x right, z down) axes: positive = clockwise on screen
      let area = 0;
      for (let i = 0; i < 4; i++) {
        const a = c[i]!;
        const b = c[(i + 1) % 4]!;
        area += a[0] * b[1] - b[0] * a[1];
      }
      expect(area / 2).toBeCloseTo(400, 9);
    }
  });
});

describe('boardTagCornersMm at 30°', () => {
  it('turns TL clockwise on the page about the centre', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const corners = boardTagCornersMm({ id: 0, centerMm: [100, 50], sizeMm: 20, rotationDeg: 30 });
    // §2.3: x' = x cos θ − y sin θ, z' = x sin θ + y cos θ applied to (−10, −10)
    expect(corners[0][0]).toBeCloseTo(100 + -10 * c + 10 * s, 12);
    expect(corners[0][1]).toBeCloseTo(50 + -10 * s - 10 * c, 12);
    // TL moved right of the unrotated TL (90, 40) and up: clockwise
    expect(corners[0][0]).toBeGreaterThan(90);
    expect(corners[0][1]).toBeLessThan(40);
    expect(corners[2][0]).toBeCloseTo(200 - corners[0][0], 12);
    expect(corners[2][1]).toBeCloseTo(100 - corners[0][1], 12);
  });
});
