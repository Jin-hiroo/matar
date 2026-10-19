import { describe, expect, it } from 'vitest';
import { mulberry32, normalSampler } from '../synth/random.js';
import {
  applyHomography,
  axisAngleFromRotation,
  choleskyFactor,
  choleskySolve,
  homographyDlt,
  homographyLsq,
  mat3Det,
  mat3Identity,
  mat3Invert,
  mat3Mul,
  mat3MulTransposeA,
  mat3MulVec,
  mat3Transpose,
  mat3TransposeMulVec,
  mat4FromRotationTranslation,
  mat4GetRotation,
  mat4Identity,
  mat4Invert,
  mat4InvertRigid,
  mat4Mul,
  mat4MulVec4,
  mat4TransformPoint,
  maxAbsDiff,
  nearestRotation,
  quatConjugate,
  quatExp,
  quatFromRotation,
  quatLog,
  quatMultiply,
  rotationAngle,
  rotationAngleBetween,
  rotationFromAxisAngle,
  rotationFromQuat,
  solveSpd,
  svd3,
  symmetricEigen,
} from './index.js';

const SEED = 20261019;
const I3 = mat3Identity();

function randMat(rng: () => number, n: number): Float64Array {
  const m = new Float64Array(n);
  for (let i = 0; i < n; i++) m[i] = rng() * 2 - 1;
  return m;
}

function randAxisAngle(rng: () => number, maxAngle = Math.PI): Float64Array {
  const g = normalSampler(rng);
  const v = Float64Array.of(g(), g(), g());
  const n = Math.hypot(v[0]!, v[1]!, v[2]!);
  const a = rng() * maxAngle;
  return v.map((x) => (x / n) * a);
}

function randRotation(rng: () => number): Float64Array {
  return rotationFromAxisAngle(randAxisAngle(rng));
}

/** max |aᵀa − I| for a row-major n×n */
function orthoErr(a: Float64Array, n: number): number {
  let m = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += a[k * n + i]! * a[k * n + j]!;
      m = Math.max(m, Math.abs(s - (i === j ? 1 : 0)));
    }
  }
  return m;
}

describe('mat3', () => {
  it('multiplies, transposes and inverts to 1e-12', () => {
    const rng = mulberry32(SEED);
    for (let i = 0; i < 200; i++) {
      const a = randMat(rng, 9);
      const b = randMat(rng, 9);
      if (Math.abs(mat3Det(a)) < 0.05) continue; // keep the condition number moderate
      const inv = mat3Invert(a)!;
      expect(maxAbsDiff(mat3Mul(a, inv), I3), `seed ${SEED} case ${i}`).toBeLessThan(1e-12);
      expect(maxAbsDiff(mat3Mul(inv, a), I3)).toBeLessThan(1e-12);
      expect(Math.abs(mat3Det(mat3Mul(a, b)) - mat3Det(a) * mat3Det(b))).toBeLessThan(1e-12);
      expect(maxAbsDiff(mat3MulTransposeA(a, b), mat3Mul(mat3Transpose(a), b))).toBeLessThan(1e-15);
      const v = [rng(), rng(), rng()];
      expect(maxAbsDiff(mat3TransposeMulVec(a, v), mat3MulVec(mat3Transpose(a), v))).toBeLessThan(
        1e-15,
      );
      // aliasing: out = a
      const c = Float64Array.from(a);
      mat3Mul(c, b, c);
      expect(maxAbsDiff(c, mat3Mul(a, b))).toBe(0);
      const t = Float64Array.from(a);
      mat3Transpose(t, t);
      expect(maxAbsDiff(mat3Transpose(t), a)).toBe(0);
    }
  });

  it('reports singular matrices', () => {
    expect(mat3Invert(new Float64Array(9))).toBeNull();
    expect(mat3Invert(Float64Array.of(1, 2, 3, 2, 4, 6, 0, 0, 1))).toBeNull();
  });
});

