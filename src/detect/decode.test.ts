import { describe, expect, it } from 'vitest';
import { cellsToCode, codeToCells, rotateCellsCw } from '../tags/cells.js';
import { getFamilyDef } from '../tags/families.js';
import { CodeMatcher } from './decode.js';

const def = getFamilyDef('tag36h11');

/** Code of tag `id` turned `turns` × 90° clockwise. */
function rotatedCode(id: number, turns: number): [number, number] {
  let cells = codeToCells(def, def.codesHi[id]!, def.codesLo[id]!);
  for (let i = 0; i < turns; i++) cells = rotateCellsCw(cells, 8, new Uint8Array(64));
  return cellsToCode(def, cells);
}

/** Flips bit positions `bits` (0 = most significant of 36) of a code. */
function flip(code: [number, number], bits: number[]): [number, number] {
  let [hi, lo] = code;
  for (const b of bits) {
    const pos = 35 - b;
    if (pos >= 32) hi ^= 1 << (pos - 32);
    else lo ^= 1 << pos;
  }
  return [hi >>> 0, lo >>> 0];
}

describe('CodeMatcher', () => {
  it('matches every rotation of every board ID and reports the printed-TL corner', () => {
    const m = new CodeMatcher(def);
    const ids = [0, 1, 42, 300, 586];
    m.setIds(ids);
    expect(m.count).toBe(20);
    for (const id of ids) {
      for (let r = 0; r < 4; r++) {
        const [hi, lo] = rotatedCode(id, r);
        const e = m.match(hi, lo, 2);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(m.id[e]).toBe(id);
        expect(m.rot[e]).toBe(r);
        expect(m.distance).toBe(0);
      }
    }
  });

  it('corrects up to maxBits and no more', () => {
    const m = new CodeMatcher(def);
    m.setIds([7, 99]);
    const code = rotatedCode(99, 3);
    for (const bits of [[0], [35], [3, 31], [12, 33]]) {
      const e = m.match(...flip(code, bits), 2);
      expect(m.id[e]).toBe(99);
      expect(m.rot[e]).toBe(3);
      expect(m.distance).toBe(bits.length);
    }
    expect(m.match(...flip(code, [1, 2, 3]), 2)).toBe(-1);
    expect(m.match(...flip(code, [4]), 0)).toBe(-1);
  });

  it("matches only the board's IDs unless 'all'", () => {
    const m = new CodeMatcher(def);
    m.setIds([5]);
    expect(m.match(...rotatedCode(6, 0), 2)).toBe(-1);
    m.setIds('all');
    expect(m.count).toBe(587 * 4);
    expect(m.id[m.match(...rotatedCode(6, 2), 2)]).toBe(6);
  });

  it('de-duplicates IDs and rejects IDs outside the family', () => {
    const m = new CodeMatcher(def);
    m.setIds([3, 3, 4]);
    expect(m.count).toBe(8);
    expect(() => m.setIds([587])).toThrow(/out of range/);
    expect(() => m.setIds([-1])).toThrow(/out of range/);
    expect(() => m.setIds([1.5])).toThrow(/out of range/);
  });
});
