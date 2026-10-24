/**
 * The demo's timing report (DEVICE-TESTS.md): the last 5 s of per-frame
 * numbers, summarised as median / 90th percentile, as plain text to paste
 * into a device-test note or an issue.
 *
 * Times are `performance.now()` ms, the clock of `PoseEvent.timestampMs`
 * (the analysed frame's `expectedDisplayTime`).
 *
 * Accuracy clues for device tests: how fast the board moves in the image
 * (with the exposure time: how long the motion blur is), the reprojection
 * error of the used tags' corners by distance from the image centre (lens
 * distortion grows towards the edges and isn't modelled, SPEC.md §6), and the
 * focal length that fits tilted frames best. A wrong focal length doesn't show
 * looking straight down (only the height comes out wrong); tilted, it leaves a
 * reprojection error of a few px all over the image and puts content off.
 * The `calib` line counts the frames that pass the self-calibration's keyframe
 * rules (src/pose/focal.ts), to show which one holds it back, and splits their
 * homography fit and one-frame focal length by how fast the board moves: a
 * camera that reads its rows out one after another skews a moving board
 * (rolling shutter), which a homography absorbs and the focal length doesn't.
 * The `history` line (from the page) has the camera, focal-length and
 * exposure changes since the first frame.
 */
import { boardTagCornersMm } from '../src/board/index.js';
import { homographyDlt } from '../src/math/homography.js';
import { FOCAL_DEFAULTS, focalConstraints, pxPerMm } from '../src/pose/focal.js';
import { estimatePose } from '../src/pose/index.js';
import type {
  Board,
  CameraIntrinsics,
  Mat3,
  Mat4,
  PoseEvent,
  TagDetection,
  Vec2,
} from '../src/types.js';

const WINDOW_MS = 5000;
/** focal fit: frames with at least this many used tags, this tilt (°), at most this many frames */
const FIT_MIN_TAGS = 6;
const FIT_MIN_TILT_DEG = 15;
const FIT_FRAMES = 12;
/** `calib` split: board speeds in the image, px/s (slow below the first, fast from the second) */
const SLOW_PX_S = 100;
const FAST_PX_S = 300;

interface PoseSample {
  at: number;
  /** the frame's timestamp (ms) */
  frameT: number;
  tracked: boolean;
  total: number;
  gray: number;
  detect: number;
  pose: number;
  focal: number;
  tags: number;
  /** tags the pose used */
  used: number;
  errPx: number | null;
  /** the used corners' RMS error on the paper (mm): each detected corner's ray met with the board plane, against where the corner is printed */
  errMm: number | null;
  /** camera height above the paper (mm) and tilt from looking straight down (°), with a pose */
  heightMm: number | null;
  tiltDeg: number | null;
  /** board origin in the image, px */
  originPx: Vec2 | null;
  /** its speed since the previous tracked frame, if that is ≤ 100 ms older, px/s */
  speedPxS: number | null;
  /** used corners' squared errors and counts by image radius (centre, middle, edge thirds of the half-diagonal), px² */
  ringSs: [number, number, number];
  ringN: [number, number, number];
  /** sum of the edge corners' radial errors (+ = further out than the fit), px */
  edgeRadial: number;
  /** a tilted frame's used tags and intrinsics, for the focal fit */
  fit: { dets: TagDetection[]; k: CameraIntrinsics } | null;
  /** with enough tags and tilt for a keyframe: its homography fit (px, and mm on the paper), the focal length it gives alone (px) and its viewing direction (board frame) */
  kf: { rmsPx: number; rmsMm: number; f: number | null; dir: [number, number, number] } | null;
}

interface RenderSample {
  at: number;
  renderMs: number;
  /** age of the frame behind the content (ms) */
  bgAgeMs: number | null;
  /** age of the frame the shown pose was computed from (ms) */
  poseAgeMs: number | null;
}

/** What the report header says about the run. */
export interface ReportContext {
  bg: string;
  pose: string;
  /** the page's URL options (`location.search`), '' if none */
  query: string;
  /** where the demo's focal length came from (a saved calibration or none) */
  calibration: string;
  device: string;
  screen: string;
  /** the camera's exposure as the browser reports it */
  exposure: string;
  /** exposure time, ms, if reported */
  exposureMs: number | null;
  /** camera, focal-length and exposure changes since the first frame, '' if none */
  history: string;
}

