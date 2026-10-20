/**
 * `getUserMedia` constraints for the tracker's camera (ARCHITECTURE.md §6.1).
 *
 * Input: the integrator's `TrackerOptions.camera` (frame size in px, frame rate
 * in fps, optional deviceId). Output: `MediaStreamConstraints`, video only.
 *
 * - Default: the rear camera (`facingMode: { ideal: 'environment' }`),
 *   1280 × 720 at 30 fps, all `ideal` so the browser picks the closest format.
 *   Never more than 30 fps by default: Safari may lower the resolution to meet
 *   a higher rate, and high-fps formats are heavily cropped (RESEARCH.md §1.3–1.4).
 * - A deviceId (given by the integrator, or the lens the tracker pinned) is
 *   `exact` and replaces `facingMode`.
 *
 * Pure; no browser globals.
 */

/** The camera part of `TrackerOptions` (src/types.ts). */
export interface CameraRequest {
  /** px */
  width?: number;
  height?: number;
  /** fps */
  frameRate?: number;
  deviceId?: string;
}

/** Defaults of §6.1: 1280 × 720 px, 30 fps. */
export const DEFAULT_CAMERA = { width: 1280, height: 720, frameRate: 30 } as const;

/** Constraints for `getUserMedia` (§6.1). */
export function cameraConstraints(req: CameraRequest = {}): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: req.width ?? DEFAULT_CAMERA.width },
    height: { ideal: req.height ?? DEFAULT_CAMERA.height },
    frameRate: { ideal: req.frameRate ?? DEFAULT_CAMERA.frameRate },
  };
  if (req.deviceId) video.deviceId = { exact: req.deviceId };
  else video.facingMode = { ideal: 'environment' };
  return { audio: false, video };
}