describe('mat4 (column-major)', () => {
  it('inverts general and rigid transforms to 1e-12', () => {
    const rng = mulberry32(SEED + 1);
    for (let i = 0; i < 200; i++) {
      const a = randMat(rng, 16);
      for (let k = 0; k < 4; k++) a[5 * k] = a[5 * k]! + 3; // diagonally dominant → well conditioned
      const inv = mat4Invert(a)!;
      expect(
        maxAbsDiff(mat4Mul(a, inv), mat4Identity()),
        `seed ${SEED + 1} case ${i}`,
      ).toBeLessThan(1e-12);
      const r = randRotation(rng);
      const t = [rng() * 1000 - 500, rng() * 1000 - 500, rng() * 1000 - 500];
      const m = mat4FromRotationTranslation(r, t);
      const mi = mat4InvertRigid(m);
      expect(maxAbsDiff(mat4Mul(m, mi), mat4Identity())).toBeLessThan(1e-12);
      expect(maxAbsDiff(mi, mat4Invert(m)!)).toBeLessThan(1e-12);
      expect(maxAbsDiff(mat4GetRotation(m), r)).toBe(0);
      // column-major layout: translation in 12…14, and transformPoint = R·p + t
      expect([m[12], m[13], m[14]]).toEqual(t);
      const p = [rng(), rng(), rng()];
      const q = mat4TransformPoint(m, p);
      const rp = mat3MulVec(r, p);
      for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(rp[k]! + t[k]!, 12);
      const q4 = mat4MulVec4(m, [p[0]!, p[1]!, p[2]!, 1]);
      expect(maxAbsDiff(q4.subarray(0, 3), q)).toBeLessThan(1e-12);
      // aliasing
      const c = Float64Array.from(m);
      mat4Mul(c, mi, c);
      expect(maxAbsDiff(c, mat4Identity())).toBeLessThan(1e-12);
    }
    expect(mat4Invert(new Float64Array(16))).toBeNull();
  });
});

