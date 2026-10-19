/**
 * `matar/testing`: synthetic images of boards at known camera poses, for
 * matar's own tests and for integrators' tests (ARCHITECTURE.md §9.1).
 */
export { renderBoard, type RenderBoardOptions, type SynthPatch } from './render.js';
export { randomPatches, type RandomPatchesOptions } from './patches.js';
export {
  intrinsicsFromFov,
  lookAtPose,
  projectBoardCorners,
  projectBoardPoint,
  randomViewPose,
  rollPose,
  type RandomViewOptions,
} from './camera.js';
export { mulberry32, normalSampler, uniform } from './random.js';
