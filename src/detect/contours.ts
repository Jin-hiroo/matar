/**
 * Detector step 3a (ARCHITECTURE.md §4.1): border following on the black
 * regions of the threshold labels, after Suzuki & Abe, "Topological structural
 * analysis of digitized binary images by border following", CVGIP 30(1), 1985
 * (Algorithm 1, 8-connected foreground). Written from the paper.
 *
 * Input: the padded label buffer of `adaptiveThreshold` ((w + 2) × (h + 2),
 * BLACK = foreground, everything else background, 1-px background frame). The
 * buffer is used as the algorithm's work image and is overwritten with border
 * marks. Hole borders are followed only to mark them (so they are never
 * mistaken for outer borders); outer borders are recorded and handed to a sink.
 *
 * Output coordinates are image pixels of the unpadded w × h image (integers).
 * Outer borders come out counter-clockwise on screen (y down).
 *
 * Non-null assertions (`!`) are on typed-array reads whose indices are in range
 * by construction (the background frame keeps every neighbour inside the buffer).
 */
import { BLACK } from './threshold.js';

/**
 * Unvisited foreground, copied into a module-local constant: hot loops must not
 * read an imported binding per pixel (module runners such as vitest's wrap
 * imports in getters).
 */
const FG_UNVISITED: number = BLACK;

/** Suzuki's NBD on a pixel whose east neighbour was not examined as background. */
const MARK_POS = 1;
/** Suzuki's −NBD: the pixel's east neighbour is background examined while following. */
const MARK_NEG = 2;
/** Labels below this value are foreground (BLACK or a border mark). */
const FG_LIMIT = 3;

/** Called once per outer border with `n` points in `xs`/`ys` (0 … n − 1). */
export type OuterBorderSink = (xs: Int32Array, ys: Int32Array, n: number) => void;

/** Border follower for one image size; owns its point buffers. */
export class BorderFollower {
  readonly xs: Int32Array;
  readonly ys: Int32Array;
  private readonly off = new Int32Array(8);

  /**
   * `maxPoints`: longest outer border recorded; longer ones are still followed
   * (to mark them) but not reported. A convex region inside the image has at
   * most 2·(w + h) border pixels.
   */
  constructor(
    readonly width: number,
    readonly height: number,
    readonly maxPoints = 2 * (width + height) + 16,
  ) {
    this.xs = new Int32Array(maxPoints);
    this.ys = new Int32Array(maxPoints);
    const s = width + 2;
    // direction k: 0 E, 1 SE, 2 S, 3 SW, 4 W, 5 NW, 6 N, 7 NE (k + 1 = clockwise on screen)
    const dx = [1, 1, 0, -1, -1, -1, 0, 1];
    const dy = [0, 1, 1, 1, 0, -1, -1, -1];
    for (let k = 0; k < 8; k++) this.off[k] = dy[k]! * s + dx[k]!;
  }

  /**
   * Raster-scans `img` and follows every border. Each outer border with at
   * least `minPoints` points that doesn't touch the image edge and fits in the
   * buffers is passed to `sink`.
   */
  run(img: Uint8Array, minPoints: number, sink: OuterBorderSink): void {
    const s = this.width + 2;
    // Raster order over the padded buffer: the frame is background, so scanning
    // it is harmless and the rows can be one linear range.
    const first = s + 1;
    const last = this.height * s + this.width;
    const words = this.wordView(img);
    if (!words) {
      for (let p = first; p <= last; p++) this.visit(img, p, minPoints, sink);
      return;
    }
    // 4 labels per word; a word whose bytes all have bit 6 set (WHITE 255,
    // UNKNOWN 127) holds no foreground (BLACK 0, marks 1–2) and is skipped.
    // Following only rewrites foreground bytes, so a skipped word stays skippable.
    for (let k = first >> 2, kEnd = last >> 2; k <= kEnd; k++) {
      if ((words[k]! & 0x40404040) === 0x40404040) continue;
      const p0 = k << 2;
      const pa = p0 > first ? p0 : first;
      const pb = p0 + 3 < last ? p0 + 3 : last;
      for (let p = pa; p <= pb; p++) this.visit(img, p, minPoints, sink);
    }
  }

  private words: Uint32Array | null = null;
  private wordsOf: Uint8Array | null = null;

  /** A cached Uint32 view of `img`, or null if it isn't 4-byte aligned. */
  private wordView(img: Uint8Array): Uint32Array | null {
    if (this.wordsOf === img) return this.words;
    this.wordsOf = img;
    this.words =
      img.byteOffset % 4 === 0
        ? new Uint32Array(img.buffer, img.byteOffset, img.byteLength >> 2)
        : null;
    return this.words;
  }

  /** Suzuki's start conditions at pixel p (raster order). */
  private visit(img: Uint8Array, p: number, minPoints: number, sink: OuterBorderSink): void {
    const v = img[p]!;
    if (v === FG_UNVISITED) {
      // (1) outer border start: unvisited foreground with background to the west
      if (img[p - 1]! >= FG_LIMIT) {
        const n = this.follow(img, p, 4, true);
        if (n >= minPoints) sink(this.xs, this.ys, n);
        return;
      }
    } else if (v !== MARK_POS) {
      return;
    }
    // (2) hole border start: foreground (not −NBD) with background to the east
    if (img[p + 1]! >= FG_LIMIT) this.follow(img, p, 0, false);
  }

  /**
   * Follows one border from `p0`, whose neighbour in direction `startDir` is
   * background (Suzuki steps 3.1–3.5). Returns the number of recorded points,
   * or 0 when not recording, when the border touches the image edge, or when
   * it is longer than `maxPoints`.
   */
  private follow(img: Uint8Array, p0: number, startDir: number, record: boolean): number {
    const off = this.off;
    const s = this.width + 2;
    // 3.1: clockwise from the background neighbour, find the first foreground pixel
    let d1 = -1;
    for (let k = 0; k < 8; k++) {
      const d = (startDir + k) & 7;
      if (img[p0 + off[d]!]! < FG_LIMIT) {
        d1 = d;
        break;
      }
    }
    if (d1 < 0) {
      img[p0] = MARK_NEG; // isolated pixel
      return 0;
    }
    const p1 = p0 + off[d1]!;
    const maxX = this.width;
    const maxY = this.height;
    const cap = this.maxPoints;
    let n = 0;
    let ok = record;
    let p3 = p0;
    let back = d1; // direction from p3 to the previous border pixel
    for (;;) {
      // 3.3: counter-clockwise from the previous pixel, find the next foreground pixel
      let d4 = back;
      let eastExamined = false;
      for (let k = 1; k <= 8; k++) {
        const d = (back - k) & 7;
        if (img[p3 + off[d]!]! < FG_LIMIT) {
          d4 = d;
          break;
        }
        if (d === 0) eastExamined = true;
      }
      // 3.4
      if (eastExamined) img[p3] = MARK_NEG;
      else if (img[p3] === FG_UNVISITED) img[p3] = MARK_POS;
      if (ok) {
        const y = (p3 / s) | 0;
        const x = p3 - y * s;
        if (x === 1 || y === 1 || x === maxX || y === maxY || n === cap) {
          ok = false;
        } else {
          this.xs[n] = x - 1;
          this.ys[n] = y - 1;
          n++;
        }
      }
      // 3.5
      const p4 = p3 + off[d4]!;
      if (p4 === p0 && p3 === p1) break;
      back = (d4 + 4) & 7;
      p3 = p4;
    }
    return ok ? n : 0;
  }
}
