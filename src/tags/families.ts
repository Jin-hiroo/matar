/**
 * Tag families: public `TagFamily` metadata plus the internal `FamilyDef`
 * (code table and bit layout) used by the cell renderer and the decoder.
 *
 * Codes up to 64 bits are split into a high and a low 32-bit word so that
 * Hamming distances can be computed with plain 32-bit popcounts.
 * Bit layout: bit i (i = 0 is the most significant) is the cell at column
 * `bitX[i]`, row `bitY[i]` of the `squareCells × squareCells` grid of the black
 * square, rows from the printed top. ARCHITECTURE.md §3.
 */
import type { TagFamily } from '../types.js';
import { TAG36H11_BIT_X, TAG36H11_BIT_Y, TAG36H11_CODES_HEX } from './tag36h11.js';

export interface FamilyDef {
  readonly family: TagFamily;
  /** number of code bits (36 for tag36h11) */
  readonly nbits: number;
  /** bits above the low 32 of each code, index = tag ID */
  readonly codesHi: Uint32Array;
  /** low 32 bits of each code, index = tag ID */
  readonly codesLo: Uint32Array;
  /** bit i → column of its cell in the black-square grid */
  readonly bitX: Uint8Array;
  /** bit i → row of its cell in the black-square grid (0 = printed top) */
  readonly bitY: Uint8Array;
}

export const DEFAULT_FAMILY = 'tag36h11';

function parseHexCodes(rows: readonly string[]): { hi: Uint32Array; lo: Uint32Array } {
  const words = rows.join(' ').split(' ');
  const hi = new Uint32Array(words.length);
  const lo = new Uint32Array(words.length);
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    hi[i] = parseInt(w.slice(0, w.length - 8) || '0', 16) >>> 0;
    lo[i] = parseInt(w.slice(-8), 16) >>> 0;
  }
  return { hi, lo };
}

let tag36h11: FamilyDef | undefined;

function makeTag36h11(): FamilyDef {
  const { hi, lo } = parseHexCodes(TAG36H11_CODES_HEX);
  return Object.freeze({
    family: Object.freeze({
      name: 'tag36h11',
      dataCells: 6,
      squareCells: 8,
      minHamming: 11,
      maxCorrectedBits: 2,
      count: hi.length,
    }),
    nbits: 36,
    codesHi: hi,
    codesLo: lo,
    bitX: Uint8Array.from(TAG36H11_BIT_X),
    bitY: Uint8Array.from(TAG36H11_BIT_Y),
  });
}

/** Internal family definition (code table + bit layout). Throws on an unknown name. */
export function getFamilyDef(name: string): FamilyDef {
  if (name === 'tag36h11') return (tag36h11 ??= makeTag36h11());
  throw new Error(`matar: unknown tag family '${name}' (known: tag36h11)`);
}

/** Public family metadata. Throws on an unknown name. */
export function getFamily(name: string): TagFamily {
  return getFamilyDef(name).family;
}