describe('rotations', () => {
  it('exp gives rotations; log inverts it to 1e-12 (small, large and near-π angles)', () => {
    const rng = mulberry32(SEED + 2);
    const cases: Float64Array[] = [];
    for (let i = 0; i < 200; i++) cases.push(randAxisAngle(rng, Math.PI - 1e-6));
    for (let i = 0; i < 20; i++) cases.push(randAxisAngle(rng, 1e-7)); // series branch
    for (let i = 0; i < 20; i++) {
      const w = randAxisAngle(rng, 1);
      const n = Math.hypot(w[0]!, w[1]!, w[2]!);
      cases.push(w.map((x) => (x / n) * (Math.PI - 1e-4)));
    }
    for (const [i, w] of cases.entries()) {
      const r = rotationFromAxisAngle(w);
      expect(orthoErr(r, 3), `seed ${SEED + 2} case ${i}`).toBeLessThan(1e-12);
      expect(Math.abs(mat3Det(r) - 1)).toBeLessThan(1e-12);
      const back = axisAngleFromRotation(r);
      expect(maxAbsDiff(back, w), `seed ${SEED + 2} case ${i}`).toBeLessThan(1e-12);
      const angle = Math.hypot(w[0]!, w[1]!, w[2]!);
      expect(Math.abs(rotationAngle(r) - angle)).toBeLessThan(1e-12);
      expect(Math.abs(rotationAngleBetween(I3, r) - angle)).toBeLessThan(1e-12);
      // R·v = v cos θ + (k × v) sin θ + k (k·v)(1 − cos θ) for a test vector
      const v = [0.3, -0.5, 0.8];
      const rv = mat3MulVec(r, v);
      const k = angle > 0 ? w.map((x) => x / angle) : Float64Array.of(1, 0, 0);
      const kv = k[0]! * v[0]! + k[1]! * v[1]! + k[2]! * v[2]!;
      const kx = [
        k[1]! * v[2]! - k[2]! * v[1]!,
        k[2]! * v[0]! - k[0]! * v[2]!,
        k[0]! * v[1]! - k[1]! * v[0]!,
      ];
      for (let j = 0; j < 3; j++) {
        const want =
          v[j]! * Math.cos(angle) + kx[j]! * Math.sin(angle) + k[j]! * kv * (1 - Math.cos(angle));
        expect(Math.abs(rv[j]! - want)).toBeLessThan(1e-12);
      }
    }
  });

  it('measures angles between rotations', () => {
    const rng = mulberry32(SEED + 3);
    for (let i = 0; i < 200; i++) {
      const a = randRotation(rng);
      const d = randAxisAngle(rng, Math.PI - 1e-6);
      const b = mat3Mul(a, rotationFromAxisAngle(d));
      const want = Math.hypot(d[0]!, d[1]!, d[2]!);
      expect(
        Math.abs(rotationAngleBetween(a, b) - want),
        `seed ${SEED + 3} case ${i}`,
      ).toBeLessThan(1e-12);
      expect(Math.abs(rotationAngleBetween(b, a) - want)).toBeLessThan(1e-12);
    }
    // tiny angles stay accurate (no acos)
    const tiny = rotationFromAxisAngle([1e-9, 0, 0]);
    expect(Math.abs(rotationAngleBetween(I3, tiny) - 1e-9)).toBeLessThan(1e-20);
  });

  it('quaternions match matrices', () => {
    const rng = mulberry32(SEED + 4);
    for (let i = 0; i < 200; i++) {
      const a = randRotation(rng);
      const b = randRotation(rng);
      const qa = quatFromRotation(a);
      const qb = quatFromRotation(b);
      expect(qa[3]).toBeGreaterThanOrEqual(0);
      expect(maxAbsDiff(rotationFromQuat(qa), a), `seed ${SEED + 4} case ${i}`).toBeLessThan(1e-12);
      // q_a ⊗ q_b ↔ R_a · R_b
      expect(maxAbsDiff(rotationFromQuat(quatMultiply(qa, qb)), mat3Mul(a, b))).toBeLessThan(1e-12);
      // log/exp inverse, conjugate = inverse
      const w = randAxisAngle(rng, Math.PI - 1e-6);
      const q = quatExp(w);
      expect(maxAbsDiff(quatLog(q), w)).toBeLessThan(1e-12);
      expect(maxAbsDiff(rotationFromQuat(q), rotationFromAxisAngle(w))).toBeLessThan(1e-12);
      const e = quatMultiply(q, quatConjugate(q));
      expect(maxAbsDiff(e, [0, 0, 0, 1])).toBeLessThan(1e-12);
      // −q is the same rotation, log takes the short way
      const nq = q.map((x) => -x);
      expect(maxAbsDiff(quatLog(nq), w)).toBeLessThan(1e-12);
    }
  });

  it('nearestRotation snaps perturbed matrices to rotations', () => {
    const rng = mulberry32(SEED + 5);
    for (let i = 0; i < 200; i++) {
      const r = randRotation(rng);
      expect(maxAbsDiff(nearestRotation(r), r)).toBeLessThan(1e-12);
      const noisy = r.map((x) => x + (rng() - 0.5) * 0.02);
      const s = nearestRotation(noisy);
      expect(orthoErr(s, 3)).toBeLessThan(1e-12);
      expect(Math.abs(mat3Det(s) - 1)).toBeLessThan(1e-12);
      expect(rotationAngleBetween(r, s)).toBeLessThan(0.05);
    }
    // a reflection maps to a proper rotation
    const s = nearestRotation(Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, -1));
    expect(Math.abs(mat3Det(s) - 1)).toBeLessThan(1e-12);
  });
});

describe('svd3 (one-sided Jacobi)', () => {
  function check(a: Float64Array, label: string): void {
    const { u, s, v } = svd3(a);
    const us = new Float64Array(9);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) us[3 * r + c] = u[3 * r + c]! * s[c]!;
    const rec = mat3Mul(us, mat3Transpose(v));
    const scale = Math.max(1, s[0]!);
    expect(maxAbsDiff(rec, a) / scale, label).toBeLessThan(1e-12);
    expect(orthoErr(u, 3), label).toBeLessThan(1e-12);
    expect(orthoErr(v, 3), label).toBeLessThan(1e-12);
    expect(s[0]).toBeGreaterThanOrEqual(s[1]!);
    expect(s[1]).toBeGreaterThanOrEqual(s[2]!);
    expect(s[2]).toBeGreaterThanOrEqual(0);
  }

  it('reconstructs random, rank-deficient and zero matrices to 1e-12', () => {
    const rng = mulberry32(SEED + 6);
    for (let i = 0; i < 200; i++) check(randMat(rng, 9), `seed ${SEED + 6} case ${i}`);
    for (let i = 0; i < 50; i++) {
      // rank 2 and rank 1
      const x = randMat(rng, 3);
      const y = randMat(rng, 3);
      const z = randMat(rng, 3);
      const r2 = new Float64Array(9);
      const r1 = new Float64Array(9);
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          r2[3 * r + c] = x[r]! * y[c]! + z[r]! * x[c]!;
          r1[3 * r + c] = x[r]! * y[c]!;
        }
      }
      check(r2, `rank 2, case ${i}`);
      check(r1, `rank 1, case ${i}`);
    }
    check(new Float64Array(9), 'zero');
    check(Float64Array.of(1e-200, 0, 0, 0, 1, 0, 0, 0, 1e200), 'wide range');
  });

  it('singular values match a diagonal input', () => {
    const { s } = svd3(Float64Array.of(0, 0, -2, 3, 0, 0, 0, 1, 0));
    expect(Array.from(s)).toEqual([3, 2, 1]);
  });
});

