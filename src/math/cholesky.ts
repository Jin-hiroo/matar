/**
 * Cholesky factorisation and solve for small symmetric positive-definite
 * systems (the 6×6 pose normal equations, the 8×8 homography least squares,
 * and later the shared-focal bundle). Matrices are **row-major** n×n
 * Float64Arrays. Textbook algorithm (Golub & Van Loan §4.2).
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < n·n, in
 * range by construction (loop bounds).
 */

/**
 * Factors `a = L·Lᵀ` in place: on success the lower triangle (diagonal
 * included) holds L; the strict upper triangle is left as it was. Returns
 * false if `a` is not (numerically) positive definite.
 */
export function choleskyFactor(a: Float64Array, n: number): boolean {
  for (let j = 0; j < n; j++) {
    let d = a[j * n + j]!;
    for (let k = 0; k < j; k++) d -= a[j * n + k]! ** 2;
    if (!(d > 0)) return false; // also catches NaN
    const ljj = Math.sqrt(d);
    a[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = a[i * n + j]!;
      for (let k = 0; k < j; k++) s -= a[i * n + k]! * a[j * n + k]!;
      a[i * n + j] = s / ljj;
    }
  }
  return true;
}

/** Solves `L·Lᵀ·x = b` with L from `choleskyFactor`. `x` may alias `b`. */
export function choleskySolve(
  l: Float64Array,
  n: number,
  b: ArrayLike<number>,
  x: Float64Array,
): Float64Array {
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l[i * n + k]! * x[k]!;
    x[i] = s / l[i * n + i]!;
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]!;
    for (let k = i + 1; k < n; k++) s -= l[k * n + i]! * x[k]!;
    x[i] = s / l[i * n + i]!;
  }
  return x;
}

/**
 * Solves the SPD system `a·x = b`, destroying the lower triangle of `a`.
 * Returns false (x untouched) if `a` is not positive definite.
 */
export function solveSpd(
  a: Float64Array,
  n: number,
  b: ArrayLike<number>,
  x: Float64Array,
): boolean {
  if (!choleskyFactor(a, n)) return false;
  choleskySolve(a, n, b, x);
  return true;
}
