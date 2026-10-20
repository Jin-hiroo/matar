/**
 * Public entry point `matar` (ARCHITECTURE.md §8). Wired by the lead: each
 * workstream exports from its own `src/<dir>/index.ts`; only the lead edits
 * this file.
 */
export type * from './types.js';
export { DEFAULT_FAMILY, getFamily, tagCells } from './tags/index.js';
export {
  boardSvg,
  boardTagCornersMm,
  createBoard,
  layoutBorderTags,
  pickTagIds,
  scaleBoard,
  tagSvg,
  type BoardSvgOptions,
  type CreateBoardInput,
  type LayoutBorderTagsOptions,
  type RectMm,
  type TagSvgOptions,
} from './board/index.js';
export {
  createFocalEstimator,
  createPoseFilter,
  estimatePose,
  focalPrior,
  projectionFromIntrinsics,
  type FocalEstimatorOptions,
  type PoseOptions,
} from './pose/index.js';
export { createDetector } from './detect/index.js';
export { listCameras } from './camera/index.js';
export { createTracker } from './tracker/index.js';