describe('symmetricEigen (cyclic Jacobi)', () => {
  it('diagonalises random symmetric matrices up to 9×9 to 1e-12', () => {
    const rng = mulberry32(SEED + 7);
    for (let i = 0; i < 200; i++) {
      const n = 2 + (i % 8);
      const a = new Float64Array(n * n);
      for (let r = 0; r < n; r++) {
        for (let c = r; c < n; c++) a[r * n + c] = a[c * n + r] = rng() * 2 - 1;
      }
      const vals = new Float64Array(n);
      const vecs = new Float64Array(n * n);
      symmetricEigen(a, n, vals, vecs);
      expect(orthoErr(vecs, n), `seed ${SEED + 7} case ${i}`).toBeLessThan(1e-12);
      for (let k = 0; k < n; k++) {
        if (k > 0) expect(vals[k]).toBeGreaterThanOrEqual(vals[k - 1]!);
        for (let r = 0; r < n; r++) {
          let av = 0;
          for (let c = 0; c < n; c++) av += a[r * n + c]! * vecs[c * n + k]!;
          expect(Math.abs(av - vals[k]! * vecs[r * n + k]!), `case ${i}`).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('handles diagonal and repeated eigenvalues', () => {
    const vals = new Float64Array(3);
    const vecs = new Float64Array(9);
    symmetricEigen(Float64Array.of(2, 0, 0, 0, 2, 0, 0, 0, -1), 3, vals, vecs);
    expect(Array.from(vals)).toEqual([-1, 2, 2]);
    expect(orthoErr(vecs, 3)).toBe(0);
  });
});

describe('cholesky', () => {
  it('factors and solves SPD systems up to 9×9 to 1e-12', () => {
    const rng = mulberry32(SEED + 8);
    for (let i = 0; i < 200; i++) {
      const n = 1 + (i % 9);
      // A = BᵀB + I
      const b = randMat(rng, n * n);
      const a = new Float64Array(n * n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          let s = r === c ? 1 : 0;
          for (let k = 0; k < n; k++) s += b[k * n + r]! * b[k * n + c]!;
          a[r * n + c] = s;
        }
      }
      const l = Float64Array.from(a);
      expect(choleskyFactor(l, n)).toBe(true);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c <= r; c++) {
          let s = 0;
          for (let k = 0; k <= c; k++) s += l[r * n + k]! * l[c * n + k]!;
          expect(Math.abs(s - a[r * n + c]!), `seed ${SEED + 8} case ${i}`).toBeLessThan(1e-12);
        }
      }
      const xTrue = randMat(rng, n);
      const rhs = new Float64Array(n);
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) rhs[r] = rhs[r]! + a[r * n + c]! * xTrue[c]!;
      }
      const x = choleskySolve(l, n, rhs, new Float64Array(n));
      expect(maxAbsDiff(x, xTrue)).toBeLessThan(1e-11);
      const x2 = new Float64Array(n);
      expect(solveSpd(Float64Array.from(a), n, rhs, x2)).toBe(true);
      expect(maxAbsDiff(x2, x)).toBe(0);
    }
  });

  it('rejects indefinite and NaN matrices', () => {
    expect(choleskyFactor(Float64Array.of(1, 2, 2, 1), 2)).toBe(false);
    expect(choleskyFactor(Float64Array.of(0, 0, 0, 0), 2)).toBe(false);
    expect(choleskyFactor(Float64Array.of(NaN, 0, 0, 1), 2)).toBe(false);
  });
});

