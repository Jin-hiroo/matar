import { describe, expect, it } from 'vitest';
import type { BoardTag, Vec2 } from '../types.js';
import { createBoard } from './board.js';
import { pickTagIds } from './ids.js';
import { layoutBorderTags, type RectMm } from './layout.js';
import { mulberry32 } from './random.js';

const A4: RectMm = { x: 0, y: 0, width: 210, height: 297 };
const A3: RectMm = { x: 0, y: 0, width: 297, height: 420 };
const IDS = Array.from({ length: 100 }, (_, i) => i);

const page = (t: BoardTag, origin: Vec2): Vec2 => [
  t.centerMm[0] + origin[0],
  t.centerMm[1] + origin[1],
];

/** Footprint (black square + 1-cell ring) of an unrotated tag36h11 tag, page mm. */
function footprint(t: BoardTag, origin: Vec2): RectMm {
  const [x, y] = page(t, origin);
  const h = (t.sizeMm * 10) / 8 / 2;
  return { x: x - h, y: y - h, width: 2 * h, height: 2 * h };
}

/** Overlap of two rectangles' interiors, mm (≤ 0: disjoint or touching). */
function overlapMm(a: RectMm, b: RectMm): number {
  const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.min(ox, oy);
}

/** Smallest gap between two axis-aligned squares' edges (Chebyshev), mm. */
function gapMm(a: RectMm, b: RectMm): number {
  const gx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
  const gy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.max(gx, gy);
}

describe('layoutBorderTags on A4 with 32 mm tags', () => {
  const origin: Vec2 = [105, 148.5];
  const tags = layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: IDS });

  it('places exactly 16 tags: 4 per short edge, 6 per long edge', () => {
    expect(tags).toHaveLength(16);
    const xs = new Set(tags.map((t) => +page(t, origin)[0].toFixed(9)));
    const ys = new Set(tags.map((t) => +page(t, origin)[1].toFixed(9)));
    expect(xs.size).toBe(4);
    expect(ys.size).toBe(6);
  });

  it('goes clockwise from the top-left corner, IDs in order, rotation 0', () => {
    const third = 154 / 3;
    const fifth = 241 / 5;
    const expected: Vec2[] = [
      [28, 28],
      [28 + third, 28],
      [28 + 2 * third, 28],
      [182, 28],
      [182, 28 + fifth],
      [182, 28 + 2 * fifth],
      [182, 28 + 3 * fifth],
      [182, 28 + 4 * fifth],
      [182, 269],
      [28 + 2 * third, 269],
      [28 + third, 269],
      [28, 269],
      [28, 28 + 4 * fifth],
      [28, 28 + 3 * fifth],
      [28, 28 + 2 * fifth],
      [28, 28 + fifth],
    ];
    tags.forEach((t, i) => {
      expect(t.id).toBe(i);
      expect(t.sizeMm).toBe(32);
      expect(t.rotationDeg).toBe(0);
      expect(page(t, origin)[0]).toBeCloseTo(expected[i]![0], 9);
      expect(page(t, origin)[1]).toBeCloseTo(expected[i]![1], 9);
    });
  });

  it('returns board coordinates (page − originMm)', () => {
    expect(tags[0]!.centerMm).toEqual([28 - 105, 28 - 148.5]);
    const atZero = layoutBorderTags({ areaMm: A4, originMm: [0, 0], sizeMm: 32, ids: IDS });
    expect(atZero[0]!.centerMm).toEqual([28, 28]);
  });

  it('keeps footprints ≥ one cell apart, inside the area and ≥ 8 mm from its edge', () => {
    for (let i = 0; i < tags.length; i++) {
      const a = footprint(tags[i]!, origin);
      expect(a.x).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(a.y).toBeGreaterThanOrEqual(8 - 1e-9);
      expect(a.x + a.width).toBeLessThanOrEqual(210 - 8 + 1e-9);
      expect(a.y + a.height).toBeLessThanOrEqual(297 - 8 + 1e-9);
      for (let j = i + 1; j < tags.length; j++) {
        expect(gapMm(a, footprint(tags[j]!, origin))).toBeGreaterThanOrEqual(4 - 1e-9);
      }
    }
    expect(() => createBoard({ tags })).not.toThrow();
  });

  it('is deterministic', () => {
    expect(layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: IDS })).toEqual(tags);
  });

  it('ignores a 100 × 80 mm keep-out at the centre', () => {
    const keepOutMm = [{ x: 55, y: 108.5, width: 100, height: 80 }];
    expect(
      layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: IDS, keepOutMm }),
    ).toEqual(tags);
  });

  it('drops the positions a keep-out over the top-left corner touches, without using IDs', () => {
    // 50 × 50 covers only the corner tag (footprint 8…48); the next tags start at
    // 59.3 (top edge) and 56.2 (left edge)
    const one = layoutBorderTags({
      areaMm: A4,
      originMm: origin,
      sizeMm: 32,
      ids: IDS,
      keepOutMm: [{ x: 0, y: 0, width: 50, height: 50 }],
    });
    expect(one).toHaveLength(15);
    expect(one.map((t) => t.id)).toEqual(IDS.slice(0, 15));
    expect(one.map((t) => t.centerMm)).toEqual(tags.slice(1).map((t) => t.centerMm));
    // 60 × 60 also covers the second tag of the top and of the left edge
    const three = layoutBorderTags({
      areaMm: A4,
      originMm: origin,
      sizeMm: 32,
      ids: IDS,
      keepOutMm: [{ x: 0, y: 0, width: 60, height: 60 }],
    });
    expect(three).toHaveLength(13);
    expect(three.map((t) => t.id)).toEqual(IDS.slice(0, 13));
    const kept = tags.filter((_, i) => i !== 0 && i !== 1 && i !== 15);
    expect(three.map((t) => t.centerMm)).toEqual(kept.map((t) => t.centerMm));
  });

  it('drops a position whose footprint only touches a keep-out', () => {
    // the top-left footprint spans 8…48 mm
    const touching = [{ x: 48, y: 48, width: 5, height: 5 }];
    const near = [{ x: 48.001, y: 48.001, width: 5, height: 5 }];
    const base = { areaMm: A4, originMm: origin, sizeMm: 32, ids: IDS };
    expect(layoutBorderTags({ ...base, keepOutMm: touching }).map((t) => t.centerMm)).toEqual(
      tags.slice(1).map((t) => t.centerMm),
    );
    expect(layoutBorderTags({ ...base, keepOutMm: near })).toEqual(tags);
  });

  it('stops when the IDs run out', () => {
    const few = layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: [9, 4, 7] });
    expect(few.map((t) => t.id)).toEqual([9, 4, 7]);
    expect(few.map((t) => t.centerMm)).toEqual(tags.slice(0, 3).map((t) => t.centerMm));
    expect(layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: [] })).toEqual([]);
  });
});

