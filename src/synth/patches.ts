/**
 * Random printed distractors for false-positive tests: dark blocks, thin
 * text-like strokes, and tag-like squares (black border + random inner cells).
 * Tag-like squares are redrawn until they are more than `minHammingToFamily − 1`
 * bits from every code of the family in every rotation, so a test that expects
 * zero detections can't be broken by a pattern that is a real tag up to noise.
 */
import {
  DEFAULT_FAMILY,
  cellsToCode,
  getFamilyDef,
  popcount32,
  rotateCellsCw,
} from '../tags/index.js';
import type { FamilyDef } from '../tags/index.js';
import type { Board, Vec2 } from '../types.js';
import type { SynthPatch } from './render.js';
import { uniform } from './random.js';

export interface RandomPatchesOptions {
  /** board [x, z] box to place them in, mm */
  areaMm: { min: Vec2; max: Vec2 };
  count: number;
  /** keep clear of this board's tags (incl. a 1-cell margin) */
  avoid?: Board;
  /** cells per side of tag-like squares, default the family's `squareCells` (8) */
  squareCells?: number;
  /** family whose codes tag-like squares must stay away from, default tag36h11 */
  family?: string;
  /**
   * minimum Hamming distance from every family code in every rotation,
   * default 5 (decoding corrects ≤ 2 bits, so noise would need ≥ 3 more flips);
   * only applies when `squareCells` equals the family's
   */
  minHammingToFamily?: number;
}

export function randomPatches(rng: () => number, o: RandomPatchesOptions): SynthPatch[] {
  const def = getFamilyDef(o.family ?? DEFAULT_FAMILY);
  const n = o.squareCells ?? def.family.squareCells;
  const minDist = n === def.family.squareCells ? (o.minHammingToFamily ?? 5) : 0;
  const out: SynthPatch[] = [];
  const clear = (c: Vec2, r: number) =>
    !o.avoid?.tags.some((t) => {
      const tr = (t.sizeMm / 2) * Math.SQRT2 * (1 + 2 / n);
      return Math.hypot(c[0] - t.centerMm[0], c[1] - t.centerMm[1]) < tr + r;
    });
  let guard = 0;
  while (out.length < o.count && guard++ < o.count * 50) {
    const center: Vec2 = [
      uniform(rng, o.areaMm.min[0], o.areaMm.max[0]),
      uniform(rng, o.areaMm.min[1], o.areaMm.max[1]),
    ];
    const rotationDeg = uniform(rng, 0, 360);
    const kind = rng();
    let p: SynthPatch;
    if (kind < 0.35) {
      // text-like stroke
      const len = uniform(rng, 3, 25);
      p = { centerMm: center, sizeMm: [len, uniform(rng, 0.4, 1.5)], rotationDeg };
    } else if (kind < 0.6) {
      // dark block
      p = { centerMm: center, sizeMm: [uniform(rng, 4, 30), uniform(rng, 4, 30)], rotationDeg };
    } else {
      // tag-like square with random inner cells, far from every real code
      const size = uniform(rng, 12, 40);
      const cells = new Uint8Array(n * n);
      do {
        for (let r = 1; r < n - 1; r++)
          for (let c = 1; c < n - 1; c++) cells[r * n + c] = rng() < 0.5 ? 1 : 0;
      } while (minDist > 0 && familyDistance(def, cells) < minDist);
      p = { centerMm: center, sizeMm: [size, size], rotationDeg, cells };
    }
    const radius = Math.hypot(p.sizeMm[0], p.sizeMm[1]) / 2;
    if (clear(center, radius)) out.push(p);
  }
  return out;
}

/** Smallest Hamming distance from `cells` (squareCells²) to any code of the family, any rotation. */
export function familyDistance(def: FamilyDef, cells: Uint8Array): number {
  const n = def.family.squareCells;
  let a = Uint8Array.from(cells);
  let b = new Uint8Array(n * n);
  let best = Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const [hi, lo] = cellsToCode(def, a);
    for (let id = 0; id < def.family.count; id++) {
      const d =
        popcount32((hi ^ (def.codesHi[id] as number)) >>> 0) +
        popcount32((lo ^ (def.codesLo[id] as number)) >>> 0);
      if (d < best) best = d;
    }
    if (rot < 3) {
      rotateCellsCw(a, n, b);
      [a, b] = [b, a];
    }
  }
  return best;
}
