/**
 * Camera (ARCHITECTURE.md §6.1, §6.4): `getUserMedia` constraints, lens
 * pinning as a pure decision, `listCameras`, and error codes. The lead
 * re-exports the public parts (`listCameras`) from `src/index.ts`.
 */
export { cameraConstraints, DEFAULT_CAMERA, type CameraRequest } from './constraints.js';
export { currentPlatform, detectPlatform, type Platform } from './platform.js';
export {
  androidBackCameraIndex,
  chooseLens,
  classifyLensLabel,
  IOS_VIRTUAL_LABELS,
  IOS_WIDE_LABELS,
  type LensDecision,
  type TrackLensInfo,
  type VideoInputInfo,
} from './lens.js';
export {
  cameraErrorCode,
  checkCameraEnvironment,
  errorMessage,
  MatarError,
  toCameraError,
} from './errors.js';
export { isRearCamera, listCameras, toCameraList, type CameraInfo } from './list.js';
export {
  openCamera,
  reopenCamera,
  stopStream,
  trackLensInfo,
  type MediaDevicesLike,
  type OpenedCamera,
} from './open.js';