describe('layoutBorderTags options and errors', () => {
  it('uses minGapMm when it is more than one cell', () => {
    // 32 mm: pitch 40 + 20 = 60; A4 short edge span 154 → 2 gaps → 3 tags
    const tags = layoutBorderTags({
      areaMm: A4,
      originMm: [0, 0],
      sizeMm: 32,
      minGapMm: 20,
      ids: IDS,
    });
    const top = tags.filter((t) => t.centerMm[1] === 28).map((t) => t.centerMm[0]);
    expect(top).toEqual([28, 105, 182]);
  });

  it('takes marginMm from the area edge to the white ring', () => {
    const tags = layoutBorderTags({
      areaMm: { x: 10, y: 20, width: 200, height: 100 },
      originMm: [0, 0],
      sizeMm: 16,
      marginMm: 3,
      ids: IDS,
    });
    // footprint 20 mm: first centre 10 + 3 + 10
    expect(tags[0]!.centerMm).toEqual([23, 33]);
  });

  it('fits exactly the 4 corners in the minimum area and throws below it', () => {
    // 2·8 + 2·40 + 4 = 100 mm
    const square = { x: 0, y: 0, width: 100, height: 100 };
    const tags = layoutBorderTags({ areaMm: square, originMm: [0, 0], sizeMm: 32, ids: IDS });
    expect(tags.map((t) => t.centerMm)).toEqual([
      [28, 28],
      [72, 28],
      [72, 72],
      [28, 72],
    ]);
    expect(() =>
      layoutBorderTags({
        areaMm: { x: 0, y: 0, width: 99.9, height: 300 },
        originMm: [0, 0],
        sizeMm: 32,
        ids: IDS,
      }),
    ).toThrow(/too small for the 4 corner tags.*needs at least 100 × 100 mm/);
  });

  it('rejects bad options', () => {
    const base = { areaMm: A4, originMm: [0, 0] as Vec2, sizeMm: 32, ids: IDS };
    expect(() => layoutBorderTags({ ...base, sizeMm: 0 })).toThrow(/sizeMm/);
    expect(() => layoutBorderTags({ ...base, marginMm: -1 })).toThrow(/marginMm/);
    expect(() => layoutBorderTags({ ...base, minGapMm: NaN })).toThrow(/minGapMm/);
    expect(() => layoutBorderTags({ ...base, ids: [1, 2, 1] })).toThrow(/duplicate.*1/);
    expect(() => layoutBorderTags({ ...base, ids: [1, 600] })).toThrow(/600/);
    expect(() => layoutBorderTags({ ...base, family: 'tag0' })).toThrow(/tag0/);
    expect(() =>
      layoutBorderTags({ ...base, keepOutMm: [{ x: 0, y: 0, width: -1, height: 1 }] }),
    ).toThrow(/keepOutMm\[0\]/);
  });
});

