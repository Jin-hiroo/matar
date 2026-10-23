/**
 * matar demo (TASKS.md C4): print the test board, start the camera, see axes
 * and a 50 mm cube on the printed board, read the debug HUD (the fields
 * DEVICE-TESTS.md asks for).
 *
 * URL flags: `?inline` (no worker), `?debug` (frame index + gray thumbnail,
 * `window.__matar` for the e2e test), `?bg=frame` (default: the analysed frame
 * behind the content, uploaded from the `VideoFrame`), `?bg=video` (the same,
 * uploaded from the `<video>`), `?bg=live` (the newest camera frame with an
 * extrapolated pose: lower latency), `?pose=smoothed` (One Euro output instead
 * of each frame's own pose), `?fov=85` (the long-side field of view to start
 * from instead of the 68° prior; the report's `fit` line suggests one),
 * `?exposure=4` (a manual exposure time in ms, where the camera allows it, with
 * the ISO raised to keep the brightness; `&iso=800` sets the ISO instead; a
 * demo experiment against motion blur, the library leaves exposure alone),
 * `?fresh` (forget the saved calibration). The focal length the tracker
 * measures is saved in `localStorage` with the camera's label; the next
 * Start opens that camera and begins from it (`TrackerOptions.intrinsics`),
 * unless `?fov=` or `?fresh` is given. After
 * Start, **Mode** switches between `frame`
 * and `live` without a reload, and **Copy report** copies the last 5 s of
 * timings (demo/report.ts).
 */
