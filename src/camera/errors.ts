/**
 * Camera errors → stable `TrackerErrorCode`s (ARCHITECTURE.md §6.4).
 *
 * - `checkCameraEnvironment`: before asking for the camera, an insecure
 *   context (`isSecureContext === false`; `getUserMedia` needs HTTPS or
 *   localhost) → `'insecure-context'`; no `navigator.mediaDevices.getUserMedia`
 *   → `'no-camera-api'`. Insecure first: Chrome hides `mediaDevices` entirely
 *   on insecure origins, which would otherwise read as "no API".
 * - `cameraErrorCode`: a rejected `getUserMedia` by `DOMException.name`,
 *   including the legacy Chrome/Firefox names:
 *   `NotAllowedError` / `SecurityError` / `PermissionDeniedError` → `'permission-denied'`,
 *   `NotFoundError` / `DevicesNotFoundError` → `'no-camera'`,
 *   `NotReadableError` / `TrackStartError` / `AbortError` → `'camera-in-use'`,
 *   `OverconstrainedError` / `ConstraintNotSatisfiedError` → `'overconstrained'`,
 *   anything else → `'unknown'`.
 *
 * Pure; `MatarError` is what `tracker.start()` rejects with.
 */
import type { TrackerErrorCode } from '../types.js';

const BY_NAME: Readonly<Record<string, TrackerErrorCode>> = {
  NotAllowedError: 'permission-denied',
  SecurityError: 'permission-denied',
  PermissionDeniedError: 'permission-denied',
  NotFoundError: 'no-camera',
  DevicesNotFoundError: 'no-camera',
  NotReadableError: 'camera-in-use',
  TrackStartError: 'camera-in-use',
  AbortError: 'camera-in-use',
  OverconstrainedError: 'overconstrained',
  ConstraintNotSatisfiedError: 'overconstrained',
};

const MESSAGES: Readonly<Record<TrackerErrorCode, string>> = {
  'insecure-context': 'the camera needs a secure context (HTTPS or localhost)',
  'no-camera-api': 'this browser has no camera API (navigator.mediaDevices.getUserMedia)',
  'permission-denied': 'camera permission was denied',
  'no-camera': 'no camera was found',
  'camera-in-use': 'the camera could not be started (in use by another app or tab?)',
  overconstrained: 'no camera matches the requested settings',
  'worker-failed': 'the tracking worker failed to start; running on the main thread instead',
  unknown: 'the camera failed to start',
};

/** Error code for a rejected `getUserMedia` (or `applyConstraints`). */
export function cameraErrorCode(err: unknown): TrackerErrorCode {
  const name =
    typeof err === 'object' && err !== null && 'name' in err && typeof err.name === 'string'
      ? err.name
      : '';
  return BY_NAME[name] ?? 'unknown';
}

/** A readable default message for a code. */
export function errorMessage(code: TrackerErrorCode): string {
  return MESSAGES[code];
}

/** What the environment allows before `getUserMedia` is tried; null = fine. */
export function checkCameraEnvironment(env: {
  /** `globalThis.isSecureContext`; undefined (old browsers) counts as secure */
  isSecureContext: boolean | undefined;
  hasGetUserMedia: boolean;
}): TrackerErrorCode | null {
  if (env.isSecureContext === false) return 'insecure-context';
  if (!env.hasGetUserMedia) return 'no-camera-api';
  return null;
}

/** An error with a stable code; `tracker.start()` rejects with one. */
export class MatarError extends Error {
  readonly code: TrackerErrorCode;
  constructor(code: TrackerErrorCode, message?: string, cause?: unknown) {
    super(`matar: ${message ?? MESSAGES[code]}`, cause === undefined ? undefined : { cause });
    this.name = 'MatarError';
    this.code = code;
  }
}

/** Wraps a camera failure as a `MatarError` with its mapped code and the original message. */
export function toCameraError(err: unknown): MatarError {
  if (err instanceof MatarError) return err;
  const code = cameraErrorCode(err);
  const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
  return new MatarError(code, `${MESSAGES[code]}${detail}`, err);
}
