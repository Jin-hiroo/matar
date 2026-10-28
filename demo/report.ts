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
 * The `centre` line splits the one-frame focal length of those frames since
 * Start by the image edge the paper recedes towards: the self-calibration
 * takes the lens centre (principal point) to be the image centre, and if it
 * isn't, the focal length comes out high with the paper receding one way and
 * low the opposite way. It also gives the lens centre that makes them agree.
 * The `history` line (from the page) has the camera, focal-length and
 * exposure changes since the first frame. The `corners` line has one frame's
 * detected tag corners (the slowest-moving tracked one), to refit offline when
 * the summaries can't tell causes apart: geometry only, no image.
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
/** `centre` line: frames kept since Start (the oldest go first), frames per side in the lens-centre search, its range either way (px) */
const CENTRE_FRAMES = 3000;
const CENTRE_PER_SIDE = 60;
const CENTRE_RANGE_PX = 80;
/** the image edge a tilted view of the paper recedes towards (its horizon is on that side) */
const SIDES = ['top', 'bottom', 'left', 'right'] as const;
type Side = (typeof SIDES)[number];

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
  /** the tags' outermost corners in the image, px, and the fastest of them like `speedPxS` (catches turning about the centre) */
  extentPx: Vec2[] | null;
  extentSpeedPxS: number | null;
  /** used corners' squared errors and counts by image radius (centre, middle, edge thirds of the half-diagonal), px² */
  ringSs: [number, number, number];
  ringN: [number, number, number];
  /** sum of the edge corners' radial errors (+ = further out than the fit), px */
  edgeRadial: number;
  /** a tilted frame's used tags and intrinsics, for the focal fit */
  fit: { dets: TagDetection[]; k: CameraIntrinsics } | null;
  /** every tag found, the IDs the pose used and the intrinsics, for the `corners` line */
  dets: readonly TagDetection[];
  usedIds: readonly number[];
  k: CameraIntrinsics;
  /**
   * with ≥ 2 used tags: the median over them of how much bigger each looks
   * than printed against the homography fit (px, − = smaller), and how many
   * of them look smaller
   */
  expansionPx: number | null;
  smallerTags: number;
  expansionTags: number;
  /** with enough tags and tilt for a keyframe: its homography fit (px, and mm on the paper), the focal length it gives alone (px), its viewing direction (board frame) and the image edge the paper recedes towards */
  kf: {
    rmsPx: number;
    rmsMm: number;
    f: number | null;
    dir: [number, number, number];
    side: Side;
  } | null;
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
  /** `?edgeGamma=` (`detector.edgeGamma`), null for the detector's default */
  edgeGamma: number | null;
}

export class Report {
  private readonly poses: PoseSample[] = [];
  private readonly renders: RenderSample[] = [];
  private readonly cameraFrames: number[] = [];
  private readonly grabs: { at: number; ms: number }[] = [];
  private last: PoseEvent | null = null;
  /** viewing directions ≥ minSeparationDeg apart among frames that pass every keyframe rule, since Start (kept across `reset`, as the tracker's calibration is) */
  private readonly calibDirs: [number, number, number][] = [];
  /** frames that pass every keyframe rule since Start (kept across `reset`), with their homography (`BoardFit.h`), for the `centre` line */
  private readonly centreFrames: { side: Side; h: Mat3; k: CameraIntrinsics; camera: string }[] =
    [];
  /** board corners per tag ID, [x, z] mm (TL, TR, BR, BL) */
  private readonly corners: Map<number, [Vec2, Vec2, Vec2, Vec2]>;
  /** the corners of the tags' bounding box on the board, [x, z] mm */
  private readonly extent: Vec2[];

