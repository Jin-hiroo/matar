/**
 * A shorter exposure against motion blur (ARCHITECTURE.md §6.1,
 * `TrackerOptions.camera.maxExposureMs`): Image Capture's manual exposure,
 * which Chrome on Android offers (`exposureMode: 'manual'`, `exposureTime` in
 * 100 µs units, `iso`; RESEARCH.md §1.4). iOS Safari has no exposure
 * constraints, so there the result is `'unsupported'`.
 *
 * `shortenExposure(track, maxMs, wait, current)`:
 * 1. needs `exposureMode` with `'manual'`, `exposureTime` and `iso`
 *    capabilities, and the exposure time and ISO in the settings; else
 *    `'unsupported'` (also when the shortest time offered isn't shorter);
 * 2. leaves an automatic exposure of ≤ `maxMs` alone (`'auto'`);
 * 3. otherwise sets `maxMs` and the ISO × the current over the new time (each
 *    clamped to its range), so the image stays as bright;
 * 4. after `wait()` reads the settings back. Unless the exposure time is the
 *    one asked for (± 100 µs), it asks for `exposureMode: 'continuous'` again
 *    and reports `'refused'` with what the camera reports then (Chrome once
 *    took the ISO but kept 10 ms, DEVICE-TESTS.md 2026-10-23), as it does when
 *    `applyConstraints` or the confirmation fails.
 *
 * The manual exposure stays fixed: it doesn't follow later changes of light.
 * `current()` is checked after every await; once it is false the track was
 * stopped or replaced, nothing more is done to it and the result is null.
 */
import type { CameraExposure, ExposureState } from '../types.js';

/** The parts of a `MediaStreamTrack` used here. */
export interface ExposureTrack {
  getCapabilities?(): MediaTrackCapabilities;
  getSettings(): MediaTrackSettings;
  applyConstraints(constraints: MediaTrackConstraints): Promise<void>;
}

interface Range {
  min?: number;
  max?: number;
}

/** Image Capture capabilities (not in TypeScript's DOM types). */
interface ExposureCapabilities {
  exposureMode?: string[];
  exposureTime?: Range;
  iso?: Range;
}

/** The track's exposure time (ms) and ISO as it reports them, null where it doesn't. */
export function readExposure(track: ExposureTrack): Pick<CameraExposure, 'timeMs' | 'iso'> {
  const s = track.getSettings() as { exposureTime?: unknown; iso?: unknown };
  return {
    timeMs: typeof s.exposureTime === 'number' ? s.exposureTime / 10 : null,
    iso: typeof s.iso === 'number' ? s.iso : null,
  };
}

/** `v` within `r` (either end may be missing) */
function clamp(v: number, r: Range): number {
  if (r.min !== undefined) v = Math.max(r.min, v);
  if (r.max !== undefined) v = Math.min(r.max, v);
  return v;
}

/** Steps 1–4 above; never throws. */
export async function shortenExposure(
  track: ExposureTrack,
  maxMs: number,
  wait: () => Promise<void>,
  current: () => boolean,
): Promise<CameraExposure | null> {
  const read = (): Pick<CameraExposure, 'timeMs' | 'iso'> => {
    try {
      return readExposure(track);
    } catch {
      return { timeMs: null, iso: null };
    }
  };
  const report = (state: ExposureState): CameraExposure => ({ state, ...read() });
  let caps: ExposureCapabilities = {};
  try {
    caps = (track.getCapabilities?.() ?? {}) as ExposureCapabilities;
  } catch {
    // no capabilities reported
  }
  const now = read();
  if (
    !caps.exposureMode?.includes('manual') ||
    !caps.exposureTime ||
    !caps.iso ||
    now.timeMs === null ||
    now.iso === null
  ) {
    return report('unsupported');
  }
  if (now.timeMs <= maxMs) return report('auto');

  const time = clamp(maxMs * 10, caps.exposureTime); // 100 µs units
  if (!(time > 0 && time < now.timeMs * 10)) return report('unsupported'); // none shorter offered
  const iso = Math.round(clamp((now.iso * now.timeMs * 10) / time, caps.iso));
  const manual = { exposureMode: 'manual', exposureTime: time, iso };
  // asks for the automatic exposure again; the result has what the camera reports then
  const back = async (): Promise<CameraExposure | null> => {
    try {
      const auto = { exposureMode: 'continuous' };
      await track.applyConstraints({ advanced: [auto as MediaTrackConstraintSet] });
    } catch {
      // best effort: nothing else to go back to
    }
    return current() ? report('refused') : null;
  };
  try {
    await track.applyConstraints({ advanced: [manual as MediaTrackConstraintSet] });
    if (!current()) return null;
    await wait();
    if (!current()) return null;
    const got = readExposure(track);
    if (got.timeMs !== null && Math.abs(got.timeMs * 10 - time) <= 1) {
      return { state: 'short', ...got };
    }
  } catch {
    // rejected, or the confirmation failed: go back below
  }
  return current() ? back() : null;
}
