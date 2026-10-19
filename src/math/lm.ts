/**
 * A small dense Levenberg–Marquardt driver (Marquardt 1963 damping
 * (JᵀWJ + λ·diag(JᵀWJ))·δ = −JᵀWr, solved by Cholesky).
 *
 * The problem owns its parameters, so manifold parameters (rotations as local
 * axis-angle increments) and robust weights (IRLS) live in the problem, not
 * here. The per-frame pose refinement (§5.3) is a 6-parameter problem; the
 * focal-length bundle (§5.5, shared f over keyframe poses) can be another
 * implementation of the same interface.
 *
 * Non-null assertions (`!`) are on typed-array reads with indices < n·n, in
 * range by construction.
 */
import { choleskyFactor, choleskySolve } from './cholesky.js';

export interface LmProblem {
  /** number of parameters n */
  readonly size: number;
  /**
   * Fills the Gauss–Newton normal equations at the current estimate: `jtj`
   * (n×n row-major, JᵀWJ) and `jtr` (n, JᵀWr). Returns the current cost.
   */
  linearize(jtj: Float64Array, jtr: Float64Array): number;
  /** Cost at the current estimate ⊕ `step`, kept as the pending trial. Infinity if invalid. */
  tryStep(step: Float64Array): number;
  /** Makes the pending trial the current estimate. */
  acceptStep(): void;
  /** Size of a step for the convergence test, in the problem's own (dimensionless) units. */
  stepNorm(step: Float64Array): number;
}

export interface LmOptions {
  /** iteration limit, rejected steps included (default 10) */
  maxIterations?: number;
  /** stop once an accepted step is smaller than this (`stepNorm`, default 1e-6) */
  minStep?: number;
  /** initial damping relative to diag(JᵀWJ) (default 1e-3) */
  initialLambda?: number;
}

export interface LmResult {
  /** cost at the returned estimate */
  cost: number;
  iterations: number;
  /** true if the step criterion was met (not just the iteration limit) */
  converged: boolean;
}

/** Scratch buffers for `levenbergMarquardt`, sized for n parameters. */
export interface LmScratch {
  n: number;
  jtj: Float64Array;
  jtr: Float64Array;
  a: Float64Array;
  step: Float64Array;
}

export function createLmScratch(n: number): LmScratch {
  return {
    n,
    jtj: new Float64Array(n * n),
    jtr: new Float64Array(n),
    a: new Float64Array(n * n),
    step: new Float64Array(n),
  };
}

/** Runs LM on `problem` from its current estimate; the problem holds the result. */
export function levenbergMarquardt(
  problem: LmProblem,
  options: LmOptions = {},
  scratch: LmScratch = createLmScratch(problem.size),
): LmResult {
  const n = problem.size;
  if (scratch.n !== n) throw new Error('matar: LM scratch has the wrong size');
  const maxIterations = options.maxIterations ?? 10;
  const minStep = options.minStep ?? 1e-6;
  const { jtj, jtr, a, step } = scratch;
  let lambda = options.initialLambda ?? 1e-3;
  let cost = problem.linearize(jtj, jtr);
  let iterations = 0;
  while (iterations < maxIterations) {
    iterations++;
    a.set(jtj);
    for (let i = 0; i < n; i++) {
      const d = jtj[i * n + i]!;
      a[i * n + i] = d + lambda * (d > 0 ? d : 1);
    }
    for (let i = 0; i < n; i++) step[i] = -jtr[i]!;
    if (!choleskyFactor(a, n)) {
      lambda *= 10;
      continue;
    }
    choleskySolve(a, n, step, step);
    const trial = problem.tryStep(step);
    const small = problem.stepNorm(step) < minStep;
    if (trial <= cost) {
      problem.acceptStep();
      lambda = Math.max(lambda / 10, 1e-12);
      if (small) return { cost: trial, iterations, converged: true };
      cost = problem.linearize(jtj, jtr);
    } else {
      // a tiny step that doesn't reduce the cost: at the minimum to rounding
      if (small) return { cost, iterations, converged: true };
      lambda *= 10;
    }
  }
  return { cost, iterations, converged: false };
}
