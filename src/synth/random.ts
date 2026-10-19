/**
 * Seeded randomness for tests: mulberry32 (public-domain algorithm by Tommy
 * Ettinger; the library's copy in src/board/random.ts, re-exported) and a
 * Box–Muller normal sampler built on it.
 */

export { mulberry32 } from '../board/random.js';

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
