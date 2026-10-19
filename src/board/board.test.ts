import { describe, expect, it } from 'vitest';
import type { BoardTag } from '../types.js';
import { createBoard, scaleBoard, tagOuterSizeMm } from './board.js';

const tag = (id: number, x: number, z: number, sizeMm = 20, rotationDeg = 0): BoardTag => ({
  id,
  centerMm: [x, z],
  sizeMm,
  rotationDeg,
});

describe('tagOuterSizeMm', () => {
  it('is the black square plus a 1-cell ring on each side (10/8 for tag36h11)', () => {
    expect(tagOuterSizeMm(32)).toBe(40);
    expect(tagOuterSizeMm(20, 'tag36h11')).toBe(25);
  });
});

describe('createBoard', () => {
  it('defaults the family and returns a deep-frozen copy', () => {
    const input = [tag(3, 0, 0), tag(7, 30, 0)];
    const board = createBoard({ tags: input });
    expect(board.family).toBe('tag36h11');
    expect(board.tags).toEqual(input);
    expect(board.tags).not.toBe(input);
    expect(board.tags[0]).not.toBe(input[0]);
    expect(board.tags[0]!.centerMm).not.toBe(input[0]!.centerMm);
    expect(Object.isFrozen(board)).toBe(true);
    expect(Object.isFrozen(board.tags)).toBe(true);
    expect(Object.isFrozen(board.tags[0])).toBe(true);
    expect(Object.isFrozen(board.tags[0]!.centerMm)).toBe(true);
    // the copy doesn't follow later changes to the input
    input[0]!.centerMm[0] = 99;
    expect(board.tags[0]!.centerMm[0]).toBe(0);
  });

  it('rejects an unknown family by name', () => {
    expect(() => createBoard({ family: 'tag99x', tags: [tag(0, 0, 0)] })).toThrow(/tag99x/);
  });

  it('rejects an empty board', () => {
    expect(() => createBoard({ tags: [] })).toThrow(/at least one tag/);
  });

  it('rejects duplicate IDs and names them', () => {
    expect(() =>
      createBoard({ tags: [tag(5, 0, 0), tag(9, 40, 0), tag(5, 80, 0), tag(9, 120, 0)] }),
    ).toThrow(/duplicate tag id\(s\) 5, 9/);
  });

  it('rejects out-of-range and non-integer IDs and names them', () => {
    expect(() => createBoard({ tags: [tag(0, 0, 0), tag(587, 40, 0)] })).toThrow(
      /tag id\(s\) 587 not valid for tag36h11 \(integers 0…586\)/,
    );
    expect(() => createBoard({ tags: [tag(-1, 0, 0), tag(1.5, 40, 0)] })).toThrow(
      /tag id\(s\) -1, 1\.5 not valid/,
    );
  });

  it('rejects sizeMm ≤ 0 or not finite and names the tags', () => {
    expect(() => createBoard({ tags: [tag(1, 0, 0, 0), tag(2, 40, 0, -3)] })).toThrow(
      /sizeMm must be a finite number > 0 \(tag id\(s\) 1, 2\)/,
    );
    expect(() => createBoard({ tags: [tag(4, 0, 0, NaN)] })).toThrow(/tag id\(s\) 4/);
  });

  it('rejects non-finite centres and rotations', () => {
    expect(() => createBoard({ tags: [tag(6, Infinity, 0)] })).toThrow(/centerMm.*tag id\(s\) 6/);
    expect(() => createBoard({ tags: [tag(8, 0, 0, 20, NaN)] })).toThrow(
      /rotationDeg.*tag id\(s\) 8/,
    );
  });

  it('allows footprints that touch and rejects ones that overlap, naming the pair', () => {
    // 20 mm tags have 25 mm footprints: centres 25 mm apart touch
    expect(() => createBoard({ tags: [tag(1, 0, 0), tag(2, 25, 0)] })).not.toThrow();
    expect(() => createBoard({ tags: [tag(1, 0, 0), tag(2, 0, 25)] })).not.toThrow();
    // the white rings overlap even though the black squares (20 mm) don't
    expect(() => createBoard({ tags: [tag(1, 0, 0), tag(2, 24.9, 0)] })).toThrow(
      /tags overlap \(black square \+ 1-cell white ring\): 1 & 2/,
    );
    expect(() =>
      createBoard({ tags: [tag(1, 0, 0), tag(2, 100, 0), tag(3, 10, 10), tag(4, 110, 5)] }),
    ).toThrow(/: 1 & 3, 2 & 4$/);
  });

  it('tests rotated footprints exactly, not by their bounding boxes', () => {
    // 20 mm tags, 25 mm footprints (half edge 12.5 mm)
    // Upright next to 45°: along x they touch at 12.5 + 12.5·√2.
    const touch = 12.5 + 12.5 * Math.SQRT2;
    expect(() =>
      createBoard({ tags: [tag(1, 0, 0), tag(2, touch + 1e-6, 0, 20, 45)] }),
    ).not.toThrow();
    expect(() => createBoard({ tags: [tag(1, 0, 0), tag(2, touch - 0.01, 0, 20, 45)] })).toThrow(
      /1 & 2/,
    );
    // Two 45° tags offset 25 mm along their shared edge normal (1, 1)/√2 touch
    // edge to edge, although their bounding boxes (35.4 mm wide, centres
    // 17.7 mm apart in x and z) overlap a lot.
    const n = Math.SQRT1_2 * 25;
    expect(() => createBoard({ tags: [tag(1, 0, 0, 20, 45), tag(2, n, n, 20, 45)] })).not.toThrow();
    const m = Math.SQRT1_2 * 24.9;
    expect(() => createBoard({ tags: [tag(1, 0, 0, 20, 45), tag(2, m, m, 20, 45)] })).toThrow(
      /1 & 2/,
    );
    // Same for 30° and 120° (the same square orientation): offset 25 mm along
    // the 30° edge normal (−sin 30°, cos 30°) touches; 25 mm straight down
    // overlaps.
    const v: [number, number] = [-Math.sin(Math.PI / 6) * 25, Math.cos(Math.PI / 6) * 25];
    expect(() =>
      createBoard({ tags: [tag(1, 0, 0, 20, 30), tag(2, v[0], v[1], 20, 120)] }),
    ).not.toThrow();
    expect(() => createBoard({ tags: [tag(1, 0, 0, 20, 30), tag(2, 0, 25, 20, 120)] })).toThrow(
      /1 & 2/,
    );
  });

  it('handles different sizes', () => {
    // 32 mm tag (40 mm footprint) and 20 mm tag (25 mm): touching at 32.5 mm
    expect(() => createBoard({ tags: [tag(1, 0, 0, 32), tag(2, 32.5, 0, 20)] })).not.toThrow();
    expect(() => createBoard({ tags: [tag(1, 0, 0, 32), tag(2, 32.4, 0, 20)] })).toThrow(/1 & 2/);
  });
});

