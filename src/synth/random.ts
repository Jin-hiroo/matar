/**
 * Seeded randomness for tests: mulberry32 (public-domain algorithm by Tommy
 * Ettinger) and a Box–Muller normal sampler built on it.
 */

/** Returns a PRNG producing uniform floats in [0, 1). Same seed → same sequence. */
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

/** Standard normal samples from a uniform PRNG (Box–Muller, one value per call). */
export function normalSampler(rng: () => number): () => number {
  return () => {
    let u = rng();
    while (u <= Number.MIN_VALUE) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  };
}

/** Uniform float in [lo, hi). */
export function uniform(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}
