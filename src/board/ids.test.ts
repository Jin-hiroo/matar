import { describe, expect, it } from 'vitest';
import { pickTagIds } from './ids.js';
import { mulberry32 as synthMulberry32 } from '../synth/random.js';
import { hashString32, mulberry32 } from './random.js';

describe('hashString32 / mulberry32', () => {
  it('are deterministic and spread similar seeds', () => {
    expect(hashString32('board-1')).toBe(hashString32('board-1'));
    expect(hashString32('board-1')).not.toBe(hashString32('board-2'));
    expect(hashString32('')).toBe(hashString32(''));
    const a = mulberry32(1);
    const b = mulberry32(1);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('is the same mulberry32 as the test renderer (local copy, see random.ts)', () => {
    for (const seed of [0, 1, 42, 0xdeadbeef]) {
      const a = mulberry32(seed);
      const b = synthMulberry32(seed);
      for (let i = 0; i < 100; i++) expect(a()).toBe(b());
    }
  });
});

describe('pickTagIds', () => {
  it('is deterministic per seed and gives distinct in-range IDs', () => {
    const a = pickTagIds('tag36h11', 40, 'my-board');
    expect(pickTagIds('tag36h11', 40, 'my-board')).toEqual(a);
    expect(new Set(a).size).toBe(40);
    for (const id of a) {
      expect(Number.isInteger(id)).toBe(true);
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(587);
    }
    expect(pickTagIds('tag36h11', 40, 'my-board-2')).not.toEqual(a);
  });

  it('extends a shorter pick for the same seed', () => {
    expect(pickTagIds('tag36h11', 60, 's').slice(0, 25)).toEqual(pickTagIds('tag36h11', 25, 's'));
  });

  it('can pick the whole family (a permutation) or nothing', () => {
    const all = pickTagIds('tag36h11', 587, 'x');
    expect([...all].sort((p, q) => p - q)).toEqual(Array.from({ length: 587 }, (_, i) => i));
    expect(pickTagIds('tag36h11', 0, 'x')).toEqual([]);
  });

  it('rejects bad counts and unknown families', () => {
    expect(() => pickTagIds('tag36h11', 588, 'x')).toThrow(/0…587/);
    expect(() => pickTagIds('tag36h11', -1, 'x')).toThrow(/count/);
    expect(() => pickTagIds('tag36h11', 2.5, 'x')).toThrow(/count/);
    expect(() => pickTagIds('nope', 1, 'x')).toThrow(/nope/);
  });

  it('reaches every ID over many seeds', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++)
      for (const id of pickTagIds('tag36h11', 40, `seed-${i}`)) seen.add(id);
    expect(seen.size).toBe(587);
  });

  it('two seeds’ 40-sets share 40²/587 ≈ 2.73 IDs on average (1000 pairs)', () => {
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      const a = new Set(pickTagIds('tag36h11', 40, `board-a-${i}`));
      for (const id of pickTagIds('tag36h11', 40, `board-b-${i}`)) if (a.has(id)) total++;
    }
    const mean = total / 1000;
    // expected 2.7257; the standard error over 1000 pairs is ≈ 0.05
    expect(Math.abs(mean - 1600 / 587)).toBeLessThan(0.25);
  });

  it('picks each ID about equally often', () => {
    const counts = new Array<number>(587).fill(0);
    const rounds = 2000;
    for (let i = 0; i < rounds; i++)
      for (const id of pickTagIds('tag36h11', 40, `u${i}`)) counts[id]!++;
    // expected 2000·40/587 ≈ 136.3 per ID, σ ≈ 11.3
    const expected = (rounds * 40) / 587;
    let chi2 = 0;
    for (const c of counts) chi2 += (c - expected) ** 2 / expected;
    // 586 degrees of freedom: mean 586, σ ≈ 34; 5σ bound
    expect(chi2).toBeLessThan(586 + 5 * 34);
    expect(Math.min(...counts)).toBeGreaterThan(expected / 2);
  });
});
