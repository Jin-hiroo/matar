/**
 * The tag detector (ARCHITECTURE.md §4): gray frame → decoded tags with
 * sub-pixel corners.
 *
 * Pipeline per frame (§4.1): optional 2 × 2 box decimation → adaptive threshold
 * → border following → Douglas–Peucker quads → edge refinement on the
 * full-resolution image → decode against the board's codes → corner order →
 * duplicate removal. Each candidate is refined and decoded as soon as its
 * border has been followed, so no candidate list is needed.
 *
 * All buffers belong to the detector and are reused; they are reallocated only
 * when the frame size changes (`allocations` counts it, for tests).
 *
 * Input: `GrayImage` (stride = width). Output: `TagDetection[]`, corners in
 * full-res pixels (centres at integer coordinates), TL, TR, BR, BL of the tag
 * as printed (§2.3).
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction.
 */
import { getFamilyDef, type FamilyDef } from '../tags/families.js';
import type { GrayImage, TagDetection, Vec2 } from '../types.js';
import { BorderFollower } from './contours.js';
import { CodeMatcher } from './decode.js';
import { QuadFitter, type QuadFitOptions } from './quad.js';
import { EdgeRefiner, linearizationLut } from './refine.js';
import { TagReader } from './sample.js';
import {
  adaptiveThreshold,
  decimate2x2,
  thresholdScratchSize,
  type ThresholdScratch,
} from './threshold.js';

/** Options of `createDetector` (ARCHITECTURE.md §8, plus the advanced fields marked below). */
export interface DetectorOptions {
  /** expected frame size, px (frames of another size reallocate the buffers) */
  width: number;
  height: number;
  /** `TagFamily.name`, e.g. `'tag36h11'` */
  family: string;
  /** IDs to decode (the board's), or `'all'` for the whole family (debugging) */
  ids: readonly number[] | 'all';
  /** bit errors corrected, 0 … family.maxCorrectedBits (default: the family's, 2) */
  maxCorrectedBits?: number;
  /** minimum local max − min, DN, for a pixel to be black or white (default 10) */
  minContrast?: number;
  /**
   * quad search on the full image (1, default) or a 2 × 2 box-averaged one (2).
   * Edge refinement and decoding always use the full image. Choosing per frame
   * is the tracker's job.
   */
  decimate?: 1 | 2;
  /**
   * gamma of the frames' encoding: gray values are linearised as
   * (v / 255)^edgeGamma before edges are located and cells are read.
   * Default 2.2; 1 = use encoded values.
   */
  edgeGamma?: number;
  /** advanced: minimum outer-border length, search-image px (default 32) */
  minPerimeterPx?: number;
  /** advanced: minimum quad side, search-image px (default 8) */
  minSidePx?: number;
}

/** A detector with preallocated state (ARCHITECTURE.md §8). */
export interface Detector {
  /** Finds the tags in `img`. */
  detect(img: GrayImage): TagDetection[];
  /** Replaces the IDs to decode (e.g. a new board). */
  setIds(ids: readonly number[] | 'all'): void;
}

export const DEFAULT_MIN_CONTRAST = 10;
export const DEFAULT_EDGE_GAMMA = 2.2;
export const DEFAULT_MIN_PERIMETER_PX = 32;
export const DEFAULT_MIN_SIDE_PX = 8;

/** Most candidate quads kept for `lastCandidates()` (debugging and tests). */
const MAX_DEBUG_QUADS = 512;

/** Per-frame counters, for tests and the debug overlay. */
export interface DetectorStats {
  /** outer borders long enough to be considered */
  borders: number;
  /** borders that gave a quad */
  quads: number;
  /** quads that survived edge refinement */
  refined: number;
  /** quads whose cells passed the border/contrast checks */
  read: number;
  /** codes matched to an ID (before duplicate removal) */
  decoded: number;
}

