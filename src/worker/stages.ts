/**
 * Default processing stages for `FrameProcessor` (src/worker/process.ts): the
 * real detector (src/detect), pose solver and focal self-calibration
 * (src/pose).
 */
import { createDetector } from '../detect/index.js';
import { createFocalEstimator, estimatePose, focalPrior } from '../pose/index.js';
import type { Stages } from './process.js';

export const defaultStages: Stages = {
  createDetector,
  estimatePose: (detections, board, intrinsics, previous) =>
    estimatePose(detections, board, intrinsics, previous),
  createFocalEstimator: (initial) => createFocalEstimator(initial),
  focalPrior,
};