import {
  AxesHelper,
  BoxGeometry,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { boardSvg } from '../src/board/index.js';
import { FOCAL_DEFAULTS } from '../src/pose/focal.js';
import { MatarThree, mmToM } from '../src/three/index.js';
import { createTracker } from '../src/tracker/index.js';
import type {
  CameraIntrinsics,
  IntrinsicsEvent,
  PoseEvent,
  TrackerErrorEvent,
} from '../src/types.js';
import { DEMO_ORIGIN_MM, DEMO_PAGE_MM, demoBoard } from './board.js';
import { Report, type ReportContext } from './report.js';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const inline = params.has('inline');
let bg = params.get('bg') ?? 'frame';
const poseKind = params.get('pose') === 'smoothed' ? 'smoothed' : 'raw';
/** `?fov=`: the long-side field of view to start from, degrees (default: the library's 68° prior) */
const fovDeg = Number(params.get('fov'));
/** `?exposure=`: a manual exposure time, ms; `?iso=`: its ISO (default: keep the brightness) */
const exposureReqMs = Number(params.get('exposure'));
const isoReq = Number(params.get('iso'));
/** what became of `?exposure=`, for the report */
let exposureNote = '';

/**
 * A self-calibration saved in `localStorage`: the camera it was measured on
 * (its label: deviceIds can change between page loads) and the result.
 */
interface SavedCalibration {
  label: string;
  intrinsics: CameraIntrinsics;
}
const SAVED_KEY = 'matar-demo-calibration';
if (params.has('fresh')) forgetCalibration();
const saved = fovDeg || params.has('fresh') ? null : loadCalibration();
/** where the focal length came from, for the report */
let calibrationNote = 'nothing saved used';
/** when the first frame the self-calibration could use arrived (≥ 6 tags at ≥ 20° tilt), performance.now() ms */
let firstUsableMs: number | null = null;
/** how long after it the first estimate came, once it has */
let firstEstimateNote = '';

const board = demoBoard();
const hud = document.getElementById('hud') as HTMLPreElement;
const thumb = document.getElementById('thumb') as HTMLCanvasElement;
const modeButton = document.getElementById('mode') as HTMLButtonElement;
const copyButton = document.getElementById('copy') as HTMLButtonElement;
const reportBox = document.getElementById('report') as HTMLTextAreaElement;

/** What the e2e test reads (debug only). */
interface DebugState {
  events: {
    frameId: number;
    t: number;
    index: number | null;
    tags: number;
    pose: number[] | null;
    worker: string;
    w: number;
    h: number;
    fx: number;
  }[];
  errors: string[];
  states: string[];
}
const dbg: DebugState = { events: [], errors: [], states: [] };
if (debug) (window as unknown as { __matar: DebugState }).__matar = dbg;

document.getElementById('print')!.addEventListener('click', printBoard); // `!`: in index.html
document.getElementById('start')!.addEventListener('click', () => void start(), { once: true });

function printBoard(): void {
  const svg = boardSvg(board, {
    pageMm: DEMO_PAGE_MM,
    originMm: DEMO_ORIGIN_MM,
    title: 'matar demo board',
  });
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(
    `<!doctype html><title>matar demo board</title><style>@page{size:A4;margin:0}html,body{margin:0}svg{display:block}</style>${svg}`,
  );
  w.document.close();
  w.focus();
  w.print();
}

async function start(): Promise<void> {
  // the saved camera's deviceId now; labels are listed before getUserMedia only
  // once camera permission was granted for good
  const deviceId = saved ? await deviceIdFor(saved.label) : null;
  const restore = saved && deviceId ? { intrinsics: saved.intrinsics, camera: { deviceId } } : null;
  if (saved) {
    calibrationNote = restore
      ? `started from the one saved for ${saved.label} (${saved.intrinsics.fx.toFixed(1)} px)`
      : `the one saved for ${saved.label} not used: no camera of that name listed before Start`;
  }
  const tracker = createTracker({
    board,
    worker: inline ? false : undefined,
    debug,
    ...(fovDeg > 10 && fovDeg < 170 ? { fovPriorDeg: fovDeg } : {}),
    ...restore,
  });
  tracker.addEventListener('intrinsics', (e) => {
    const { intrinsics, source } = e as IntrinsicsEvent;
    const label = (tracker.video.srcObject as MediaStream | null)?.getVideoTracks()[0]?.label;
    if (source !== 'estimated' || !label) return;
    if (!firstEstimateNote && firstUsableMs !== null) {
      firstEstimateNote = `; first estimate ${((performance.now() - firstUsableMs) / 1000).toFixed(1)} s after the first frame it could use`;
    }
    saveCalibration({ label, intrinsics });
    calibrationNote = `${restore ? 'started from a saved one, ' : ''}measured one saved for ${label}`;
  });

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('view')!.appendChild(renderer.domElement); // `!`: in index.html
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 10);
  const report = new Report(board);
  // time in the grab event (the synced texture upload): listeners run in order, so
  // MatarThree's goes between these two
  let grabT0 = 0;
  tracker.addEventListener('grab', () => (grabT0 = performance.now()));
  const onGrabDone = () => {
    const now = performance.now();
    report.addGrab(now - grabT0, now);
  };
  const makeAr = () => {
    tracker.removeEventListener('grab', onGrabDone);
    const made = new MatarThree({
      tracker,
      renderer,
      camera,
      scene,
      background: bg === 'live' ? 'live' : 'synced',
      textureSource: bg === 'video' ? 'video' : 'frame',
      pose: poseKind,
    });
    tracker.addEventListener('grab', onGrabDone);
    return made;
  };
  let ar = makeAr();

  // content in board coordinates, metres: axes on the origin cross, a 50 mm cube on the paper
  const content = new Group();
  content.add(new AxesHelper(60 * mmToM));
  const cube = new BoxGeometry(50 * mmToM, 50 * mmToM, 50 * mmToM);
  const box = new Mesh(cube, new MeshNormalMaterial({ transparent: true, opacity: 0.55 }));
  box.position.y = 25 * mmToM;
  const edges = new LineSegments(
    new EdgesGeometry(cube),
    new LineBasicMaterial({ color: 0xffffff }),
  );
  edges.position.y = 25 * mmToM;
  content.add(box, edges);
  scene.add(content);

  window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));

  let last: PoseEvent | null = null;
  const recent: [number, number, number][] = [];
  let renderMs = 0;
  let hudAt = 0;
  let bgAgeMs: number | null = null;
  let poseAgeMs: number | null = null;
  // frame times of the last poses, to age the one on screen
  const frameT = new Map<number, number>();
  // the newest camera frame, which the live background shows
  let cameraT: number | null = null;
  const video = tracker.video;
  const onCameraFrame = (now: number, meta: VideoFrameCallbackMetadata): void => {
    cameraT = meta.expectedDisplayTime || now;
    report.addCameraFrame(cameraT);
    video.requestVideoFrameCallback(onCameraFrame);
  };
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onCameraFrame);

  document.getElementById('print')!.style.display = 'none'; // `!`: in index.html
  document.getElementById('start')!.style.display = 'none';
  modeButton.style.display = copyButton.style.display = '';
  modeButton.textContent = `Mode: ${bg}`;
  modeButton.addEventListener('click', () => {
    bg = bg === 'live' ? 'frame' : 'live';
    ar.dispose();
    ar = makeAr();
    report.reset();
    modeButton.textContent = `Mode: ${bg}`;
    params.set('bg', bg);
    history.replaceState(null, '', `?${params.toString()}`);
  });
  copyButton.addEventListener('click', () => {
    const text = report.text(reportContext(video), performance.now());
    reportBox.value = text;
    const copied =
      navigator.clipboard?.writeText(text) ?? Promise.reject(new Error('no clipboard'));
    copied.then(
      () => flash(copyButton, 'Copied', 'Copy report'),
      () => {
        // no clipboard access: show it for a manual copy
        reportBox.style.display = 'block';
        reportBox.select();
      },
    );
  });
  reportBox.addEventListener('blur', () => (reportBox.style.display = 'none'));

  tracker.addEventListener('pose', (e) => {
    last = e;
    report.addPose(e, performance.now());
    const m = e.pose?.boardFromCamera;
    if (
      firstUsableMs === null &&
      m &&
      e.pose!.usedTagIds.length >= FOCAL_DEFAULTS.minTags && // `!`: m is from it
      Math.acos(Math.min(1, m[9]!)) >= (FOCAL_DEFAULTS.minTiltDeg * Math.PI) / 180 // `!`: Mat4 has 16 entries
    ) {
      firstUsableMs = performance.now();
    }
    frameT.set(e.frameId, e.timestampMs);
    if (frameT.size > 16) frameT.delete(frameT.keys().next().value!); // `!`: size > 0
    const s = e.smoothed;
    if (s) {
      recent.push([s[12]!, s[13]!, s[14]!]); // `!`: Mat4 has 16 entries
      if (recent.length > 30) recent.shift();
    } else recent.length = 0;
    if (debug) {
      dbg.events.push({
        frameId: e.frameId,
        t: e.timestampMs,
        index: e.debugFrameIndex,
        tags: e.detections.length,
        pose: e.pose ? Array.from(e.pose.boardFromCamera) : null,
        worker: e.stats.worker,
        w: e.intrinsics.width,
        h: e.intrinsics.height,
        fx: e.intrinsics.fx,
      });
      if (dbg.events.length > 2000) dbg.events.shift();
      if (e.thumbnail) drawThumb(e.thumbnail.width, e.thumbnail.height, e.thumbnail.data);
    }
  });
  tracker.addEventListener('state', () => dbg.states.push(tracker.state));
  tracker.addEventListener('error', (e) => {
    const err = e as TrackerErrorEvent;
    dbg.errors.push(`${err.code}: ${err.message}`);
    hud.textContent = `error ${err.code}: ${err.message}`;
    if (restore && tracker.state === 'starting') {
      // opening the saved camera failed (it may be gone): start without it next time
      forgetCalibration();
      hud.textContent += '\n(the saved calibration is cleared: reload and Start again)';
    }
  });

  renderer.setAnimationLoop(() => {
    const t0 = performance.now();
    const u = ar.update();
    content.visible = u.tracking;
    renderer.render(scene, camera);
    const now = performance.now();
    renderMs += 0.1 * (now - t0 - renderMs);
    const poseT = frameT.get(u.frameId);
    poseAgeMs = poseT === undefined ? null : t0 - poseT;
    bgAgeMs = bg === 'live' ? (cameraT === null ? null : t0 - cameraT) : poseAgeMs;
    report.addRender({ at: now, renderMs: now - t0, bgAgeMs, poseAgeMs });
    // the HUD is text layout: refresh it 5× a second, not every frame
    if (last && now - hudAt > 200) {
      hudAt = now;
      hud.textContent = hudText(last, jitterMm(recent), renderMs, bgAgeMs, poseAgeMs);
    }
  });

  try {
    await tracker.start();
  } catch {
    return; // shown by the error listener
  }
  if (exposureReqMs > 0) {
    const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
    exposureNote = `; ?exposure=${exposureReqMs}: no camera track`;
    if (track) void setExposure(track, exposureReqMs, isoReq > 0 ? isoReq : null);
  }
}

