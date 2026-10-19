/**
 * Code matcher (ARCHITECTURE.md §3, §4.1 step 5): matches a sampled 36-bit code
 * against the board's codes in all four in-plane rotations by popcount.
 *
 * Entry e holds the code of tag `ids[e]` as it reads when the printed tag is
 * turned `rot[e]` × 90° clockwise relative to the sampled grid, i.e. the
 * printed top-left corner sits at the sampled quad's corner `rot[e]`
 * (quad corners clockwise on screen, corner 0 = the grid's top-left).
 *
 * Decoding only against the board's IDs keeps the false-positive rate low
 * (RESEARCH.md §2.1); `'all'` matches the whole family (debugging).
 */
import { cellsToCode, codeToCells, popcount32, rotateCellsCw } from '../tags/cells.js';
import type { FamilyDef } from '../tags/families.js';

export class CodeMatcher {
  /** high and low code words per entry */
  hi = new Uint32Array(0);
  lo = new Uint32Array(0);
  /** tag ID per entry */
  id = new Int32Array(0);
  /** printed-TL corner index (0–3) per entry */
  rot = new Uint8Array(0);
  /** number of entries (4 per ID) */
  count = 0;
  /** Hamming distance of the last successful `match` */
  distance = 0;

  constructor(readonly def: FamilyDef) {}

  /** Replaces the code set. Throws on IDs outside the family. */
  setIds(ids: readonly number[] | 'all'): void {
    const def = this.def;
    const count = def.family.count;
    let list: number[];
    if (ids === 'all') {
      list = Array.from({ length: count }, (_, i) => i);
    } else {
      for (const id of ids) {
        if (!Number.isInteger(id) || id < 0 || id >= count) {
          throw new Error(
            `matar: tag id ${id} out of range for ${def.family.name} (0…${count - 1})`,
          );
        }
      }
      list = [...new Set(ids)];
    }
    const n = list.length * 4;
    this.hi = new Uint32Array(n);
    this.lo = new Uint32Array(n);
    this.id = new Int32Array(n);
    this.rot = new Uint8Array(n);
    this.count = n;
    const side = def.family.squareCells;
    let cells = new Uint8Array(side * side);
    let tmp = new Uint8Array(side * side);
    let e = 0;
    for (const id of list) {
      codeToCells(def, def.codesHi[id]!, def.codesLo[id]!, cells);
      for (let r = 0; r < 4; r++) {
        const [h, l] = cellsToCode(def, cells);
        this.hi[e] = h;
        this.lo[e] = l;
        this.id[e] = id;
        this.rot[e] = r;
        e++;
        rotateCellsCw(cells, side, tmp);
        [cells, tmp] = [tmp, cells];
      }
    }
  }

  /**
   * Index of the entry within `maxBits` of the code (hi, lo), or −1. With the
   * family's minimum distance (11) and maxBits ≤ 2 the match is unique.
   * Sets `distance`.
   */
  match(hi: number, lo: number, maxBits: number): number {
    const H = this.hi;
    const L = this.lo;
    for (let e = 0; e < this.count; e++) {
      const dh = popcount32((hi ^ H[e]!) >>> 0);
      if (dh > maxBits) continue;
      const d = dh + popcount32((lo ^ L[e]!) >>> 0);
      if (d <= maxBits) {
        this.distance = d;
        return e;
      }
    }
    return -1;
  }
}