/** The detector implementation; `createDetector` returns it as a `Detector`. */
export class TagDetector implements Detector {
  readonly def: FamilyDef;
  readonly maxCorrectedBits: number;
  readonly minContrast: number;
  readonly decimate: 1 | 2;
  readonly minPerimeterPx: number;
  readonly minSidePx: number;
  /** number of times the frame buffers were (re)allocated */
  allocations = 0;
  readonly stats: DetectorStats = { borders: 0, quads: 0, refined: 0, read: 0, decoded: 0 };

  private readonly matcher: CodeMatcher;
  private readonly refiner: EdgeRefiner;
  private readonly reader: TagReader;
  private readonly quadOpts: QuadFitOptions;
  private width = -1;
  private height = -1;
  private searchW = 0;
  private searchH = 0;
  private dec = new Uint8Array(0);
  private labels = new Uint8Array(0);
  private scratch: ThresholdScratch = {
    tileMin: new Uint8Array(0),
    tileMax: new Uint8Array(0),
    dilMin: new Uint8Array(0),
    dilMax: new Uint8Array(0),
  };
  private follower: BorderFollower | null = null;
  private fitter: QuadFitter | null = null;
  private readonly quad = new Float64Array(8);
  private readonly refined = new Float64Array(8);
  private readonly debugQuads = new Float64Array(8 * MAX_DEBUG_QUADS);
  private debugCount = 0;

  // per-frame state used by the border sink
  private gray: Uint8Array = new Uint8Array(0);
  private out: TagDetection[] = [];
  private readonly sink = (xs: Int32Array, ys: Int32Array, n: number): void =>
    this.onBorder(xs, ys, n);

  constructor(o: DetectorOptions) {
    this.def = getFamilyDef(o.family);
    const maxBits = o.maxCorrectedBits ?? this.def.family.maxCorrectedBits;
    if (!Number.isInteger(maxBits) || maxBits < 0 || maxBits > this.def.family.maxCorrectedBits) {
      throw new Error(
        `matar: maxCorrectedBits must be an integer 0…${this.def.family.maxCorrectedBits} for ${o.family}`,
      );
    }
    this.maxCorrectedBits = maxBits;
    this.minContrast = o.minContrast ?? DEFAULT_MIN_CONTRAST;
    const d = o.decimate ?? 1;
    if (d !== 1 && d !== 2) throw new Error(`matar: decimate must be 1 or 2`);
    this.decimate = d;
    const gamma = o.edgeGamma ?? DEFAULT_EDGE_GAMMA;
    if (!(gamma > 0)) throw new Error('matar: edgeGamma must be > 0');
    this.minPerimeterPx = o.minPerimeterPx ?? DEFAULT_MIN_PERIMETER_PX;
    this.minSidePx = o.minSidePx ?? DEFAULT_MIN_SIDE_PX;
    this.quadOpts = { minPerimeterPx: this.minPerimeterPx, minSidePx: this.minSidePx, decimate: d };
    const lut = linearizationLut(gamma);
    this.refiner = new EdgeRefiner(lut);
    this.reader = new TagReader(this.def, lut);
    this.matcher = new CodeMatcher(this.def);
    this.matcher.setIds(o.ids);
    this.ensureBuffers(o.width, o.height);
  }

  setIds(ids: readonly number[] | 'all'): void {
    this.matcher.setIds(ids);
  }

  detect(img: GrayImage): TagDetection[] {
    const { width: w, height: h, data } = img;
    if (data.length < w * h)
      throw new Error('matar: GrayImage data is shorter than width × height');
    this.ensureBuffers(w, h);
    const st = this.stats;
    st.borders = st.quads = st.refined = st.read = st.decoded = 0;
    this.debugCount = 0;
    this.out = [];
    const sw = this.searchW;
    const sh = this.searchH;
    if (sw < 3 || sh < 3 || !this.follower) return this.out;

    let search = data;
    if (this.decimate === 2) {
      decimate2x2(data, w, h, this.dec);
      search = this.dec;
    }
    adaptiveThreshold(search, sw, sh, this.minContrast, this.labels, this.scratch);
    this.gray = data;
    // an 8-connected border has at least perimeter / √2 points
    const minPoints = Math.max(8, Math.floor(this.minPerimeterPx / Math.SQRT2));
    this.follower.run(this.labels, minPoints, this.sink);
    this.gray = new Uint8Array(0);
    return this.out;
  }