  constructor(private readonly board: Board) {
    this.corners = new Map(board.tags.map((t) => [t.id, boardTagCornersMm(t)]));
    const all = [...this.corners.values()].flat();
    const xs = all.map((p) => p[0]);
    const zs = all.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    this.extent = [
      [x0, z0],
      [x1, z0],
      [x1, z1],
      [x0, z1],
    ];
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
    const bf = used.length >= 2 ? this.boardFit(used, e.intrinsics) : null;
    const exp = bf ? tagExpansion(bf) : null;
    const kf =
      m &&
      bf &&
      tiltDeg !== null &&
      tiltDeg >= FOCAL_DEFAULTS.minTiltDeg &&
      used.length >= FOCAL_DEFAULTS.minTags
        ? keyframe(m, bf, e.intrinsics)
        : null;
    if (kf && bf && passesFit(kf)) {
      addDirection(this.calibDirs, kf.dir);
      this.centreFrames.push({
        side: kf.side,
        h: bf.h,
        k: e.intrinsics,
        camera: e.stats.camera.label,
      });
      if (this.centreFrames.length > CENTRE_FRAMES) this.centreFrames.shift();
    }
    const originPx = m ? project(m, e.intrinsics, 0, 0, 0) : null;
    const prev = this.poses.at(-1);
    const dt = prev ? e.timestampMs - prev.frameT : 0;
    const speedPxS =
      originPx && prev?.originPx && dt > 0 && dt <= 100
        ? (1000 * Math.hypot(originPx[0] - prev.originPx[0], originPx[1] - prev.originPx[1])) / dt
        : null;
    const ext = m ? this.extent.map(([x, z]) => project(m, e.intrinsics, x, 0, z)) : [];
    const extentPx = ext.length && ext.every((p) => p) ? (ext as Vec2[]) : null;
    const prevExt = prev?.extentPx;
    const extentSpeedPxS =
      extentPx && prevExt && dt > 0 && dt <= 100
        ? (1000 *
            Math.max(
              ...extentPx.map((p, i) => Math.hypot(p[0] - prevExt[i]![0], p[1] - prevExt[i]![1])), // `!`: 4 each
            )) /
          dt
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
      extentPx,
      extentSpeedPxS,
      ringSs,
      ringN,
      edgeRadial,
      fit:
        tiltDeg !== null && tiltDeg >= FIT_MIN_TILT_DEG && used.length >= FIT_MIN_TAGS
          ? { dets: used, k: e.intrinsics }
          : null,
      dets: e.detections,
      usedIds: e.pose ? e.pose.usedTagIds : [],
      k: e.intrinsics,
      expansionPx: exp ? median(exp) : null,
      smallerTags: exp ? exp.filter((v) => v < 0).length : 0,
      expansionTags: exp ? exp.length : 0,
      kf,
    });
  }

  /**
   * One homography (board (x, z) mm → px centred on (cx, cy), row-major) fitted
   * to the used tags' corners, as the self-calibration fits it, with each
   * corner's residual; null if it fails.
   */
  private boardFit(used: TagDetection[], k: CameraIntrinsics): BoardFit | null {
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
    const res = new Float64Array(2 * n);
    let e2 = 0;
    for (let i = 0; i < n; i++) {
      const x = src[2 * i]!; // `!`: i < n
      const z = src[2 * i + 1]!;
      const w = h[6]! * x + h[7]! * z + h[8]!; // `!`: Mat3 has 9 entries
      res[2 * i] = dst[2 * i]! - (h[0]! * x + h[1]! * z + h[2]!) / w;
      res[2 * i + 1] = dst[2 * i + 1]! - (h[3]! * x + h[4]! * z + h[5]!) / w;
      e2 += res[2 * i]! ** 2 + res[2 * i + 1]! ** 2;
    }
    return { h, src, dst, n, res, rmsPx: Math.sqrt(e2 / n) };
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

  /**
   * The `centre` line: the one-frame f of the frames kept since Start, by the
   * image edge the paper recedes towards (with the lens centre in use), and
   * the lens centre that brings opposite edges' f together (a grid search
   * around the lens centre in use over the axes that have both edges; each
   * side's f is the median of up to CENTRE_PER_SIDE frames), given from the
   * image centre. Only frames from the latest frame's camera and image
   * geometry count.
   */
  private centreLine(): string {
    const last = this.centreFrames.at(-1);
    if (!last) {
      return `- (hold still at ≥ ${FOCAL_DEFAULTS.minTiltDeg}° tilt with ≥ ${FOCAL_DEFAULTS.minTags} tags in view)`;
    }
    const k = last.k;
    const frames = this.centreFrames.filter(
      (c) =>
        c.camera === last.camera &&
        c.k.width === k.width &&
        c.k.height === k.height &&
        c.k.cx === k.cx &&
        c.k.cy === k.cy,
    );
    const all = new Map(SIDES.map((s) => [s, frames.filter((c) => c.side === s)]));
    const sampled = new Map(
      SIDES.map((s) => {
        const cs = all.get(s)!; // `!`: every side is in the map
        const step = Math.max(1, cs.length / CENTRE_PER_SIDE);
        const out: typeof cs = [];
        for (let i = 0; i < cs.length; i += step) out.push(cs[Math.floor(i)]!); // `!`: i < length
        return [s, out];
      }),
    );
    // a side's median one-frame f with the lens centre at `o` (px from (cx, cy)), or null
    const sideF = (s: Side, o: Vec2, cs = sampled.get(s)!) => {
      const fs = nums(cs.map((c) => oneFrameF(c.h, k, o)));
      return fs.length ? median(fs) : null;
    };
    const has = (s: Side) => all.get(s)!.length > 0; // `!`: every side is in the map
    const fitX = has('left') && has('right');
    const fitY = has('top') && has('bottom');
    const head = `one-frame f by the image edge the paper recedes towards, since Start: ${SIDES.map(
      (s) => {
        const f = sideF(s, [0, 0], all.get(s));
        return `${s} ${f === null ? '-' : f.toFixed(0)} (${all.get(s)!.length})`; // `!`: as above
      },
    ).join(', ')}`;
    if (!fitX && !fitY) {
      return `${head}; lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)`;
    }
    const sides = SIDES.filter((s) => (s === 'left' || s === 'right' ? fitX : fitY));
    // the sides' f: mean, and RMS deviation % of it (Infinity if a side gives none)
    const spread = (o: Vec2) => {
      const fs = sides.map((s) => sideF(s, o));
      if (fs.some((f) => f === null)) return { f: 0, pct: Infinity };
      const f = (fs as number[]).reduce((a, b) => a + b, 0) / fs.length;
      const pct =
        (100 * Math.sqrt((fs as number[]).reduce((a, b) => a + (b - f) ** 2, 0) / fs.length)) / f;
      return { f, pct };
    };
    let best: Vec2 = [0, 0];
    let bestS = spread(best);
    const search = (c: Vec2, r: number, step: number) => {
      for (let dx = fitX ? -r : 0; dx <= (fitX ? r : 0); dx += step) {
        for (let dy = fitY ? -r : 0; dy <= (fitY ? r : 0); dy += step) {
          const o: Vec2 = [c[0] + dx, c[1] + dy];
          if (Math.max(Math.abs(o[0]), Math.abs(o[1])) > CENTRE_RANGE_PX) continue;
          const s = spread(o);
          if (s.pct < bestS.pct) [best, bestS] = [o, s];
        }
      }
    };
    search([0, 0], CENTRE_RANGE_PX, 4);
    search(best, 3, 1);
    if (!Number.isFinite(bestS.pct)) {
      return `${head}; lens centre not fitted (no one-frame f on a side at any lens centre tried)`;
    }
    // the lens centre in use, px from the image centre (not 0 with the demo's ?centre=)
    const base: Vec2 = [k.cx - (k.width - 1) / 2, k.cy - (k.height - 1) / 2];
    const shifted = base[0] !== 0 || base[1] !== 0;
    const pctAt = (o: Vec2) => {
      const pct = spread(o).pct;
      return Number.isFinite(pct) ? pct.toFixed(1) : '-';
    };
    const int = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}`;
    const edge = Math.max(Math.abs(best[0]), Math.abs(best[1])) >= CENTRE_RANGE_PX;
    return `${head}; lens centre ${fitX ? `x ${int(best[0] + base[0])}` : 'x not fitted (needs left and right)'}, ${
      fitY ? `y ${int(best[1] + base[1])}` : 'y not fitted (needs top and bottom)'
    } px from the image centre (+ = right, down): f ${bestS.f.toFixed(0)} px, the sides' f ±${bestS.pct.toFixed(1)} % (±${pctAt(
      [-base[0], -base[1]],
    )} % with the image centre${
      shifted
        ? `, ±${pctAt([0, 0])} % with the lens centre in use, x ${int(base[0])}, y ${int(base[1])}`
        : ''
    })${edge ? `, at the edge of the ±${CENTRE_RANGE_PX} px search around the lens centre in use` : ''}`;
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
      `edges    ${edgesLine(tracked, ctx.edgeGamma)}`,
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
        `centre   ${this.centreLine()}`,
      );
    }
    if (ctx.history) lines.push(`history  ${ctx.history}`);
    const still = cornersLine(tracked, now);
    if (still) lines.push(`corners  ${still}`);
    lines.push(
      '(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)',
    );
    return lines.join('\n');
  }
}

/** A frame's board homography fit (`Report.boardFit`): points as 4 corners per tag, in tag order. */
interface BoardFit {
  h: Mat3;
  /** board (x, z) mm, interleaved */
  src: number[];
  /** detected corners, px from (cx, cy), interleaved */
  dst: number[];
  n: number;
  /** detected − fitted, px, interleaved */
  res: Float64Array;
  rmsPx: number;
}

/** A frame's homography fit, as the self-calibration measures it, and its viewing direction. */
function keyframe(m: Mat4, bf: BoardFit, k: CameraIntrinsics): PoseSample['kf'] {
  // `!` below: 16 entries
  const dir: [number, number, number] = [-m[8]!, -m[9]!, -m[10]!]; // unit (rotation column)
  // the board's normal in camera coordinates (x right, y down) is (m[1], −m[5], −m[9]):
  // the horizon, so the far paper, lies from the image centre along (m[1], −m[5])
  const [nu, nv] = [m[1]!, -m[5]!];
  const side: Side =
    Math.abs(nu) > Math.abs(nv) ? (nu > 0 ? 'right' : 'left') : nv > 0 ? 'bottom' : 'top';
  return {
    rmsPx: bf.rmsPx,
    rmsMm: bf.rmsPx / pxPerMm(bf.src, bf.dst, bf.n),
    f: oneFrameF(bf.h, k),
    dir,
    side,
  };
}

/**
 * How much bigger each tag looks than printed, px (− = smaller): its corners'
 * residuals less their mean, along the fitted tag centre → corner direction.
 * Blur with a tone curve unlike `edgeGamma` moves every tag edge alike, which
 * a homography can't absorb (scripts/refit-corners.ts).
 */
function tagExpansion(bf: BoardFit): number[] {
  const out: number[] = [];
  // `!` below: 4 points per tag, i + c < n
  for (let i = 0; i + 4 <= bf.n; i += 4) {
    let mu = 0;
    let mv = 0;
    let gu = 0;
    let gv = 0;
    for (let c = 0; c < 4; c++) {
      mu += bf.res[2 * (i + c)]! / 4;
      mv += bf.res[2 * (i + c) + 1]! / 4;
      gu += (bf.dst[2 * (i + c)]! - bf.res[2 * (i + c)]!) / 4;
      gv += (bf.dst[2 * (i + c) + 1]! - bf.res[2 * (i + c) + 1]!) / 4;
    }
    let e = 0;
    for (let c = 0; c < 4; c++) {
      const du = bf.dst[2 * (i + c)]! - bf.res[2 * (i + c)]! - gu;
      const dv = bf.dst[2 * (i + c) + 1]! - bf.res[2 * (i + c) + 1]! - gv;
      e +=
        ((bf.res[2 * (i + c)]! - mu) * du + (bf.res[2 * (i + c) + 1]! - mv) * dv) /
        Math.hypot(du, dv) /
        4;
    }
    out.push(e);
  }
  return out;
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

/**
 * The `corners` line: the slowest-moving tracked frame with ≥ FIT_MIN_TAGS
 * used tags, by its fastest outer corner (the last one if no speed is
 * known), every tag found on it as
 * `id: TL TR BR BL` (image px, 0.1 px; `*` = not used by the pose), with its
 * intrinsics, tilt and speed. '' without such a frame.
 */
function cornersLine(tracked: PoseSample[], now: number): string {
  const frames = tracked.filter((p) => p.used >= FIT_MIN_TAGS);
  if (!frames.length) return '';
  const p = frames.reduce((a, b) =>
    b.extentSpeedPxS !== null && (a.extentSpeedPxS === null || b.extentSpeedPxS < a.extentSpeedPxS)
      ? b
      : a,
  );
  const tags = [...p.dets]
    .sort((a, b) => a.id - b.id)
    .map(
      (d) =>
        `${d.id}${p.usedIds.includes(d.id) ? '' : '*'}: ${d.corners.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join(' ')}`,
    );
  return `${((p.at - now) / 1000).toFixed(1)} s, outer corners ${p.extentSpeedPxS === null ? '-' : p.extentSpeedPxS.toFixed(0)} px/s, tilt ${p.tiltDeg === null ? '-' : p.tiltDeg.toFixed(0)}°, ${p.k.width}×${p.k.height} fx ${p.k.fx.toFixed(1)} fy ${p.k.fy.toFixed(1)} cx ${p.k.cx.toFixed(1)} cy ${p.k.cy.toFixed(1)}; id: TL TR BR BL px (* not used) · ${tags.join(' · ')}`;
}

/**
 * The `edges` line: each frame's median tag expansion (`tagExpansion`) over
 * the window, and the share of tags that look smaller than printed.
 */
function edgesLine(tracked: PoseSample[], edgeGammaOpt: number | null): string {
  // importing the detector's default here would pull the detector into the page's chunk
  const edgeGamma = edgeGammaOpt ?? 'default';
  const v = nums(tracked.map((p) => p.expansionPx)).sort((a, b) => a - b);
  if (!v.length) return `- (≥ 2 tags needed); edgeGamma ${edgeGamma}`;
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * v.length))]!; // `!`: in range
  const tags = tracked.reduce((s, p) => s + p.expansionTags, 0);
  const smaller = tracked.reduce((s, p) => s + p.smallerTags, 0);
  return `tags ${signed(q(0.5))} px bigger than printed vs the fit (10–90 %: ${signed(q(0.1))} to ${signed(q(0.9))} over ${v.length} frames; − = smaller, edges placed towards the black), ${((100 * smaller) / tags).toFixed(0)} % of tags smaller; edgeGamma ${edgeGamma} (?edgeGamma=)`;
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

const scratchH: Mat3 = new Float64Array(9);
const scratchC = new Float64Array(4);

/**
 * The focal length one frame's homography gives alone, as the self-calibration
 * computes it per keyframe (`focalConstraints`), px, or null. `h` (row-major)
 * maps board (x, z) mm to pixels centred on (cx, cy); `[ox, oy]` moves the lens
 * centre that far from (cx, cy), px.
 */
function oneFrameF(h: Mat3, k: CameraIntrinsics, [ox, oy]: Vec2 = [0, 0]): number | null {
  const L = Math.max(k.width, k.height);
  const hL = scratchH;
  const c = scratchC;
  // `!` below: 9 entries. To pixels centred on the lens centre, / L
  for (let j = 0; j < 3; j++) {
    hL[j] = (h[j]! - ox * h[6 + j]!) / L;
    hL[3 + j] = (h[3 + j]! - oy * h[6 + j]!) / L;
    hL[6 + j] = h[6 + j]!;
  }
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