describe('inner ring around an object footprint (second call)', () => {
  /** Area for an inner ring of `sizeMm` tags around `fp` with `clearMm` to the object. */
  const ringAround = (fp: RectMm, sizeMm: number, clearMm: number): RectMm => {
    const grow = (sizeMm * 10) / 8 + clearMm;
    return {
      x: fp.x - grow,
      y: fp.y - grow,
      width: fp.width + 2 * grow,
      height: fp.height + 2 * grow,
    };
  };

  function check(pageMm: RectMm, fp: RectMm) {
    const origin: Vec2 = [pageMm.width / 2, pageMm.height / 2];
    const ids = pickTagIds('tag36h11', 80, 'inner-ring-test');
    const outer = layoutBorderTags({ areaMm: pageMm, originMm: origin, sizeMm: 32, ids });
    const inner = layoutBorderTags({
      areaMm: ringAround(fp, 20, 2.5),
      marginMm: 0,
      originMm: origin,
      sizeMm: 20,
      ids: ids.slice(outer.length),
      keepOutMm: [fp],
    });
    expect(inner.length).toBeGreaterThanOrEqual(4);
    // none on the object (the keep-out would have dropped them; check directly)
    for (const t of inner) expect(overlapMm(footprint(t, origin), fp)).toBeLessThanOrEqual(1e-9);
    // rings don't overlap each other, and keep at least one 32 mm cell (4 mm) apart
    let minGap = Infinity;
    for (const a of outer) {
      for (const b of inner) {
        minGap = Math.min(minGap, gapMm(footprint(a, origin), footprint(b, origin)));
      }
    }
    expect(minGap).toBeGreaterThan(4);
    expect(() => createBoard({ tags: [...outer, ...inner] })).not.toThrow();
    return { outer, inner, minGap };
  }

  it('fits 20 mm tags around a 120 × 90 mm footprint inside an A3 border ring', () => {
    const fp = { x: (297 - 120) / 2, y: (420 - 90) / 2, width: 120, height: 90 };
    const { outer, inner } = check(A3, fp);
    expect(outer).toHaveLength(26);
    expect(inner).toHaveLength(18);
  });

  it('fits 20 mm tags around a 50 × 100 mm footprint inside an A4 border ring', () => {
    const fp = { x: 80, y: 98.5, width: 50, height: 100 };
    const { outer, inner } = check(A4, fp);
    expect(outer).toHaveLength(16);
    expect(inner).toHaveLength(12);
  });

  it('cannot fit an inner ring around 120 × 90 mm on A4 (interior is 114 × 201 mm)', () => {
    const origin: Vec2 = [105, 148.5];
    const outer = layoutBorderTags({ areaMm: A4, originMm: origin, sizeMm: 32, ids: IDS });
    const fp = { x: 45, y: 103.5, width: 120, height: 90 };
    const inner = layoutBorderTags({
      areaMm: ringAround(fp, 20, 2.5),
      marginMm: 0,
      originMm: origin,
      sizeMm: 20,
      ids: IDS.slice(outer.length),
    });
    expect(() => createBoard({ tags: [...outer, ...inner] })).toThrow(/overlap/);
  });
});

