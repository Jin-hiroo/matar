/**
 * Canvas fit for `matar/three` (ARCHITECTURE.md §2.6, §7.3): framework-free
 * maths, no three.js import.
 *
 * - `coverFit` maps a frame's intrinsics (frame px, pixel centres at integers)
 *   to the effective intrinsics of the part of the frame visible in a canvas of
 *   Wc × Hc CSS px under object-fit "cover", plus the background texture's
 *   `repeat` (UV units; `offset` = (1 − repeat) / 2).
 * - `frustum` is the near-plane frustum (l, r, t, b) of §2.6 for any intrinsics,
 *   in the units of `near` (metres in three.js). It is the same frustum as
 *   `projectionFromIntrinsics` in `src/pose/frames.ts`; `MatarThree` hands it
 *   to three's `makePerspective` so `coordinateSystem` and `reversedDepth` are
 *   respected.
 */
import type { CameraIntrinsics } from '../types.js';

export interface CoverFit {
  /** intrinsics of the visible crop; `width`/`height` = the canvas size, CSS px */
  k: CameraIntrinsics;
  /** background texture `repeat` (UV), ≤ 1 per axis */
  rx: number;
  ry: number;
}

/**
 * Object-fit "cover" of a w × h frame in a Wc × Hc canvas (§7.3):
 * s = max(Wc/w, Hc/h), ox = (Wc − s·w)/2, oy = (Hc − s·h)/2 (≤ 0);
 * fx' = s·fx, fy' = s·fy, cx' = s(cx + 0.5) + ox − 0.5, cy' = s(cy + 0.5) + oy − 0.5.
 */
export function coverFit(k: CameraIntrinsics, canvasW: number, canvasH: number): CoverFit {
  const s = Math.max(canvasW / k.width, canvasH / k.height);
  return {
    k: {
      width: canvasW,
      height: canvasH,
      fx: s * k.fx,
      fy: s * k.fy,
      cx: s * (k.cx + 0.5) + (canvasW - s * k.width) / 2 - 0.5,
      cy: s * (k.cy + 0.5) + (canvasH - s * k.height) / 2 - 0.5,
    },
    rx: canvasW / (s * k.width),
    ry: canvasH / (s * k.height),
  };
}

/**
 * Near-plane frustum [l, r, t, b] for intrinsics `k` (§2.6): image edges at
 * −0.5 and w − 0.5 px, so l = −n(cx + 0.5)/fx, r = n(w − cx − 0.5)/fx,
 * t = n(cy + 0.5)/fy, b = −n(h − cy − 0.5)/fy. `near` in camera-space units.
 */
export function frustum(k: CameraIntrinsics, near: number): [number, number, number, number] {
  return [
    (-near * (k.cx + 0.5)) / k.fx,
    (near * (k.width - k.cx - 0.5)) / k.fx,
    (near * (k.cy + 0.5)) / k.fy,
    (-near * (k.height - k.cy - 0.5)) / k.fy,
  ];
}
