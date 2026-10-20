import { describe, expect, it } from 'vitest';
import {
  androidBackCameraIndex,
  cameraConstraints,
  cameraErrorCode,
  checkCameraEnvironment,
  chooseLens,
  classifyLensLabel,
  detectPlatform,
  MatarError,
  openCamera,
  reopenCamera,
  toCameraError,
  toCameraList,
  type TrackLensInfo,
} from './index.js';
import { domError, FakeMediaDevices } from './__tests__/fake-media.js';

const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  linux:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141 Safari/537.36',
};

describe('cameraConstraints', () => {
  it('defaults to the rear camera at 1280 × 720, 30 fps, all ideal', () => {
    expect(cameraConstraints()).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
  });
  it('a deviceId is exact and replaces facingMode', () => {
    const c = cameraConstraints({ deviceId: 'abc', width: 640, height: 480, frameRate: 24 });
    expect(c.video).toEqual({
      deviceId: { exact: 'abc' },
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 24 },
    });
  });
});

describe('detectPlatform', () => {
  it('classifies user agents', () => {
    expect(detectPlatform(UA.iphone, 5)).toBe('ios');
    expect(detectPlatform(UA.chromeIos, 5)).toBe('ios'); // WebKit underneath
    expect(detectPlatform(UA.ipadDesktop, 5)).toBe('ios'); // iPadOS desktop UA
    expect(detectPlatform(UA.ipadDesktop, 0)).toBe('other'); // a real Mac
    expect(detectPlatform(UA.android, 5)).toBe('android');
    expect(detectPlatform(UA.desktopChrome, 0)).toBe('other');
    expect(detectPlatform(UA.linux)).toBe('other');
    expect(detectPlatform('')).toBe('other');
  });
});

describe('chooseLens', () => {
  const iosInputs = [
    { deviceId: 'front', label: 'Front Camera' },
    { deviceId: 'triple', label: 'Back Triple Camera' },
    { deviceId: 'dualwide', label: 'Back Dual Wide Camera' },
    { deviceId: 'uw', label: 'Back Ultra Wide Camera' },
    { deviceId: 'wide', label: 'Back Camera' },
    { deviceId: 'tele', label: 'Back Telephoto Camera' },
  ];
  const virtualTrack: TrackLensInfo = {
    deviceId: 'triple',
    label: 'Back Triple Camera',
    zoom: { min: 0.5, max: 15 },
    zoomSetting: 0.5,
  };

  it('iOS: reopens on "Back Camera" (pinned)', () => {
    expect(chooseLens('ios', iosInputs, virtualTrack)).toEqual({
      action: 'reopen',
      lens: 'pinned',
      deviceId: 'wide',
      label: 'Back Camera',
    });
  });
  it('iOS: already on "Back Camera" → keep, pinned, no zoom', () => {
    const d = chooseLens('ios', iosInputs, { deviceId: 'wide', label: 'Back Camera' });
    expect(d).toEqual({
      action: 'keep',
      lens: 'pinned',
      deviceId: 'wide',
      label: 'Back Camera',
      zoom: null,
    });
  });
  it('iOS, localised labels: stays virtual and asks for zoom 1 when zoom.min < 1', () => {
    const ja = [
      { deviceId: 'front', label: '前面カメラ' },
      { deviceId: 'triple', label: '背面トリプルカメラ' },
      { deviceId: 'wide', label: '背面カメラ' },
    ];
    const track = { ...virtualTrack, label: '背面トリプルカメラ' };
    expect(chooseLens('ios', ja, track)).toEqual({
      action: 'keep',
      lens: 'virtual',
      deviceId: 'triple',
      label: '背面トリプルカメラ',
      zoom: 1,
    });
  });
  it('iOS virtual: no zoom when zoom.min ≥ 1, already 1, or no capability', () => {
    const noWide = iosInputs.filter((d) => d.label !== 'Back Camera');
    const zoomAt = (t: TrackLensInfo) => {
      const d = chooseLens('ios', noWide, t);
      return d.action === 'keep' ? [d.lens, d.zoom] : null;
    };
    expect(zoomAt({ ...virtualTrack, zoom: { min: 1, max: 10 } })).toEqual(['virtual', null]);
    expect(zoomAt({ ...virtualTrack, zoomSetting: 1 })).toEqual(['virtual', null]);
    expect(zoomAt({ deviceId: 'triple', label: 'Back Triple Camera' })).toEqual(['virtual', null]);
    expect(zoomAt({ ...virtualTrack, zoomSetting: undefined })).toEqual(['virtual', 1]);
  });
  it('Android: lowest camera2 N, facing back', () => {
    const inputs = [
      { deviceId: 'f', label: 'camera2 1, facing front' },
      { deviceId: 'b4', label: 'camera2 4, facing back' },
      { deviceId: 'b2', label: 'camera2 2, facing back' },
      { deviceId: 'b0', label: 'camera2 0, facing back' },
      { deviceId: 'b3', label: 'camera2 3, facing back' },
    ];
    expect(
      chooseLens('android', inputs, { deviceId: 'b2', label: 'camera2 2, facing back' }),
    ).toEqual({
      action: 'reopen',
      lens: 'pinned',
      deviceId: 'b0',
      label: 'camera2 0, facing back',
    });
    const keep = chooseLens('android', inputs, { deviceId: 'b0', label: 'camera2 0, facing back' });
    expect(keep).toMatchObject({ action: 'keep', lens: 'pinned', deviceId: 'b0', zoom: null });
  });
  it('Android: two-digit N compares numerically', () => {
    const inputs = [
      { deviceId: 'b10', label: 'camera2 10, facing back' },
      { deviceId: 'b9', label: 'camera2 9, facing back' },
    ];
    expect(chooseLens('android', inputs, { deviceId: 'b10', label: '' })).toMatchObject({
      action: 'reopen',
      deviceId: 'b9',
    });
  });
  it('Android without camera2 labels → keep, unknown', () => {
    const inputs = [{ deviceId: 'x', label: 'Back camera' }];
    expect(chooseLens('android', inputs, { deviceId: 'x', label: 'Back camera' })).toMatchObject({
      action: 'keep',
      lens: 'unknown',
    });
  });
  it('a requested deviceId is kept as is, on every platform', () => {
    for (const p of ['ios', 'android', 'other'] as const) {
      const d = chooseLens(p, iosInputs, virtualTrack, 'triple');
      expect(d.action).toBe('keep');
      if (d.action === 'keep') expect(d.zoom).toBeNull();
    }
    expect(chooseLens('ios', iosInputs, virtualTrack, 'triple').lens).toBe('virtual');
    expect(
      chooseLens('ios', iosInputs, { deviceId: 'wide', label: 'Back Camera' }, 'wide').lens,
    ).toBe('pinned');
    expect(
      chooseLens('android', [], { deviceId: 'b1', label: 'camera2 1, facing back' }, 'b1').lens,
    ).toBe('pinned');
    expect(chooseLens('other', [], { deviceId: 'w', label: 'FaceTime HD' }, 'w').lens).toBe(
      'unknown',
    );
  });
  it('unknown platforms keep the open track', () => {
    expect(chooseLens('other', iosInputs, virtualTrack)).toEqual({
      action: 'keep',
      lens: 'unknown',
      deviceId: 'triple',
      label: 'Back Triple Camera',
      zoom: null,
    });
  });
  it('label helpers', () => {
    expect(androidBackCameraIndex('camera2 0, facing back')).toBe(0);
    expect(androidBackCameraIndex(' camera2 12, facing back ')).toBe(12);
    expect(androidBackCameraIndex('camera2 1, facing front')).toBeNull();
    expect(classifyLensLabel('ios', 'Back Ultra Wide Camera')).toBe('unknown');
    expect(classifyLensLabel('other', 'camera2 0, facing back')).toBe('unknown');
  });
});

