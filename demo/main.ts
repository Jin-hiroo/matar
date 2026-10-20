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
 * of each frame's own pose).
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

const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const inline = params.has('inline');
const bg = params.get('bg') ?? 'frame';
const background = bg === 'live' ? 'live' : 'synced';
const textureSource = bg === 'video' ? 'video' : 'frame';
const poseKind = params.get('pose') === 'smoothed' ? 'smoothed' : 'raw';

const board = demoBoard();
const hud = document.getElementById('hud') as HTMLPreElement;
const thumb = document.getElementById('thumb') as HTMLCanvasElement;

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
  const ar = new MatarThree({
    tracker,
    renderer,
    camera,
    scene,
    background,
    textureSource,
    pose: poseKind,
  });

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
  tracker.addEventListener('pose', (e) => {
    last = e;
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
    renderMs += 0.1 * (performance.now() - t0 - renderMs);
    // the HUD is text layout: refresh it 5× a second, not every frame
    const now = performance.now();
    if (last && now - hudAt > 200) {
      hudAt = now;
      hud.textContent = hudText(last, jitterMm(recent), renderMs, now - last.timestampMs);
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

function hudText(e: PoseEvent, jitter: number | null, renderMs: number, ageMs: number): string {
  const s = e.stats;
  const f = s.frame;
  const t = s.timingsMs;
  return [
    `camera  ${s.camera.label || '?'} (${s.camera.lens})`,
    `inputs  ${s.camera.devices.join(' | ') || '-'}`,
    `fps ${s.fps.toFixed(1)}  worker ${s.workerMs.toFixed(1)} ms (${s.worker})  render ${renderMs.toFixed(1)} ms`,
    `stages  gray ${t.gray.toFixed(1)}  detect ${t.detect.toFixed(1)}  pose ${t.pose.toFixed(1)}  focal ${t.focal.toFixed(1)} ms`,
    `delay   ${ageMs.toFixed(0)} ms since the frame (bg ${bg}, pose ${poseKind})`,
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
