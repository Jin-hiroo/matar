/**
 * Seeded tag-ID sets (ARCHITECTURE.md §3.1): different boards should use
 * different random subsets of the family so a neighbour's tags rarely match.
 * Two random 40-of-587 sets share 40² / 587 ≈ 2.73 IDs on average.
 *
 * Algorithm: `hashString32(seed)` seeds `mulberry32`, then a partial
 * Fisher–Yates shuffle over all IDs 0 … count − 1 of the family picks `count`
 * distinct IDs. Pure and deterministic: the same (family, count, seed) gives the
 * same list on every platform.
 */
import { getFamily } from '../tags/index.js';
import { hashString32, mulberry32 } from './random.js';

/**
 * `count` distinct IDs of `family`, picked at random but deterministically from
 * `seed`. Returned in pick order (not sorted); a longer list for the same seed
 * starts with the shorter one. Throws on an unknown family, a non-string seed,
 * or a count that is not an integer in 0 … family size.
 */
export function pickTagIds(family: string, count: number, seed: string): number[] {
  const n = getFamily(family).count;
  if (!Number.isInteger(count) || count < 0 || count > n) {
    throw new Error(
      `matar: pickTagIds: count must be an integer in 0…${n} for ${family} (got ${count})`,
    );
  }
  if (typeof seed !== 'string') throw new Error('matar: pickTagIds: seed must be a string');
  const rng = mulberry32(hashString32(seed));
  const pool = new Uint32Array(n);
  for (let i = 0; i < n; i++) pool[i] = i;
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const t = pool[i] as number;
    pool[i] = pool[j] as number;
    pool[j] = t;
  }
  return Array.from(pool.subarray(0, count));
}