export class Report {
  private readonly poses: PoseSample[] = [];
  private readonly renders: RenderSample[] = [];
  private readonly cameraFrames: number[] = [];
  private readonly grabs: { at: number; ms: number }[] = [];
  private last: PoseEvent | null = null;
  /** viewing directions ≥ minSeparationDeg apart among frames that pass every keyframe rule, since Start (kept across `reset`, as the tracker's calibration is) */
  private readonly calibDirs: [number, number, number][] = [];
  /** board corners per tag ID, [x, z] mm (TL, TR, BR, BL) */
  private readonly corners: Map<number, [Vec2, Vec2, Vec2, Vec2]>;

  constructor(private readonly board: Board) {
    this.corners = new Map(board.tags.map((t) => [t.id, boardTagCornersMm(t)]));
  }

  addPose(e: PoseEvent, at: number): void {
    const t = e.stats.timingsMs;
    // boardFromCamera, column-major, board Y up; the camera looks along its −Z (column 2)
    const m = e.pose?.boardFromCamera;
    this.last = e;
    const ringSs: [number, number, number] = [0, 0, 0];
    const ringN: [number, number, number] = [0, 0, 0];
    let edgeRadial = 0;
    let mm2 = 0;
    let mmN = 0;
    if (m && e.pose) {
      const k = e.intrinsics;
      const half = Math.hypot(k.width, k.height) / 2;
      for (const d of e.detections) {
        const bc = this.corners.get(d.id);
        if (!bc || !e.pose.usedTagIds.includes(d.id)) continue;
        for (let c = 0; c < 4; c++) {
          const fit = project(m, k, bc[c]![0], 0, bc[c]![1]); // `!`: c < 4
          if (!fit) continue;
          const [u, v] = d.corners[c]!;
          const ru = fit[0] - k.cx;
          const rv = fit[1] - k.cy;
          const r = Math.hypot(ru, rv);
          const ring = Math.min(2, Math.floor((3 * r) / half));
          ringSs[ring]! += (u - fit[0]) ** 2 + (v - fit[1]) ** 2; // `!`: ring ≤ 2
          ringN[ring]!++;
          if (ring === 2) edgeRadial += ((u - fit[0]) * ru + (v - fit[1]) * rv) / r;
          const onPaper = toPaper(m, k, u, v);
          if (onPaper) {
            mm2 += (onPaper[0] - bc[c]![0]) ** 2 + (onPaper[1] - bc[c]![1]) ** 2;
            mmN++;
          }
        }
      }
    }
    const tiltDeg = m ? (Math.acos(Math.min(1, Math.max(-1, m[9]!))) * 180) / Math.PI : null; // `!`: 16 entries
    const used = e.pose ? e.detections.filter((d) => e.pose!.usedTagIds.includes(d.id)) : []; // `!`: checked
    const kf =
      m &&
      tiltDeg !== null &&
      tiltDeg >= FOCAL_DEFAULTS.minTiltDeg &&
      used.length >= FOCAL_DEFAULTS.minTags
        ? this.keyframe(m, used, e.intrinsics)
        : null;
    if (kf && passesFit(kf)) addDirection(this.calibDirs, kf.dir);
    const originPx = m ? project(m, e.intrinsics, 0, 0, 0) : null;
    const prev = this.poses.at(-1);
    const dt = prev ? e.timestampMs - prev.frameT : 0;
    const speedPxS =
      originPx && prev?.originPx && dt > 0 && dt <= 100
        ? (1000 * Math.hypot(originPx[0] - prev.originPx[0], originPx[1] - prev.originPx[1])) / dt
        : null;
    push(this.poses, at, {
      at,
      frameT: e.timestampMs,
      tracked: e.pose !== null,
      total: t.total,
      gray: t.gray,
      detect: t.detect,
      pose: t.pose,
      focal: t.focal,
      tags: e.detections.length,
      used: e.pose ? e.pose.usedTagIds.length : 0,
      errPx: e.pose ? e.pose.rmsErrPx : null,
      errMm: mmN ? Math.sqrt(mm2 / mmN) : null,
      heightMm: m ? m[13]! : null, // `!`: a Mat4 has 16 entries
      tiltDeg,
      originPx,
      speedPxS,
      ringSs,
      ringN,
      edgeRadial,
      fit:
        tiltDeg !== null && tiltDeg >= FIT_MIN_TILT_DEG && used.length >= FIT_MIN_TAGS
          ? { dets: used, k: e.intrinsics }
          : null,
      kf,
    });
  }