  /**
   * Candidate quads of the last `detect` call (before refinement, full-res px,
   * clockwise on screen), up to 512. For tests and debugging; allocates.
   */
  lastCandidates(): [Vec2, Vec2, Vec2, Vec2][] {
    const q = this.debugQuads;
    const res: [Vec2, Vec2, Vec2, Vec2][] = [];
    for (let i = 0; i < this.debugCount; i++) {
      const o = i * 8;
      res.push([
        [q[o]!, q[o + 1]!],
        [q[o + 2]!, q[o + 3]!],
        [q[o + 4]!, q[o + 5]!],
        [q[o + 6]!, q[o + 7]!],
      ]);
    }
    return res;
  }

  private ensureBuffers(w: number, h: number): void {
    if (w === this.width && h === this.height) return;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 0 || h < 0) {
      throw new Error(`matar: bad frame size ${w} × ${h}`);
    }
    this.width = w;
    this.height = h;
    const d = this.decimate;
    const sw = d === 1 ? w : w >> 1;
    const sh = d === 1 ? h : h >> 1;
    this.searchW = sw;
    this.searchH = sh;
    this.dec = new Uint8Array(d === 1 ? 0 : sw * sh);
    this.labels = new Uint8Array((sw + 2) * (sh + 2));
    const nt = thresholdScratchSize(sw, sh);
    this.scratch = {
      tileMin: new Uint8Array(nt),
      tileMax: new Uint8Array(nt),
      dilMin: new Uint8Array(nt),
      dilMax: new Uint8Array(nt),
    };
    this.follower = sw >= 3 && sh >= 3 ? new BorderFollower(sw, sh) : null;
    this.fitter = this.follower ? new QuadFitter(this.follower.maxPoints) : null;
    this.allocations++;
  }

  /** Handles one outer border: quad → refine → read → match → detection. */
  private onBorder(xs: Int32Array, ys: Int32Array, n: number): void {
    const st = this.stats;
    st.borders++;
    const q = this.quad;
    // fitter exists whenever the follower does (ensureBuffers)
    if (!this.fitter!.fit(xs, ys, n, this.quadOpts, q)) return;
    st.quads++;
    if (this.debugCount < MAX_DEBUG_QUADS) this.debugQuads.set(q, 8 * this.debugCount++);

    const r = this.refined;
    r.set(q);
    const w = this.width;
    const h = this.height;
    if (!this.refiner.refine(this.gray, w, h, r, this.decimate + 1, this.minSidePx)) return;
    st.refined++;
    const reader = this.reader;
    if (!reader.read(this.gray, w, h, r, this.minContrast)) return;
    st.read++;
    const e = this.matcher.match(reader.hi, reader.lo, this.maxCorrectedBits);
    if (e < 0) return;
    st.decoded++;
    const id = this.matcher.id[e]!;
    const k = this.matcher.rot[e]!; // printed TL is at refined corner k
    const corners: [Vec2, Vec2, Vec2, Vec2] = [
      [r[(k * 2) & 7]!, r[(k * 2 + 1) & 7]!],
      [r[(k * 2 + 2) & 7]!, r[(k * 2 + 3) & 7]!],
      [r[(k * 2 + 4) & 7]!, r[(k * 2 + 5) & 7]!],
      [r[(k * 2 + 6) & 7]!, r[(k * 2 + 7) & 7]!],
    ];
    const det: TagDetection = {
      id,
      corners,
      hammingBits: this.matcher.distance,
      margin: reader.margin,
    };
    // §4.1 step 7: the same ID twice → keep the higher margin
    const out = this.out;
    for (let i = 0; i < out.length; i++) {
      if (out[i]!.id === id) {
        if (det.margin > out[i]!.margin) out[i] = det;
        return;
      }
    }
    out.push(det);
  }
}

/** Creates a detector for frames of `width × height` (ARCHITECTURE.md §8). */
export function createDetector(opts: DetectorOptions): Detector {
  return new TagDetector(opts);
}
