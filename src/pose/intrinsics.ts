/**
 * The focal-length prior (ARCHITECTURE.md §5.5 step 1): browsers don't expose
 * the focal length, so tracking starts from a field-of-view guess along the
 * frame's long side. Square pixels, principal point at the image centre
 * ((w − 1)/2, (h − 1)/2) (pixel centres at integers), no skew, no distortion.
 */
import type { CameraIntrinsics } from '../types.js';

/** Default long-side field of view, degrees (RESEARCH.md §1.3). */
export const DEFAULT_FOV_PRIOR_DEG = 68;

/**
 * Prior intrinsics for a `width × height` frame: fx = fy = (L/2)/tan(fov/2),
 * L = max(width, height), `fovPriorDeg` measured along L. Same f for portrait
 * and landscape frames of one camera.
 */
export function focalPrior(
  width: number,
  height: number,
  fovPriorDeg = DEFAULT_FOV_PRIOR_DEG,
): CameraIntrinsics {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`matar: focalPrior needs a positive frame size (got ${width} × ${height})`);
  }
  if (!(fovPriorDeg > 0 && fovPriorDeg < 180)) {
    throw new Error(`matar: fovPriorDeg must be in (0, 180) (got ${fovPriorDeg})`);
  }
  const f = Math.max(width, height) / 2 / Math.tan((fovPriorDeg * Math.PI) / 360);
  return { width, height, fx: f, fy: f, cx: (width - 1) / 2, cy: (height - 1) / 2 };
}