describe('errors', () => {
  it('maps getUserMedia rejections to codes', () => {
    const cases: [string, string][] = [
      ['NotAllowedError', 'permission-denied'],
      ['SecurityError', 'permission-denied'],
      ['PermissionDeniedError', 'permission-denied'],
      ['NotFoundError', 'no-camera'],
      ['DevicesNotFoundError', 'no-camera'],
      ['NotReadableError', 'camera-in-use'],
      ['TrackStartError', 'camera-in-use'],
      ['AbortError', 'camera-in-use'],
      ['OverconstrainedError', 'overconstrained'],
      ['ConstraintNotSatisfiedError', 'overconstrained'],
      ['TypeError', 'unknown'],
      ['Whatever', 'unknown'],
    ];
    for (const [name, code] of cases) expect(cameraErrorCode(domError(name))).toBe(code);
    expect(cameraErrorCode('nope')).toBe('unknown');
    expect(cameraErrorCode(null)).toBe('unknown');
    expect(cameraErrorCode({ name: 'NotAllowedError' })).toBe('permission-denied');
  });
  it('checks the environment: insecure first, then the API', () => {
    expect(checkCameraEnvironment({ isSecureContext: false, hasGetUserMedia: false })).toBe(
      'insecure-context',
    );
    expect(checkCameraEnvironment({ isSecureContext: false, hasGetUserMedia: true })).toBe(
      'insecure-context',
    );
    expect(checkCameraEnvironment({ isSecureContext: true, hasGetUserMedia: false })).toBe(
      'no-camera-api',
    );
    expect(
      checkCameraEnvironment({ isSecureContext: undefined, hasGetUserMedia: true }),
    ).toBeNull();
    expect(checkCameraEnvironment({ isSecureContext: true, hasGetUserMedia: true })).toBeNull();
  });
  it('toCameraError keeps the code, message and cause', () => {
    const cause = domError('NotAllowedError', 'Permission denied by user');
    const e = toCameraError(cause);
    expect(e).toBeInstanceOf(MatarError);
    expect(e.code).toBe('permission-denied');
    expect(e.message).toContain('Permission denied by user');
    expect(e.cause).toBe(cause);
    expect(toCameraError(e)).toBe(e);
  });
});