  /** A frame's homography fit, as the self-calibration measures it, and its viewing direction. */
  private keyframe(m: Mat4, used: TagDetection[], k: CameraIntrinsics): PoseSample['kf'] {
    const src: number[] = [];
    const dst: number[] = [];
    for (const d of used) {
      const bc = this.corners.get(d.id);
      if (!bc) continue;
      for (let c = 0; c < 4; c++) {
        src.push(bc[c]![0], bc[c]![1]); // `!`: c < 4
        dst.push(d.corners[c]![0] - k.cx, d.corners[c]![1] - k.cy);
      }
    }
    const n = src.length / 2;
    const h = homographyDlt(src, dst, n);
    if (!h) return null;
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const x = src[2 * i]!; // `!`: i < n
      const z = src[2 * i + 1]!;
      const w = h[6]! * x + h[7]! * z + h[8]!; // `!`: Mat3 has 9 entries
      e2 += ((h[0]! * x + h[1]! * z + h[2]!) / w - dst[2 * i]!) ** 2;
      e2 += ((h[3]! * x + h[4]! * z + h[5]!) / w - dst[2 * i + 1]!) ** 2;
    }
    const dir: [number, number, number] = [-m[8]!, -m[9]!, -m[10]!]; // `!`: 16 entries; unit (rotation column)
    const rmsPx = Math.sqrt(e2 / n);
    return { rmsPx, rmsMm: rmsPx / pxPerMm(src, dst, n), f: oneFrameF(h, k), dir };
  }

  /** The `calib` line: frames that pass each keyframe rule of the self-calibration, in this window. */
  private calibLine(tracked: PoseSample[]): string {
    const o = FOCAL_DEFAULTS;
    const cand = tracked.filter((p) => p.kf);
    const good = cand.filter((p) => passesFit(p.kf!)); // `!`: filtered
    const dirs: [number, number, number][] = [];
    for (const p of good) addDirection(dirs, p.kf!.dir); // `!`: filtered
    // median fit and one-frame f of the frames in a band of board speed
    const band = (label: string, inBand: (v: number) => boolean) => {
      const ps = cand.filter((p) => p.speedPxS !== null && inBand(p.speedPxS));
      if (!ps.length) return `${label} -`;
      const fs = nums(ps.map((p) => p.kf!.f)); // `!`: filtered
      return `${label} ${median(ps.map((p) => p.kf!.rmsPx)).toFixed(1)} px, f ${fs.length ? median(fs).toFixed(0) : '-'} (${ps.length})`;
    };
    return `${cand.length} frames with ≥ ${o.minTags} tags at ≥ ${o.minTiltDeg}° tilt (homography fit ${mp(
      cand.map((p) => p.kf!.rmsPx), // `!`: filtered
    )} px, ${mp(cand.map((p) => p.kf!.rmsMm))} mm on the paper), ${good.length} of them under ${o.maxFitRmsPx} px or ${o.maxFitRmsMm} mm, from ${dirs.length} directions ≥ ${o.minSeparationDeg}° apart (${this.calibDirs.length} since Start; it needs ${o.minKeyframes}); fit and one-frame f by board speed: ${[
      band(`< ${SLOW_PX_S} px/s`, (v) => v < SLOW_PX_S),
      band(`${SLOW_PX_S}–${FAST_PX_S}`, (v) => v >= SLOW_PX_S && v < FAST_PX_S),
      band(`≥ ${FAST_PX_S}`, (v) => v >= FAST_PX_S),
    ].join(', ')}`;
  }

  addRender(sample: RenderSample): void {
    push(this.renders, sample.at, sample);
  }

  addCameraFrame(at: number): void {
    push(this.cameraFrames, at, at);
  }

  /** Time spent in the tracker's `grab` event (ms), which delays the frame's transfer. */
  addGrab(ms: number, at: number): void {
    push(this.grabs, at, { at, ms });
  }

  /** Clears the window (after a mode switch, so the numbers are of one mode). */
  reset(): void {
    this.poses.length = this.renders.length = this.cameraFrames.length = this.grabs.length = 0;
  }

  /** The `fit` line: the best focal length on tilted frames, vs the one in use. */
  private focalFit(tracked: PoseSample[]): string {
    const frames = tracked.filter((p) => p.fit);
    if (!frames.length) {
      return `- (hold still at ≥ ${FIT_MIN_TILT_DEG}° tilt with ≥ ${FIT_MIN_TAGS} tags in view)`;
    }
    const step = Math.max(1, Math.floor(frames.length / FIT_FRAMES));
    const fits = [];
    for (let i = 0; i < frames.length && fits.length < FIT_FRAMES; i += step) {
      const f = frames[i]!.fit!; // `!`: i < length, filtered on fit
      fits.push(fitFocal(this.board, f.dets, f.k));
    }
    const fx = fits.map((f) => f.fx);
    const best = median(fx);
    const fovDeg = (2 * Math.atan(fits[0]!.longPx / 2 / best) * 180) / Math.PI; // `!`: ≥ 1 fit
    return `${best.toFixed(0)} px best (${Math.min(...fx).toFixed(0)}–${Math.max(...fx).toFixed(0)} over ${fits.length} tilted frames; long-side FOV ${fovDeg.toFixed(1)}°, ?fov=${fovDeg.toFixed(1)}), err ${median(fits.map((f) => f.errPx)).toFixed(2)} px with it, ${median(fits.map((f) => f.inUsePx)).toFixed(2)} px with the f in use`;
  }

  text(ctx: ReportContext, now: number): string {
    const e = this.last;
    const poses = this.poses.filter((p) => now - p.at <= WINDOW_MS);
    const renders = this.renders.filter((r) => now - r.at <= WINDOW_MS);
    const cams = this.cameraFrames.filter((t) => now - t <= WINDOW_MS);
    const span = (n: number, first: number | undefined) =>
      first === undefined || n < 2 ? 0 : ((n - 1) * 1000) / (now - first);
    const tracked = poses.filter((p) => p.tracked);
    const lost = poses.filter((p) => !p.tracked);
    const intervals = poses.slice(1).map((p, i) => p.frameT - poses[i]!.frameT); // `!`: i < length − 1
    const speeds = nums(tracked.map((p) => p.speedPxS));
    const blur =
      ctx.exposureMs === null || !speeds.length
        ? ''
        : ` (≈ ${mp(
            speeds.map((v) => (v * ctx.exposureMs!) / 1000), // `!`: checked above
            0,
          )} px of blur at ${ctx.exposureMs.toFixed(1)} ms)`;
    const ss = [0, 0, 0];
    const n = [0, 0, 0];
    let edgeRadial = 0;
    for (const p of tracked) {
      for (let r = 0; r < 3; r++) {
        ss[r]! += p.ringSs[r]!; // `!`: r < 3
        n[r]! += p.ringN[r]!;
      }
      edgeRadial += p.edgeRadial;
    }
    const ringRms = (r: number) => (n[r] ? Math.sqrt(ss[r]! / n[r]!).toFixed(2) : '-'); // `!`: r < 3
    let runs = 0;
    let run = 0;
    let longest = 0;
    for (const p of poses) {
      run = p.tracked ? 0 : run + 1;
      if (run === 1) runs++;
      longest = Math.max(longest, run);
    }
    const lines = [
      `matar demo report (last ${(WINDOW_MS / 1000).toFixed(0)} s)`,
      `mode     bg ${ctx.bg}, pose ${ctx.pose}, worker ${e ? e.stats.worker : '-'}, url ${ctx.query || '-'}`,
      `device   ${ctx.device}`,
      `screen   ${ctx.screen}`,
    ];
    if (e) {
      const f = e.stats.frame;
      lines.push(
        `camera   ${e.stats.camera.label || '?'} (${e.stats.camera.lens}), ${f.path} ${f.format ?? '-'} ${f.codedWidth}×${f.codedHeight} rot ${f.rotationDeg}°, analysed ${e.intrinsics.width}×${e.intrinsics.height}`,
        `inputs   ${e.stats.camera.devices.join(' | ') || '-'}`,
      );
    }
    lines.push(
      `fps      camera ${span(cams.length, cams[0]).toFixed(1)}, analysed ${span(poses.length, poses[0]?.at).toFixed(1)}, with a pose ${tracked.length}/${poses.length}`,
      `interval ${mp(intervals, 0)} ms between analysed frames`,
      `no pose  ${lost.length} frames in ${runs} runs (longest ${longest}), tags found on them ${mp(
        lost.map((p) => p.tags),
        0,
      )}`,
      `grab     ${mp(this.grabs.filter((g) => now - g.at <= WINDOW_MS).map((g) => g.ms))} ms on the main thread before the transfer (bg frame: the texture upload)`,
      `worker   ${mp(poses.map((p) => p.total))} ms`,
      `stages   gray ${mp(poses.map((p) => p.gray))}  detect ${mp(poses.map((p) => p.detect))}  pose ${mp(poses.map((p) => p.pose))}  focal ${mp(poses.map((p) => p.focal))} ms`,
      `bg age   ${mp(nums(renders.map((r) => r.bgAgeMs)), 0)} ms at render`,
      `pose age ${mp(nums(renders.map((r) => r.poseAgeMs)), 0)} ms at render`,
      `pose lag ${mp(nums(renders.map((r) => (r.bgAgeMs === null || r.poseAgeMs === null ? null : r.poseAgeMs - r.bgAgeMs))), 0)} ms behind the background (0 with bg frame)`,
      `render   ${mp(renders.map((r) => r.renderMs))} ms`,
      `tags     ${mp(
        tracked.map((p) => p.tags),
        0,
      )} found, ${mp(
        tracked.map((p) => p.used),
        0,
      )} used, err ${mp(nums(tracked.map((p) => p.errPx)), 2)} px (${mp(nums(tracked.map((p) => p.errMm)), 2)} mm on the paper)`,
      `err by r centre ${ringRms(0)} px (${n[0]} corners), middle ${ringRms(1)} (${n[1]}), edge ${ringRms(2)} (${n[2]})${
        n[2]
          ? `; edge corners ${signed(edgeRadial / n[2])} px radially (+ = further out than the fit)`
          : ''
      }`,
      `view     ${mp(nums(tracked.map((p) => p.heightMm)), 0)} mm above the paper, tilt ${mp(
        nums(tracked.map((p) => p.tiltDeg)),
        0,
      )}° from straight down`,
      `motion   board centre ${mp(speeds, 0)} px/s in the image${blur}`,
      `exposure ${ctx.exposure}`,
    );
    if (e) {
      const fc = e.stats.focal;
      lines.push(
        `focal    ${fc.fx.toFixed(1)} px (${fc.source}${fc.stdDevPct === null ? '' : ` ±${fc.stdDevPct.toFixed(2)} %`}); ${ctx.calibration}`,
        `fit      ${this.focalFit(tracked)}`,
        `calib    ${this.calibLine(tracked)}`,
      );
    }
    if (ctx.history) lines.push(`history  ${ctx.history}`);
    lines.push(
      '(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)',
    );
    return lines.join('\n');
  }
}