describe('layoutBorderTags property test', () => {
  it('never overlaps, leaves the area or enters a keep-out (300 seeded cases)', () => {
    const rng = mulberry32(20261019);
    const uni = (lo: number, hi: number) => lo + (hi - lo) * rng();
    let placed = 0;
    let dropped = 0;
    for (let n = 0; n < 300; n++) {
      const sizeMm = uni(3, 60);
      const marginMm = rng() < 0.2 ? undefined : uni(0, 20);
      const minGapMm = rng() < 0.4 ? undefined : uni(0, 15);
      const m = marginMm ?? 8;
      const outer = (sizeMm * 10) / 8;
      const gap = Math.max(minGapMm ?? 0, sizeMm / 8);
      const need = 2 * m + 2 * outer + gap;
      const exact = rng() < 0.1;
      const areaMm: RectMm = {
        x: uni(-50, 50),
        y: uni(-50, 50),
        width: exact ? need : need + uni(0, 700),
        height: exact ? need : need + uni(0, 700),
      };
      const keepOutMm: RectMm[] = [];
      const k = Math.floor(uni(0, 5));
      for (let i = 0; i < k; i++) {
        const w = uni(0, areaMm.width * 0.6);
        const h = uni(0, areaMm.height * 0.6);
        keepOutMm.push({
          x: areaMm.x + uni(-0.2, 1) * areaMm.width - w / 2,
          y: areaMm.y + uni(-0.2, 1) * areaMm.height - h / 2,
          width: w,
          height: h,
        });
      }
      const ids = pickTagIds('tag36h11', rng() < 0.2 ? 587 : Math.floor(uni(0, 120)), `prop-${n}`);
      const originMm: Vec2 = [uni(-100, 300), uni(-100, 300)];
      const opts = { areaMm, originMm, sizeMm, marginMm, minGapMm, keepOutMm, ids };
      const tags = layoutBorderTags(opts);
      expect(layoutBorderTags(opts)).toEqual(tags);

      // without keep-outs: every ring position, up to the number of IDs
      const all = layoutBorderTags({
        ...opts,
        keepOutMm: [],
        ids: pickTagIds('tag36h11', 587, 'all'),
      });
      const pitch = outer + gap;
      const nx = Math.floor((areaMm.width - 2 * m - outer) / pitch + 1e-9) + 1;
      const ny = Math.floor((areaMm.height - 2 * m - outer) / pitch + 1e-9) + 1;
      expect(all).toHaveLength(Math.min(587, 2 * nx + 2 * ny - 4));
      placed += tags.length;
      dropped += Math.min(all.length, ids.length) - tags.length;

      expect(tags.map((t) => t.id)).toEqual(ids.slice(0, tags.length));
      const eps = 1e-9 * (1 + Math.abs(areaMm.width) + Math.abs(areaMm.height));
      const feet = tags.map((t) => footprint(t, originMm));
      feet.forEach((f, i) => {
        expect(tags[i]!.sizeMm).toBe(sizeMm);
        expect(tags[i]!.rotationDeg).toBe(0);
        expect(f.x).toBeGreaterThanOrEqual(areaMm.x + m - eps);
        expect(f.y).toBeGreaterThanOrEqual(areaMm.y + m - eps);
        expect(f.x + f.width).toBeLessThanOrEqual(areaMm.x + areaMm.width - m + eps);
        expect(f.y + f.height).toBeLessThanOrEqual(areaMm.y + areaMm.height - m + eps);
        for (const r of keepOutMm) expect(overlapMm(f, r)).toBeLessThanOrEqual(eps);
        for (let j = i + 1; j < feet.length; j++) {
          expect(gapMm(f, feet[j]!)).toBeGreaterThanOrEqual(gap - eps);
        }
      });
      if (tags.length > 0) expect(() => createBoard({ tags })).not.toThrow();
    }
    // the cases exercise both placing and dropping
    expect(placed).toBeGreaterThan(1000);
    expect(dropped).toBeGreaterThan(100);
  });
});