describe('scaleBoard', () => {
  it('scales centres and sizes, keeps IDs and rotations, returns a frozen board', () => {
    const board = createBoard({ tags: [tag(3, 10, -20, 20, 30), tag(4, 50, 40, 32, 0)] });
    const scaled = scaleBoard(board, 0.97);
    expect(scaled.family).toBe(board.family);
    expect(scaled.tags.map((t) => t.id)).toEqual([3, 4]);
    expect(scaled.tags[0]!.centerMm[0]).toBeCloseTo(9.7, 12);
    expect(scaled.tags[0]!.centerMm[1]).toBeCloseTo(-19.4, 12);
    expect(scaled.tags[0]!.sizeMm).toBeCloseTo(19.4, 12);
    expect(scaled.tags[0]!.rotationDeg).toBe(30);
    expect(scaled.tags[1]!.sizeMm).toBeCloseTo(31.04, 12);
    expect(Object.isFrozen(scaled.tags[1]!.centerMm)).toBe(true);
    expect(board.tags[0]!.sizeMm).toBe(20);
  });

  it('keeps touching footprints valid at any scale', () => {
    const board = createBoard({ tags: [tag(1, 0, 0), tag(2, 25, 0), tag(3, 0, 25)] });
    for (const s of [0.1, 0.97, 1.0123, 3.3, 1000])
      expect(() => scaleBoard(board, s)).not.toThrow();
  });

  it('rejects a scale that is not finite and > 0', () => {
    const board = createBoard({ tags: [tag(1, 0, 0)] });
    for (const s of [0, -1, NaN, Infinity]) expect(() => scaleBoard(board, s)).toThrow(/scale/);
  });
});
