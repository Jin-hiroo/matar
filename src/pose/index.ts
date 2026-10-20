/**
 * Pose stage (ARCHITECTURE.md §5): board pose from tag detections, the CV ↔ GL
 * frame conversions and the three.js projection matrix. The lead re-exports the
 * public parts from `src/index.ts`.
 */
export { estimatePose, type PoseOptions } from './estimate.js';
export {
  boardFromCameraGl,
  cameraFromBoardCv,
  cvToGlPoint,
  glToCvPoint,
  projectionFromIntrinsics,
} from './frames.js';
export {
  createFocalEstimator,
  FOCAL_DEFAULTS,
  focalConstraints,
  type FocalEstimatorOptions,
} from './focal.js';
export { createPoseFilter, oneEuroAlpha, POSE_FILTER_DEFAULTS } from './filter.js';
export { DEFAULT_FOV_PRIOR_DEG, focalPrior } from './intrinsics.js';
export { ippeRotations, ippeTranslation } from './ippe.js';
export { PoseProblem, refinePose, type RefineOptions } from './refine.js';
export { tagPairConsensus } from './consensus.js';