/**
 * The focal length that fits a frame's used tags best: a golden-section
 * search over f (fx and fy scaled alike, log scale, long-side FOV 30–120°
 * whatever the f in use), the pose refitted with `estimatePose` at each. Up to FIT_FRAMES tilted
 * frames, spread over the window; hold still, as blur and rolling shutter
 * bend the fit.
 */
function fitFocal(board: Board, dets: TagDetection[], k: CameraIntrinsics) {
  const err = (s: number) =>
    estimatePose(dets, board, { ...k, fx: k.fx * s, fy: k.fy * s }, undefined, { inlierPx: 100 })
      ?.rmsErrPx ?? Infinity;
  const g = (Math.sqrt(5) - 1) / 2;
  const longPx = Math.max(k.width, k.height);
  const sAtFov = (deg: number) => longPx / 2 / Math.tan((deg * Math.PI) / 360) / k.fx;
  let a = Math.log(sAtFov(120));
  let b = Math.log(sAtFov(30));
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = err(Math.exp(c));
  let fd = err(Math.exp(d));
  for (let i = 0; i < 20; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = err(Math.exp(c));
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = err(Math.exp(d));
    }
  }
  const s = Math.exp((a + b) / 2);
  return { fx: k.fx * s, errPx: err(s), inUsePx: err(1), longPx };
}

