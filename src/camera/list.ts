/**
 * `listCameras()` (ARCHITECTURE.md §6.1, §8): the `videoinput` devices with
 * their labels and deviceIds, so apps can offer a camera picker and persist
 * the choice (`TrackerOptions.camera.deviceId`). Labels are empty until camera
 * permission was granted once.
 *
 * `rear` is a best guess: Chrome's `InputDeviceInfo.getCapabilities().facingMode`
 * when available, else the label (`back` / `rear` / `environment`, Android's
 * `camera2 N, facing back`; English only, labels are localised on iOS).
 *
 * `toCameraList` is pure; `listCameras` reads `navigator` inside the function.
 */
import { androidBackCameraIndex } from './lens.js';

export interface CameraInfo {
  deviceId: string;
  label: string;
  rear: boolean;
}

/** The parts of `MediaDeviceInfo` / `InputDeviceInfo` used here. */
export interface DeviceInfoLike {
  kind: string;
  deviceId: string;
  label: string;
  getCapabilities?: () => { facingMode?: string[] };
}

const REAR_LABEL = /\b(back|rear|environment)\b/i;

/** Does this device face away from the user? */
export function isRearCamera(d: DeviceInfoLike): boolean {
  let facing: string[] | undefined;
  try {
    facing = d.getCapabilities?.().facingMode;
  } catch {
    facing = undefined; // some browsers throw before permission
  }
  if (facing && facing.length > 0) return facing.includes('environment');
  return androidBackCameraIndex(d.label) !== null || REAR_LABEL.test(d.label);
}

/** `videoinput` devices of an `enumerateDevices()` result (pure). */
export function toCameraList(devices: readonly DeviceInfoLike[]): CameraInfo[] {
  return devices
    .filter((d) => d.kind === 'videoinput')
    .map((d) => ({ deviceId: d.deviceId, label: d.label, rear: isRearCamera(d) }));
}

/** The cameras of this browser; empty without a camera API. */
export async function listCameras(): Promise<CameraInfo[]> {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (!md || typeof md.enumerateDevices !== 'function') return [];
  return toCameraList(await md.enumerateDevices());
}
