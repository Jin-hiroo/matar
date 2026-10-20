/**
 * Tracker (ARCHITECTURE.md §6, §8). The lead re-exports `createTracker` and
 * `listCameras` from `src/index.ts`.
 */
export { browserEnv, createTracker, type TrackerEnv } from './tracker.js';
export {
  canvasFrameSource,
  defaultFrameSource,
  videoFrameSource,
  type FrameSource,
  type GrabbedFrame,
} from './grab.js';
