/**
 * Lens selection (ARCHITECTURE.md §6.1, RESEARCH.md §1.1): a lens switch
 * silently changes the intrinsics, so the tracker tries to stay on one lens.
 *
 * `chooseLens` is a **pure** function of
 * - the platform (`detectPlatform`),
 * - the `videoinput` devices from `enumerateDevices()` (labels are only filled
 *   after camera permission, so it runs after the first `getUserMedia`),
 * - the open track: its deviceId, label, and the `zoom` capability/setting,
 * - an integrator-requested deviceId, if any,
 * and returns a decision: keep the open track (optionally applying `zoom`), or
 * reopen on another deviceId. It never touches the camera itself.
 *
 * Rules (§6.1):
 * 1. A requested deviceId was opened `exact`: keep it, nothing else.
 * 2. iOS/WebKit: `facingMode` opens a virtual multi-lens device that switches
 *    to the ultra-wide up close. If a `videoinput` is labelled exactly
 *    `Back Camera` (English; labels are localised) reopen on it (the plain wide
 *    lens, `'pinned'`). Otherwise stay on the virtual device (`'virtual'`) and
 *    apply `zoom: 1` if the capabilities offer `zoom.min < 1` (WebKit doubles
 *    the zoom factor on virtual devices, so 1 is the wide framing).
 * 3. Android/Chrome: back cameras are labelled `camera N, facing back`
 *    (`camera2 N, …` in older Chrome; not localised; infrared ones end in
 *    `, infrared` and don't count). Choose the lowest N (`'pinned'`); reopen if
 *    the open track is another one. No such labels → keep (`'unknown'`).
 * 4. Other platforms: keep the open track (`'unknown'`).
 *
 * More iOS locales are added from device-test data (DEVICE-TESTS.md), not guessed.
 */
import type { LensKind } from '../types.js';
import type { Platform } from './platform.js';

/** The plain wide rear lens on iOS (English label; RESEARCH.md §1.1). */
export const IOS_WIDE_LABELS: readonly string[] = ['Back Camera'];

/** iOS virtual multi-lens rear devices (English labels; RESEARCH.md §1.1). */
export const IOS_VIRTUAL_LABELS: readonly string[] = [
  'Back Dual Camera',
  'Back Dual Wide Camera',
  'Back Triple Camera',
];

/** A `videoinput` from `enumerateDevices()`. */
export interface VideoInputInfo {
  deviceId: string;
  label: string;
}

/** What the lens rules need to know about the open track. */
export interface TrackLensInfo {
  deviceId: string;
  label: string;
  /** `track.getCapabilities().zoom`, if offered */
  zoom?: { min: number; max: number };
  /** `track.getSettings().zoom`, if reported */
  zoomSetting?: number;
}

export type LensDecision =
  | {
      action: 'keep';
      lens: LensKind;
      deviceId: string;
      label: string;
      /** apply this zoom to the open track (`applyConstraints`), or null */
      zoom: number | null;
    }
  | { action: 'reopen'; lens: LensKind; deviceId: string; label: string };

const ANDROID_BACK = /^camera2? (\d+), facing back$/;

/** N of an Android `camera N, facing back` (or older `camera2 N, …`) label, else null. */
export function androidBackCameraIndex(label: string): number | null {
  const m = ANDROID_BACK.exec(label.trim());
  return m ? Number(m[1]) : null;
}

/** What a label says about the lens on a platform (for a device the integrator chose). */
export function classifyLensLabel(platform: Platform, label: string): LensKind {
  if (platform === 'ios') {
    if (IOS_WIDE_LABELS.includes(label)) return 'pinned';
    if (IOS_VIRTUAL_LABELS.includes(label)) return 'virtual';
    return 'unknown';
  }
  if (platform === 'android' && androidBackCameraIndex(label) !== null) return 'pinned';
  return 'unknown';
}

/** The lens decision of §6.1 (pure). */
export function chooseLens(
  platform: Platform,
  inputs: readonly VideoInputInfo[],
  track: TrackLensInfo,
  requestedDeviceId?: string,
): LensDecision {
  const keep = (lens: LensKind, zoom: number | null = null): LensDecision => ({
    action: 'keep',
    lens,
    deviceId: track.deviceId,
    label: track.label,
    zoom,
  });

  // 1. the integrator's choice wins
  if (requestedDeviceId) return keep(classifyLensLabel(platform, track.label));

  if (platform === 'ios') {
    // 2. the plain wide lens if it is listed under its English label
    if (IOS_WIDE_LABELS.includes(track.label)) return keep('pinned');
    const wide = inputs.find((d) => IOS_WIDE_LABELS.includes(d.label));
    if (wide && wide.deviceId !== track.deviceId) {
      return { action: 'reopen', lens: 'pinned', deviceId: wide.deviceId, label: wide.label };
    }
    // else stay on the virtual device, at the wide framing
    const wantZoom = track.zoom !== undefined && track.zoom.min < 1 && track.zoomSetting !== 1;
    return keep('virtual', wantZoom ? 1 : null);
  }

  if (platform === 'android') {
    // 3. the lowest-numbered back camera
    let best: VideoInputInfo | null = null;
    let bestN = Infinity;
    for (const d of inputs) {
      const n = androidBackCameraIndex(d.label);
      if (n !== null && n < bestN) {
        best = d;
        bestN = n;
      }
    }
    if (!best) return keep('unknown');
    if (best.deviceId === track.deviceId) return keep('pinned');
    return { action: 'reopen', lens: 'pinned', deviceId: best.deviceId, label: best.label };
  }

  // 4. desktop and anything unknown
  return keep('unknown');
}
