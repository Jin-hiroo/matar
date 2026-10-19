/**
 * Seeded randomness for board design (library code, so it must not depend on
 * the test-only `src/synth`):
 *
 * - `hashString32`: FNV-1a 32-bit over the string's UTF-16 code units (low
 *   byte, then high byte of each), finished with the MurmurHash3 `fmix32`
 *   avalanche so that similar seeds ("board-1", "board-2") give unrelated
 *   values. FNV-1a: Fowler–Noll–Vo, public domain; fmix32: Austin Appleby,
 *   public domain.
 * - `mulberry32`: Tommy Ettinger's public-domain 32-bit PRNG, uniform floats in
 *   [0, 1). `src/synth` (matar/testing) re-exports this one.
 */

/** 32-bit hash of a string: FNV-1a over UTF-16 code units, then fmix32. */
export function hashString32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = Math.imul(h ^ (c & 0xff), 0x01000193);
    h = Math.imul(h ^ (c >>> 8), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** PRNG producing uniform floats in [0, 1). Same seed → same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
