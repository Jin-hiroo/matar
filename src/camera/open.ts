/**
 * Opening the camera with lens pinning (ARCHITECTURE.md §6.1).
 *
 * `openCamera(mediaDevices, platform, request)`:
 * 1. `getUserMedia(cameraConstraints(request))` (permission prompt);
 * 2. `enumerateDevices()` (labels are filled now);
 * 3. `chooseLens` (pure, src/camera/lens.ts) on the platform, the devices and
 *    the open track;
 * 4. reopen on the chosen deviceId (stopping the first stream), or apply
 *    `zoom` to the open track. If reopening fails, the default device is
 *    opened again and reported as `'unknown'`.
 *
 * `reopenCamera` re-acquires exactly the same device and settings after the
 * track `ended` (iOS ends tracks in the background, §6.4).
 *
 * Errors from `getUserMedia` propagate unchanged; the tracker maps them with
 * `toCameraError` (src/camera/errors.ts). `mediaDevices` is injected so this
 * runs in tests without a browser.
 */
import type { LensKind } from '../types.js';
import { cameraConstraints, type CameraRequest } from './constraints.js';
import { MatarError } from './errors.js';
import { chooseLens, type LensDecision, type TrackLensInfo } from './lens.js';
import { toCameraList, type CameraInfo, type DeviceInfoLike } from './list.js';
import type { Platform } from './platform.js';

/** The parts of `navigator.mediaDevices` used here. */
export interface MediaDevicesLike {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  enumerateDevices(): Promise<readonly DeviceInfoLike[]>;
}

export interface OpenedCamera {
  stream: MediaStream;
  track: MediaStreamTrack;
  /** the open device; reopening uses it `exact` */
  deviceId: string;
  label: string;
  lens: LensKind;
  /** zoom applied to the track (iOS virtual device at the wide framing), or null */
  zoom: number | null;
  /** size and rate asked for (without deviceId) */
  request: CameraRequest;
  /** every `videoinput` (labels after permission), for the demo HUD and pickers */
  devices: CameraInfo[];
}

/** Stops every track of a stream. */
export function stopStream(stream: MediaStream): void {
  for (const t of stream.getTracks()) t.stop();
}

/** Device, label and zoom capability of an open track. */
export function trackLensInfo(track: MediaStreamTrack): TrackLensInfo {
  const settings = track.getSettings() as MediaTrackSettings & { zoom?: number };
  let caps: { zoom?: { min?: number; max?: number } } = {};
  try {
    caps = (track.getCapabilities?.() ?? {}) as typeof caps;
  } catch {
    caps = {}; // Firefox has no getCapabilities on some versions
  }
  const info: TrackLensInfo = { deviceId: settings.deviceId ?? '', label: track.label };
  const z = caps.zoom;
  if (z && typeof z.min === 'number' && typeof z.max === 'number') {
    info.zoom = { min: z.min, max: z.max };
  }
  if (typeof settings.zoom === 'number') info.zoomSetting = settings.zoom;
  return info;
}

function firstVideoTrack(stream: MediaStream): MediaStreamTrack {
  const track = stream.getVideoTracks()[0];
  if (!track) {
    stopStream(stream);
    throw new MatarError('no-camera', 'getUserMedia returned no video track');
  }
  return track;
}

async function applyZoom(track: MediaStreamTrack, zoom: number): Promise<boolean> {
  const set: MediaTrackConstraintSet & { zoom?: number } = { zoom };
  try {
    await track.applyConstraints({ advanced: [set] });
    return true;
  } catch {
    return false; // zoom is best effort
  }
}

/** Opens the rear camera and pins one lens where the platform allows (§6.1). */
export async function openCamera(
  md: MediaDevicesLike,
  platform: Platform,
  request: CameraRequest = {},
): Promise<OpenedCamera> {
  const { deviceId: requested, ...size } = request;
  let stream = await md.getUserMedia(cameraConstraints(request));
  let track = firstVideoTrack(stream);
  let devices: readonly DeviceInfoLike[];
  try {
    devices = await md.enumerateDevices();
  } catch {
    devices = [];
  }
  const cameras = toCameraList(devices);
  const decision: LensDecision = chooseLens(platform, cameras, trackLensInfo(track), requested);

  let lens = decision.lens;
  let zoom: number | null = null;
  if (decision.action === 'reopen') {
    stopStream(stream);
    try {
      stream = await md.getUserMedia(cameraConstraints({ ...size, deviceId: decision.deviceId }));
    } catch {
      stream = await md.getUserMedia(cameraConstraints(size)); // back to the default device
      lens = 'unknown';
    }
    track = firstVideoTrack(stream);
  } else if (decision.zoom !== null && (await applyZoom(track, decision.zoom))) {
    zoom = decision.zoom;
  }

  const info = trackLensInfo(track);
  return {
    stream,
    track,
    deviceId: info.deviceId || (decision.action === 'reopen' ? decision.deviceId : ''),
    label: track.label,
    lens,
    zoom,
    request: size,
    devices: cameras,
  };
}

/** Re-acquires the same device with the same settings (after `ended`, §6.4). */
export async function reopenCamera(
  md: MediaDevicesLike,
  prev: OpenedCamera,
): Promise<OpenedCamera> {
  const stream = await md.getUserMedia(
    cameraConstraints(prev.deviceId ? { ...prev.request, deviceId: prev.deviceId } : prev.request),
  );
  const track = firstVideoTrack(stream);
  const zoom = prev.zoom !== null && (await applyZoom(track, prev.zoom)) ? prev.zoom : null;
  return { ...prev, stream, track, label: track.label || prev.label, zoom };
}
