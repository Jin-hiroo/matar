/**
 * Tag cells: the single source of truth for what a tag looks like.
 *
 * A cell grid is `squareCells × squareCells` values, row-major from the
 * printed top-left of the unrotated tag, `1 = white`, `0 = black`. It covers
 * the black square only (its black border included); the white ring around it
 * is implied. Used by the SVG writer, the synthetic renderer and the decoder.
 * ARCHITECTURE.md §2.3, §3.
 */
import { getFamilyDef, type FamilyDef } from './families.js';

/** Value (0/1) of bit i of a code split into hi/lo words, i = 0 most significant. */
export function codeBit(def: FamilyDef, hi: number, lo: number, i: number): number {
  const pos = def.nbits - 1 - i; // position from the least significant end
  return pos >= 32 ? (hi >>> (pos - 32)) & 1 : (lo >>> pos) & 1;
}

/** Cells of a code given as hi/lo words. Writes into `out` if given. */
export function codeToCells(def: FamilyDef, hi: number, lo: number, out?: Uint8Array): Uint8Array {
  const n = def.family.squareCells;
  const cells = out ?? new Uint8Array(n * n);
  if (cells.length !== n * n) throw new Error(`matar: cells must have ${n * n} entries`);
  cells.fill(0);
  for (let i = 0; i < def.nbits; i++) {
    cells[(def.bitY[i] as number) * n + (def.bitX[i] as number)] = codeBit(def, hi, lo, i);
  }
  return cells;
}

/**
 * Reads the code from a cell grid (values > 0 count as white). Border cells are
 * ignored. Returns `[hi, lo]`.
 */
export function cellsToCode(def: FamilyDef, cells: ArrayLike<number>): [number, number] {
  const n = def.family.squareCells;
  let hi = 0;
  let lo = 0;
  for (let i = 0; i < def.nbits; i++) {
    const bit =
      (cells[(def.bitY[i] as number) * n + (def.bitX[i] as number)] as number) > 0 ? 1 : 0;
    const pos = def.nbits - 1 - i;
    if (pos >= 32) hi |= bit << (pos - 32);
    else lo |= bit << pos;
  }
  return [hi >>> 0, lo >>> 0];
}

/**
 * Rotates an n × n grid 90° clockwise as seen on the printed page (y down):
 * `out[r][c] = cells[n − 1 − c][r]`. `out` must not alias `cells`.
 */
export function rotateCellsCw<T extends Uint8Array | Float32Array | Float64Array>(
  cells: T,
  n: number,
  out: T,
): T {
  if (out === cells) throw new Error('matar: rotateCellsCw cannot rotate in place');
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) out[r * n + c] = cells[(n - 1 - c) * n + r] as number;
  }
  return out;
}

/** The cells of tag `id` (1 = white), `squareCells²` values. */
export function tagCells(family: string, id: number): Uint8Array {
  const def = getFamilyDef(family);
  if (!Number.isInteger(id) || id < 0 || id >= def.family.count) {
    throw new Error(`matar: tag id ${id} out of range for ${family} (0…${def.family.count - 1})`);
  }
  return codeToCells(def, def.codesHi[id] as number, def.codesLo[id] as number);
}

/** Number of set bits in a 32-bit integer. */
export function popcount32(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}