describe('toCameraList', () => {
  it('keeps videoinputs and guesses rear', () => {
    const list = toCameraList([
      { kind: 'audioinput', deviceId: 'mic', label: 'Mic' },
      { kind: 'videoinput', deviceId: 'a', label: 'camera2 0, facing back' },
      { kind: 'videoinput', deviceId: 'b', label: 'camera2 1, facing front' },
      { kind: 'videoinput', deviceId: 'c', label: 'Back Camera' },
      { kind: 'videoinput', deviceId: 'd', label: '' },
      {
        kind: 'videoinput',
        deviceId: 'e',
        label: 'USB cam',
        getCapabilities: () => ({ facingMode: ['environment'] }),
      },
      {
        kind: 'videoinput',
        deviceId: 'f',
        label: 'Back thing',
        getCapabilities: () => ({ facingMode: ['user'] }),
      },
    ]);
    expect(list.map((c) => [c.deviceId, c.rear])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
      ['d', false],
      ['e', true],
      ['f', false],
    ]);
  });
});

describe('openCamera', () => {
  const iosDevices = [
    { deviceId: 'front', label: 'Front Camera' },
    { deviceId: 'triple', label: 'Back Triple Camera', zoom: { min: 0.5, max: 15 } },
    { deviceId: 'wide', label: 'Back Camera', zoom: { min: 1, max: 10 } },
  ];

  it('iOS: opens with facingMode, then reopens on Back Camera', async () => {
    const md = new FakeMediaDevices(iosDevices, 'triple');
    const cam = await openCamera(md, 'ios', {});
    expect(md.calls).toHaveLength(2);
    expect(md.calls[1]?.video).toMatchObject({ deviceId: { exact: 'wide' } });
    expect(md.opened[0]?.stopped).toBe(true); // first stream released
    expect(cam).toMatchObject({
      deviceId: 'wide',
      label: 'Back Camera',
      lens: 'pinned',
      zoom: null,
    });
    expect(cam.devices.map((d) => d.label)).toEqual(iosDevices.map((d) => d.label));
  });
  it('iOS without the wide label: virtual + zoom 1 applied', async () => {
    const md = new FakeMediaDevices(iosDevices.slice(0, 2), 'triple');
    const cam = await openCamera(md, 'ios', {});
    expect(md.calls).toHaveLength(1);
    expect(cam).toMatchObject({ deviceId: 'triple', lens: 'virtual', zoom: 1 });
    expect(md.opened[0]?.applied).toEqual([{ advanced: [{ zoom: 1 }] }]);
  });
  it('a failed reopen falls back to the default device, lens unknown', async () => {
    const md = new FakeMediaDevices(iosDevices, 'triple');
    const orig = md.getUserMedia.bind(md);
    let n = 0;
    md.getUserMedia = (c) => (++n === 2 ? Promise.reject(domError('NotReadableError')) : orig(c));
    const cam = await openCamera(md, 'ios', {});
    expect(n).toBe(3);
    expect(cam).toMatchObject({ deviceId: 'triple', lens: 'unknown' });
  });
  it('Android: reopens on camera2 0', async () => {
    const md = new FakeMediaDevices(
      [
        { deviceId: 'b2', label: 'camera2 2, facing back' },
        { deviceId: 'b0', label: 'camera2 0, facing back' },
      ],
      'b2',
    );
    const cam = await openCamera(md, 'android', { width: 1920, height: 1080 });
    expect(cam).toMatchObject({ deviceId: 'b0', lens: 'pinned' });
    expect(md.calls[1]?.video).toMatchObject({ deviceId: { exact: 'b0' }, width: { ideal: 1920 } });
  });
  it('deviceId override: one exact open, nothing else', async () => {
    const md = new FakeMediaDevices(iosDevices, 'triple');
    const cam = await openCamera(md, 'ios', { deviceId: 'triple' });
    expect(md.calls).toHaveLength(1);
    expect(md.calls[0]?.video).toMatchObject({ deviceId: { exact: 'triple' } });
    expect(cam).toMatchObject({ deviceId: 'triple', lens: 'virtual', zoom: null });
  });
  it('getUserMedia errors propagate; reopenCamera reuses device, size and zoom', async () => {
    const md = new FakeMediaDevices(iosDevices.slice(0, 2), 'triple');
    md.fail.push(domError('NotAllowedError'));
    await expect(openCamera(md, 'ios', {})).rejects.toMatchObject({ name: 'NotAllowedError' });
    const cam = await openCamera(md, 'ios', { width: 640, height: 480 });
    const again = await reopenCamera(md, cam);
    expect(md.calls.at(-1)?.video).toMatchObject({
      deviceId: { exact: 'triple' },
      width: { ideal: 640 },
      height: { ideal: 480 },
    });
    expect(again.track).not.toBe(cam.track);
    expect(again).toMatchObject({ lens: 'virtual', zoom: 1, deviceId: 'triple' });
  });
});
