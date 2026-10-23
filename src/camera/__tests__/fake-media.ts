/**
 * Test doubles for `navigator.mediaDevices`, `MediaStream` and
 * `MediaStreamTrack` (Node has `EventTarget` and `Event`, nothing else).
 * Used by the camera and tracker unit tests; not part of the build.
 */
import type { DeviceInfoLike } from '../list.js';
import type { MediaDevicesLike } from '../open.js';

export class FakeTrack extends EventTarget {
  readonly kind = 'video';
  readyState: 'live' | 'ended' = 'live';
  muted = false;
  stopped = false;
  readonly applied: MediaTrackConstraints[] = [];
  /** what the browser does with each `advanced` set (default: nothing, settings unchanged) */
  onApply: ((set: Record<string, unknown>, track: FakeTrack) => void) | null = null;

  constructor(
    readonly deviceId: string,
    readonly label: string,
    readonly caps: Record<string, unknown> = {},
    readonly settings: Record<string, unknown> = {},
  ) {
    super();
  }

  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId, ...this.settings };
  }
  getCapabilities(): MediaTrackCapabilities {
    return this.caps as MediaTrackCapabilities;
  }
  applyConstraints(c: MediaTrackConstraints): Promise<void> {
    this.applied.push(c);
    try {
      for (const set of c.advanced ?? []) this.onApply?.(set as Record<string, unknown>, this);
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    return Promise.resolve();
  }
  stop(): void {
    this.stopped = true;
    this.readyState = 'ended'; // stop() fires no 'ended' event (spec)
  }

  /** test helpers: what the browser would do */
  mute(): void {
    this.muted = true;
    this.dispatchEvent(new Event('mute'));
  }
  unmute(): void {
    this.muted = false;
    this.dispatchEvent(new Event('unmute'));
  }
  end(): void {
    this.readyState = 'ended';
    this.dispatchEvent(new Event('ended'));
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks;
  }
}

export interface FakeDevice {
  deviceId: string;
  label: string;
  zoom?: { min: number; max: number };
  /** more capabilities and settings of its tracks (e.g. Image Capture exposure) */
  caps?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  onApply?: FakeTrack['onApply'];
}

/**
 * `getUserMedia` opens `deviceId.exact` when given, else `defaultId`
 * (what `facingMode: 'environment'` would pick). `fail` makes the next calls reject.
 */
export class FakeMediaDevices implements MediaDevicesLike {
  readonly calls: MediaStreamConstraints[] = [];
  readonly opened: FakeTrack[] = [];
  fail: Error[] = [];

  constructor(
    readonly devices: FakeDevice[],
    readonly defaultId: string,
  ) {}

  getUserMedia(c: MediaStreamConstraints): Promise<MediaStream> {
    this.calls.push(c);
    const err = this.fail.shift();
    if (err) return Promise.reject(err);
    const video = typeof c.video === 'object' ? c.video : {};
    const exact =
      typeof video.deviceId === 'object' && !Array.isArray(video.deviceId)
        ? (video.deviceId.exact as string | undefined)
        : undefined;
    const id = exact ?? this.defaultId;
    const dev = this.devices.find((d) => d.deviceId === id);
    if (!dev) return Promise.reject(domError('OverconstrainedError'));
    const caps = { ...dev.caps, ...(dev.zoom ? { zoom: dev.zoom } : {}) };
    const track = new FakeTrack(dev.deviceId, dev.label, caps, { ...dev.settings });
    track.onApply = dev.onApply ?? null;
    this.opened.push(track);
    return Promise.resolve(new FakeStream([track]) as unknown as MediaStream);
  }

  enumerateDevices(): Promise<DeviceInfoLike[]> {
    return Promise.resolve(
      this.devices.map((d) => ({ kind: 'videoinput', deviceId: d.deviceId, label: d.label })),
    );
  }
}

/** An Error whose `name` is a DOMException name. */
export function domError(name: string, message = name): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}