/** Appends and drops samples older than twice the window. */
function push<T>(list: T[], at: number, item: T): void {
  list.push(item);
  while (list.length > 0 && at - atOf(list[0]!) > 2 * WINDOW_MS) list.shift(); // `!`: length > 0
}

function atOf(item: unknown): number {
  return typeof item === 'number' ? item : (item as { at: number }).at;
}

/**
 * Board point (x, y, z) mm → image px through `boardFromCamera` (GL, mm,
 * column-major: the camera axes are columns 0–2, it looks along −Z) and the
 * intrinsics (CV pinhole); null behind the camera.
 */
function project(m: Mat4, k: CameraIntrinsics, x: number, y: number, z: number): Vec2 | null {
  // `!` below: a Mat4 has 16 entries
  const dx = x - m[12]!;
  const dy = y - m[13]!;
  const dz = z - m[14]!;
  const cx = m[0]! * dx + m[1]! * dy + m[2]! * dz;
  const cy = m[4]! * dx + m[5]! * dy + m[6]! * dz;
  const cz = m[8]! * dx + m[9]! * dy + m[10]! * dz;
  if (!(cz < 0)) return null;
  return [k.cx - (k.fx * cx) / cz, k.cy + (k.fy * cy) / cz];
}

/**
 * The focal length one frame's homography gives alone, as the self-calibration
 * computes it per keyframe (`focalConstraints`), px, or null. `h` (row-major)
 * maps board (x, z) mm to pixels centred on (cx, cy).
 */
