/**
 * Pose stage (ARCHITECTURE.md §5): board pose from tag detections, the CV ↔ GL
 * frame conversions and the three.js projection matrix. The lead re-exports the
 * public parts from `src/index.ts`.
 */
export {
  boardFromCameraGl,
  cameraFromBoardCv,
  cvToGlPoint,
  glToCvPoint,
  projectionFromIntrinsics,
} from './frames.js';
