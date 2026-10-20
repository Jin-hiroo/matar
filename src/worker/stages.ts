/**
 * Default processing stages for `FrameProcessor` (src/worker/process.ts): the
 * real detector (src/detect) and pose solver (src/pose).
 *
 * TODO(I1): `createFocalEstimator` is a prior-only stand-in until P6 lands in
 * src/pose; swap it for the real one there.
 */
import { createDetector } from '../detect/index.js';
import { estimatePose, focalPrior } from '../pose/index.js';
import type { CameraIntrinsics, FocalEstimator, FocalSource } from '../types.js';
import type { Stages } from './process.js';

/** Keeps the initial intrinsics forever (no self-calibration). */
export function priorOnlyFocalEstimator(initial: {
  intrinsics: CameraIntrinsics;
  source: 'prior' | 'provided';
}): FocalEstimator {
  let k = initial.intrinsics;
  let source: FocalSource = initial.source;
  return {
    add: () => null,
    reset(next) {
      if (next) {
        k = next.intrinsics;
        source = next.source;
      }
    },
    get intrinsics() {
      return k;
    },
    get source() {
      return source;
    },
    stdDevPct: null,
  };
}

export const defaultStages: Stages = {
  createDetector,
  estimatePose: (detections, board, intrinsics, previous) =>
    estimatePose(detections, board, intrinsics, previous),
  createFocalEstimator: priorOnlyFocalEstimator,
  focalPrior,
};