function oneFrameF(h: Mat3, k: CameraIntrinsics): number | null {
  const L = Math.max(k.width, k.height);
  const hL = Float64Array.from(h, (v, i) => (i < 6 ? v / L : v)); // to centred pixels / L
  const c = new Float64Array(4);
  if (!focalConstraints(hL, 1, c)) return null;
  // `!` below: 4 entries
  const w = -(c[0]! * c[1]! + c[2]! * c[3]!) / (c[0]! ** 2 + c[2]! ** 2);
  return w > 0 && Number.isFinite(w) ? L / Math.sqrt(w) : null;
}

/** A keyframe's homography fit passes the self-calibration's rule (px or mm). */
function passesFit(kf: NonNullable<PoseSample['kf']>): boolean {
  return kf.rmsPx < FOCAL_DEFAULTS.maxFitRmsPx || kf.rmsMm < FOCAL_DEFAULTS.maxFitRmsMm;
}

/** Adds `d` to `dirs` if it is ≥ minSeparationDeg from every one there (greedy, like the keyframe set). */
function addDirection(dirs: [number, number, number][], d: [number, number, number]): void {
  const cosSep = Math.cos((FOCAL_DEFAULTS.minSeparationDeg * Math.PI) / 180);
  if (dirs.every((q) => q[0] * d[0] + q[1] * d[1] + q[2] * d[2] <= cosSep)) dirs.push(d);
}

/** Where the ray through pixel (u, v) meets the paper (board y = 0): [x, z] mm, or null if it misses. */
function toPaper(m: Mat4, k: CameraIntrinsics, u: number, v: number): Vec2 | null {
  // `!` below: a Mat4 has 16 entries. Camera ray (x right, y up, z = −1 forward) in the board frame:
  const rx = (u - k.cx) / k.fx;
  const ry = -(v - k.cy) / k.fy;
  const dx = rx * m[0]! + ry * m[4]! - m[8]!;
  const dy = rx * m[1]! + ry * m[5]! - m[9]!;
  const dz = rx * m[2]! + ry * m[6]! - m[10]!;
  const s = -m[13]! / dy;
  if (!(s > 0 && s < Infinity)) return null;
  return [m[12]! + s * dx, m[14]! + s * dz];
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!; // `!`: callers pass ≥ 1 value
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`;
}

function nums(v: (number | null)[]): number[] {
  return v.filter((x): x is number => x !== null);
}

/** "median / p90", or "-" without samples. */
function mp(v: number[], digits = 1): string {
  if (!v.length) return '-';
  const s = [...v].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!; // `!`: in range
  return `${q(0.5).toFixed(digits)} / ${q(0.9).toFixed(digits)}`;
}