/**
 * `?exposure=`: manual exposure on the camera track (Image Capture
 * constraints, Chrome on Android). Without an ISO, scales the current one by
 * the exposure ratio, clamped to the camera's range, so the image stays about
 * as bright. Keeps `exposureNote` current for the report, also while the
 * browser hasn't answered.
 */
async function setExposure(track: MediaStreamTrack, timeMs: number, iso: number | null) {
  exposureNote = `; ?exposure=${timeMs}: checking the camera`;
  exposureNote = await applyExposure(track, timeMs, iso);
}

async function applyExposure(
  track: MediaStreamTrack,
  timeMs: number,
  iso: number | null,
): Promise<string> {
  const st = track.getSettings() as ExposureSettings;
  let caps: ExposureCapabilities = {};
  try {
    caps = (track.getCapabilities?.() ?? {}) as ExposureCapabilities;
  } catch {
    // nothing reported
  }
  if (!caps.exposureMode?.includes('manual')) return `; ?exposure=${timeMs}: no manual mode`;
  const clamp = (v: number, r: { min?: number; max?: number } | undefined) =>
    Math.min(r?.max ?? v, Math.max(r?.min ?? v, v));
  const time = clamp(timeMs * 10, caps.exposureTime); // 100 µs units
  const want: Record<string, unknown> = { exposureMode: 'manual', exposureTime: time };
  if (iso === null && st.iso !== undefined && st.exposureTime) {
    iso = (st.iso * st.exposureTime) / time;
  }
  if (iso !== null) want.iso = Math.round(clamp(iso, caps.iso));
  const asked = `${(time / 10).toFixed(1)} ms${want.iso === undefined ? '' : ` ISO ${String(want.iso)}`}`;
  exposureNote = `; ?exposure=${timeMs}: asked ${asked}, no answer from the browser yet`;
  try {
    await track.applyConstraints({ advanced: [want as MediaTrackConstraintSet] });
  } catch (e) {
    return `; ?exposure=${timeMs}: ${asked} failed (${e instanceof Error ? `${e.name}: ${e.message}` : String(e)})`;
  }
  // Chrome resolved this once with the ISO applied and the time left at 10 ms
  // (DEVICE-TESTS.md, 2026-10-23): read the settings back after a moment
  await new Promise((r) => setTimeout(r, 500));
  const got = (track.getSettings() as ExposureSettings).exposureTime;
  const took =
    got === undefined || Math.abs(got - time) <= 1
      ? ''
      : `, but the camera reports ${(got / 10).toFixed(1)} ms 0.5 s later`;
  return `; ?exposure=${timeMs}: asked ${asked}, accepted${took}`;
}