describe('homographies', () => {
  /** random camera-like homography (board mm → pixels) and n points */
  function randomCase(rng: () => number, n: number) {
    const r = rotationFromAxisAngle([(rng() - 0.5) * 1.6, (rng() - 0.5) * 1.6, rng() * 6]);
    const t = [(rng() - 0.5) * 200, (rng() - 0.5) * 200, 300 + rng() * 300];
    const f = 800 + rng() * 400;
    // H = K [r1 r2 t]
    const h = new Float64Array(9);
    const k = [f, 0, 640, 0, f, 360, 0, 0, 1];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const m = (i: number) => (col === 2 ? t[i]! : r[3 * i + col]!);
        h[3 * row + col] = k[3 * row]! * m(0) + k[3 * row + 1]! * m(1) + k[3 * row + 2]! * m(2);
      }
    }
    const src = new Float64Array(2 * n);
    const dst = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) {
      src[2 * i] = (rng() - 0.5) * 300;
      src[2 * i + 1] = (rng() - 0.5) * 200;
      applyHomography(h, src[2 * i]!, src[2 * i + 1]!, dst, 2 * i);
    }
    return { h: h.map((x) => x / h[8]!), src, dst };
  }

  function maxReprojErr(h: Float64Array, src: Float64Array, dst: Float64Array): number {
    const p = new Float64Array(2);
    let m = 0;
    for (let i = 0; i < src.length / 2; i++) {
      applyHomography(h, src[2 * i]!, src[2 * i + 1]!, p);
      m = Math.max(m, Math.hypot(p[0]! - dst[2 * i]!, p[1]! - dst[2 * i + 1]!));
    }
    return m;
  }

  it('DLT and LSQ are exact on exact data (4 to 160 points)', () => {
    const rng = mulberry32(SEED + 9);
    let worstDlt = 0;
    let worstLsq = 0;
    for (let i = 0; i < 200; i++) {
      const n = [4, 5, 8, 48, 160][i % 5]!;
      const { h, src, dst } = randomCase(rng, n);
      const hd = homographyDlt(src, dst, n)!;
      const hl = homographyLsq(src, dst, n)!;
      expect(hd, `seed ${SEED + 9} case ${i}`).not.toBeNull();
      expect(hl).not.toBeNull();
      const ed = maxReprojErr(hd, src, dst);
      const el = maxReprojErr(hl, src, dst);
      worstDlt = Math.max(worstDlt, ed);
      worstLsq = Math.max(worstLsq, el);
      expect(ed, `seed ${SEED + 9} case ${i} (DLT, px)`).toBeLessThan(1e-9);
      expect(el, `seed ${SEED + 9} case ${i} (LSQ, px)`).toBeLessThan(1e-9);
      expect(maxAbsDiff(hd, h) / Math.max(...h.map(Math.abs))).toBeLessThan(1e-9);
    }
    console.log(
      `homography exact-data max reprojection error: DLT ${worstDlt.toExponential(1)} px, LSQ ${worstLsq.toExponential(1)} px`,
    );
  });

  it('stays finite for nearly collinear points; rejects coincident ones', () => {
    const rng = mulberry32(SEED + 10);
    for (let i = 0; i < 200; i++) {
      const n = 4 + (i % 12);
      const src = new Float64Array(2 * n);
      const dst = new Float64Array(2 * n);
      const jitter = [0, 1e-12, 1e-9, 1e-6][i % 4]!;
      for (let k = 0; k < n; k++) {
        const s = rng() * 100;
        src[2 * k] = s;
        src[2 * k + 1] = 2 * s + 1 + jitter * (rng() - 0.5);
        dst[2 * k] = 3 * s + 10 + jitter * (rng() - 0.5);
        dst[2 * k + 1] = -s + 5;
      }
      const hd = homographyDlt(src, dst, n);
      expect(hd, `seed ${SEED + 10} case ${i}`).not.toBeNull();
      for (const x of hd!) expect(Number.isFinite(x), `seed ${SEED + 10} case ${i}`).toBe(true);
      const hl = homographyLsq(src, dst, n);
      if (hl) for (const x of hl) expect(Number.isFinite(x)).toBe(true);
    }
    const same = new Float64Array(8).fill(3);
    expect(homographyDlt(same, same, 4)).toBeNull();
    expect(homographyLsq(same, same, 4)).toBeNull();
    expect(homographyDlt(same, same, 3)).toBeNull();
    const bad = Float64Array.of(0, 0, 1, 0, 0, 1, NaN, 1);
    expect(homographyDlt(bad, bad, 4)).toBeNull();
  });
});
