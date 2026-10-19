import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FAMILY,
  cellsToCode,
  codeToCells,
  getFamily,
  getFamilyDef,
  popcount32,
  rotateCellsCw,
  tagCells,
} from './index.js';

/**
 * Official renders from https://github.com/AprilRobotics/apriltag-imgs
 * (BSD-2-Clause, University of Michigan), tag36h11/tag36_11_<id>.png, 10 × 10 px,
 * transcribed as text (1 = white). The outer ring is the white quiet zone.
 */
const OFFICIAL: Record<number, string[]> = {
  0: [
    '1111111111',
    '1000000001',
    '1011010101',
    '1001110101',
    '1001100001',
    '1010100001',
    '1001011001',
    '1000010001',
    '1000000001',
    '1111111111',
  ],
  1: [
    '1111111111',
    '1000000001',
    '1011011001',
    '1001011101',
    '1011110001',
    '1001100001',
    '1010110101',
    '1000100101',
    '1000000001',
    '1111111111',
  ],
  42: [
    '1111111111',
    '1000000001',
    '1011010001',
    '1010100101',
    '1000001001',
    '1010101001',
    '1001110101',
    '1011101101',
    '1000000001',
    '1111111111',
  ],
  586: [
    '1111111111',
    '1000000001',
    '1011101001',
    '1000001101',
    '1010111101',
    '1010010001',
    '1010110101',
    '1011001101',
    '1000000001',
    '1111111111',
  ],
};

const def = getFamilyDef('tag36h11');
const N = def.family.squareCells;

function gridToText(cells: Uint8Array): string[] {
  const rows: string[] = [];
  for (let r = 0; r < N; r++) rows.push(Array.from(cells.subarray(r * N, (r + 1) * N)).join(''));
  return rows;
}

describe('tag36h11 table', () => {
  it('has the AprilTag metadata and code count', () => {
    expect(DEFAULT_FAMILY).toBe('tag36h11');
    expect(getFamily('tag36h11')).toEqual({
      name: 'tag36h11',
      dataCells: 6,
      squareCells: 8,
      minHamming: 11,
      maxCorrectedBits: 2,
      count: 587,
    });
    expect(def.codesHi.length).toBe(587);
    expect(def.bitX.length).toBe(36);
    expect(def.bitY.length).toBe(36);
  });

  it('starts and ends with the codes of tag36h11.c', () => {
    expect([def.codesHi[0], def.codesLo[0]]).toEqual([0xd, 0x7e00984b]);
    expect([def.codesHi[586], def.codesLo[586]]).toEqual([0xe, 0x8b772fe0]);
  });

  it('puts every bit on a distinct data cell', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 36; i++) {
      const x = def.bitX[i] as number;
      const y = def.bitY[i] as number;
      expect(x).toBeGreaterThanOrEqual(1);
      expect(x).toBeLessThanOrEqual(6);
      expect(y).toBeGreaterThanOrEqual(1);
      expect(y).toBeLessThanOrEqual(6);
      seen.add(y * N + x);
    }
    expect(seen.size).toBe(36);
  });
});

describe('tagCells', () => {
  it.each(Object.keys(OFFICIAL).map(Number))('matches the official render of id %i', (id) => {
    const official = (OFFICIAL[id] as string[]).slice(1, 9).map((row) => row.slice(1, 9));
    expect(gridToText(tagCells('tag36h11', id))).toEqual(official);
  });

  it('has an all-black border for every id', () => {
    for (let id = 0; id < 587; id++) {
      const cells = tagCells('tag36h11', id);
      for (let i = 0; i < N; i++) {
        expect(cells[i]).toBe(0);
        expect(cells[(N - 1) * N + i]).toBe(0);
        expect(cells[i * N]).toBe(0);
        expect(cells[i * N + N - 1]).toBe(0);
      }
    }
  });

  it('round-trips through cellsToCode', () => {
    for (let id = 0; id < 587; id++) {
      expect(cellsToCode(def, tagCells('tag36h11', id))).toEqual([
        def.codesHi[id],
        def.codesLo[id],
      ]);
    }
  });

  it('rejects bad ids and families', () => {
    expect(() => tagCells('tag36h11', 587)).toThrow(/out of range/);
    expect(() => tagCells('tag36h11', -1)).toThrow(/out of range/);
    expect(() => tagCells('tag36h11', 1.5)).toThrow(/out of range/);
    expect(() => tagCells('tag25h9', 0)).toThrow(/unknown tag family/);
  });
});

describe('rotateCellsCw', () => {
  it('rotates clockwise on the page', () => {
    // 2 × 2: [a b; c d] → [c a; d b]
    const out = rotateCellsCw(Uint8Array.of(1, 2, 3, 4), 2, new Uint8Array(4));
    expect(Array.from(out)).toEqual([3, 1, 4, 2]);
  });

  it('is the identity after four turns', () => {
    const a = tagCells('tag36h11', 7);
    const b = new Uint8Array(64);
    rotateCellsCw(a, N, b);
    const c = rotateCellsCw(b, N, new Uint8Array(64));
    const d = rotateCellsCw(c, N, new Uint8Array(64));
    expect(Array.from(rotateCellsCw(d, N, new Uint8Array(64)))).toEqual(Array.from(a));
  });
});

describe('Hamming distance', () => {
  it('popcount32 counts bits', () => {
    expect(popcount32(0)).toBe(0);
    expect(popcount32(0xffffffff)).toBe(32);
    expect(popcount32(0x80000001)).toBe(2);
    expect(popcount32(0x12345678)).toBe(13);
  });

  it('is at least 11 between any two codes in any rotation, and between a code and its own rotations', () => {
    // codes[id * 4 + r] = code of tag id rotated r × 90° clockwise
    const hi = new Uint32Array(587 * 4);
    const lo = new Uint32Array(587 * 4);
    for (let id = 0; id < 587; id++) {
      let cells = codeToCells(def, def.codesHi[id] as number, def.codesLo[id] as number);
      for (let r = 0; r < 4; r++) {
        const [h, l] = cellsToCode(def, cells);
        hi[id * 4 + r] = h;
        lo[id * 4 + r] = l;
        cells = rotateCellsCw(cells, N, new Uint8Array(64));
      }
    }
    let min = Infinity;
    for (let a = 0; a < 587; a++) {
      const ah = hi[a * 4] as number;
      const al = lo[a * 4] as number;
      for (let r = 1; r < 4; r++) {
        min = Math.min(
          min,
          popcount32(ah ^ (hi[a * 4 + r] as number)) + popcount32(al ^ (lo[a * 4 + r] as number)),
        );
      }
      for (let b = a + 1; b < 587; b++) {
        for (let r = 0; r < 4; r++) {
          const d =
            popcount32(ah ^ (hi[b * 4 + r] as number)) + popcount32(al ^ (lo[b * 4 + r] as number));
          if (d < min) min = d;
        }
      }
    }
    expect(min).toBe(11);
  });
});