function loadCalibration(): SavedCalibration | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? 'null') as SavedCalibration | null;
    const k = v?.intrinsics;
    const ok =
      typeof v?.label === 'string' &&
      v.label !== '' &&
      k !== undefined &&
      [k.width, k.height, k.fx, k.fy, k.cx, k.cy].every((x) => Number.isFinite(x) && x > 0);
    return ok ? v : null;
  } catch {
    return null; // storage blocked or not JSON
  }
}

/** The deviceId of the `videoinput` labelled `label`, or null (not listed, or no labels yet). */
async function deviceIdFor(label: string): Promise<string | null> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return (
      devices.find((d) => d.kind === 'videoinput' && d.label === label && d.deviceId)?.deviceId ??
      null
    );
  } catch {
    return null;
  }
}

function saveCalibration(c: SavedCalibration): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(c));
  } catch {
    // storage blocked or full: nothing saved
  }
}

function forgetCalibration(): void {
  try {
    localStorage.removeItem(SAVED_KEY);
  } catch {
    // storage blocked
  }
}

function jitterMm(p: [number, number, number][]): number | null {
  if (p.length < 10) return null;
  const m = [0, 1, 2].map((k) => p.reduce((a, v) => a + v[k]!, 0) / p.length); // `!`: k < 3
  const ss = p.reduce(
    (a, v) => a + (v[0] - m[0]!) ** 2 + (v[1] - m[1]!) ** 2 + (v[2] - m[2]!) ** 2,
    0,
  );
  return Math.sqrt(ss / p.length);
}

function reportContext(video: HTMLVideoElement): ReportContext {
  const s = window.screen;
  return {
    bg,
    pose: poseKind,
    query: location.search,
    calibration: calibrationNote + firstEstimateNote,
    device: navigator.userAgent,
    screen: `${s.width}×${s.height} css px, dpr ${window.devicePixelRatio}, ${s.orientation?.type ?? '?'}`,
    ...exposureInfo(video),
  };
}

