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
 * of each frame's own pose). After Start, **Mode** switches between `frame`
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
import { MatarThree, mmToM } from '../src/three/index.js';
import { createTracker } from '../src/tracker/index.js';
import type { PoseEvent, TrackerErrorEvent } from '../src/types.js';
import { DEMO_ORIGIN_MM, DEMO_PAGE_MM, demoBoard } from './board.js';
import { Report } from './report.js';

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const inline = params.has('inline');
let bg = params.get('bg') ?? 'frame';
const poseKind = params.get('pose') === 'smoothed' ? 'smoothed' : 'raw';

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
  const tracker = createTracker({ board, worker: inline ? false : undefined, debug });

  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.getElementById('view')!.appendChild(renderer.domElement); // `!`: in index.html
  const scene = new Scene();
  const camera = new PerspectiveCamera(50, 1, 0.01, 10);
  const makeAr = () =>
    new MatarThree({
      tracker,
      renderer,
      camera,
      scene,
      background: bg === 'live' ? 'live' : 'synced',
      textureSource: bg === 'video' ? 'video' : 'frame',
      pose: poseKind,
    });
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
  const report = new Report();
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
    const text = report.text(reportContext(), performance.now());
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
    // shown by the error listener
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

function reportContext() {
  const s = window.screen;
  return {
    bg,
    pose: poseKind,
    device: navigator.userAgent,
    screen: `${s.width}×${s.height} css px, dpr ${window.devicePixelRatio}, ${s.orientation?.type ?? '?'}`,
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