/** Image Capture fields of the camera track (not in TypeScript's DOM types); `exposureTime` is in 100 µs units. */
interface ExposureSettings {
  frameRate?: number;
  exposureMode?: string;
  exposureTime?: number;
  iso?: number;
  focusMode?: string;
}
interface ExposureCapabilities {
  exposureMode?: string[];
  exposureTime?: { min?: number; max?: number };
  iso?: { min?: number; max?: number };
}

/** What the browser says about the exposure: the current values and what could be set. */
function exposureInfo(video: HTMLVideoElement): Pick<ReportContext, 'exposure' | 'exposureMs'> {
  const track = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (!track) return { exposure: '-', exposureMs: null };
  const st = track.getSettings() as ExposureSettings;
  let caps: ExposureCapabilities = {};
  try {
    caps = (track.getCapabilities?.() ?? {}) as ExposureCapabilities;
  } catch {
    // not implemented: nothing settable
  }
  const exposureMs = typeof st.exposureTime === 'number' ? st.exposureTime / 10 : null;
  const now = [
    exposureMs === null ? 'time not reported' : `${exposureMs.toFixed(1)} ms`,
    st.exposureMode ?? null,
    st.iso === undefined ? null : `ISO ${st.iso}`,
    st.frameRate === undefined ? null : `${st.frameRate.toFixed(0)} fps`,
    st.focusMode ? `focus ${st.focusMode}` : null,
  ].filter((x) => x !== null);
  const range = (r: { min?: number; max?: number } | undefined, scale: number, digits: number) =>
    r && r.min !== undefined && r.max !== undefined
      ? `${(r.min * scale).toFixed(digits)}–${(r.max * scale).toFixed(digits)}`
      : null;
  const settable = [
    caps.exposureMode?.length ? `modes ${caps.exposureMode.join('/')}` : null,
    range(caps.exposureTime, 0.1, 1) && `time ${range(caps.exposureTime, 0.1, 1)} ms`,
    range(caps.iso, 1, 0) && `ISO ${range(caps.iso, 1, 0)}`,
  ].filter((x) => x);
  return {
    exposure: `${now.join(', ')}; settable: ${settable.length ? settable.join(', ') : 'nothing reported'}${exposureNote}`,
    exposureMs,
  };
}

function flash(button: HTMLButtonElement, label: string, restore: string): void {
  button.textContent = label;
  setTimeout(() => (button.textContent = restore), 1500);
}

function ms(v: number | null): string {
  return v === null ? '-' : v.toFixed(0);
}

function hudText(
  e: PoseEvent,
  jitter: number | null,
  renderMs: number,
  bgAgeMs: number | null,
  poseAgeMs: number | null,
): string {
  const s = e.stats;
  const f = s.frame;
  const t = s.timingsMs;
  return [
    `camera  ${s.camera.label || '?'} (${s.camera.lens})`,
    `inputs  ${s.camera.devices.join(' | ') || '-'}`,
    `fps ${s.fps.toFixed(1)}  worker ${s.workerMs.toFixed(1)} ms (${s.worker})  render ${renderMs.toFixed(1)} ms`,
    `stages  gray ${t.gray.toFixed(1)}  detect ${t.detect.toFixed(1)}  pose ${t.pose.toFixed(1)}  focal ${t.focal.toFixed(1)} ms`,
    `delay   bg ${ms(bgAgeMs)} ms, pose ${ms(poseAgeMs)} ms old at render (bg ${bg}, pose ${poseKind})`,
    `frame   ${f.path} ${f.format ?? '-'} ${f.codedWidth}×${f.codedHeight} rot ${f.rotationDeg}°  analysed ${e.intrinsics.width}×${e.intrinsics.height}`,
    `tags ${e.detections.length}  err ${e.pose ? e.pose.rmsErrPx.toFixed(2) : '-'} px  jitter ${jitter === null ? '-' : jitter.toFixed(2)} mm (hold still)`,
    `f ${s.focal.fx.toFixed(1)} px (${s.focal.source}${s.focal.stdDevPct === null ? '' : ` ±${s.focal.stdDevPct.toFixed(2)} %`})`,
    e.smoothed ? 'tracking' : 'searching…',
  ].join('\n');
}

function drawThumb(w: number, h: number, gray: Uint8Array): void {
  thumb.style.display = 'block';
  thumb.width = w;
  thumb.height = h;
  const ctx = thumb.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const v = gray[i]!; // `!`: i < w·h
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
