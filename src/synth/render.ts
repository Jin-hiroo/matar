/**
 * Synthetic renderer: an 8-bit gray image of a board seen from a known camera
 * (ARCHITECTURE.md §9.1). Used as ground truth for detector and pose tests.
 *
 * - Rays through each pixel's sample positions (pixel centres at integer
 *   coordinates) hit the board plane y = 0; the albedo there is looked up
 *   analytically (tag cells from `tagCells`, patches, paper, background).
 * - Adaptive supersampling: a pixel whose 4 corners and centre see the same
 *   value gets that value; others get s × s stratified samples (default 8).
 * - Linear light throughout: average, Gaussian blur, then gamma-encode to the
 *   ink/paper levels, add Gaussian noise (DN), clamp and quantise.
 * - Several poses = motion blur (frames averaged in linear light).
 *
 * Pose: `boardFromCamera`, GL camera convention, mm, column-major.
 *
 * Non-null assertions (`!`) here are on typed-array/bin reads whose indices are
 * in range by construction (loop bounds and clamped grid coordinates).
 */
import { tagCells } from '../tags/cells.js';
import type { Board, CameraIntrinsics, GrayImage, Mat4, Vec2 } from '../types.js';
import { mulberry32, normalSampler } from './random.js';

/** A printed rectangle on the board: uniform albedo, or a cell grid like a tag. */
export interface SynthPatch {
  /** centre, board [x, z] mm */
  centerMm: Vec2;
  /** width (page x) and height (page y), mm */
  sizeMm: Vec2;
  /** clockwise on the printed page, degrees */
  rotationDeg: number;
  /** n × n cells, row-major from the printed top-left, 1 = paper, 0 = ink */
  cells?: Uint8Array;
  /** albedo when `cells` is absent: 0 = ink (default), 1 = paper */
  albedo?: number;
}

export interface RenderBoardOptions {
  board: Board;
  /** output size and camera */
  intrinsics: CameraIntrinsics;
  /** one pose, or several to average (motion blur) */
  boardFromCamera: Mat4 | readonly Mat4[];
  /** samples per side for edge pixels, default 8 */
  supersample?: number;
  /** Gaussian blur in linear light, px, default 0 */
  blurSigmaPx?: number;
  /** Gaussian noise added after encoding, DN, default 0 */
  noiseSigma?: number;
  /** noise seed, default 1 */
  seed?: number;
  /** encoded level of ink, DN, default 30 */
  inkLevel?: number;
  /** encoded level of paper, DN, default 210 */
  paperLevel?: number;
  /** encoded level beyond the page or above the horizon, DN, default 90 */
  backgroundLevel?: number;
  /** encoding gamma, default 2.2 (1 = linear) */
  gamma?: number;
  /** paper extent, board [x, z] mm; outside is background. Default: endless paper. */
  pageMm?: { min: Vec2; max: Vec2 };
  /** extra printed patches (distractors), drawn below the tags */
  patches?: readonly SynthPatch[];
}

interface Patch {
  cx: number;
  cz: number;
  cos: number;
  sin: number;
  hw: number;
  hh: number;
  n: number;
  cells: Uint8Array | null;
  albedo: number;
  r: number;
}

const DEG = Math.PI / 180;

function toPatch(p: SynthPatch): Patch {
  const n = p.cells ? Math.round(Math.sqrt(p.cells.length)) : 0;
  if (p.cells && n * n !== p.cells.length) throw new Error('matar/testing: cells must be n × n');
  const hw = p.sizeMm[0] / 2;
  const hh = p.sizeMm[1] / 2;
  return {
    cx: p.centerMm[0],
    cz: p.centerMm[1],
    cos: Math.cos(p.rotationDeg * DEG),
    sin: Math.sin(p.rotationDeg * DEG),
    hw,
    hh,
    n,
    cells: p.cells ?? null,
    albedo: p.albedo ?? 0,
    r: Math.hypot(hw, hh),
  };
}

/** Uniform grid over the patches' bounding boxes, so each lookup tests a few patches. */
class PatchIndex {
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly size: number;
  private readonly bins: number[][];

  constructor(readonly patches: Patch[]) {
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    let maxR = 1;
    for (const p of patches) {
      minX = Math.min(minX, p.cx - p.r);
      minZ = Math.min(minZ, p.cz - p.r);
      maxX = Math.max(maxX, p.cx + p.r);
      maxZ = Math.max(maxZ, p.cz + p.r);
      maxR = Math.max(maxR, p.r);
    }
    if (patches.length === 0) minX = minZ = maxX = maxZ = 0;
    this.size = Math.max(maxR, 5);
    this.minX = minX;
    this.minZ = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / this.size));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / this.size));
    this.bins = Array.from({ length: this.cols * this.rows }, () => []);
    patches.forEach((p, i) => {
      const c0 = this.col(p.cx - p.r);
      const c1 = this.col(p.cx + p.r);
      const r0 = this.row(p.cz - p.r);
      const r1 = this.row(p.cz + p.r);
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) this.bins[r * this.cols + c]!.push(i);
    });
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.size)));
  }

  private row(z: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.size)));
  }

  /** albedo of the topmost patch containing (x, z), or −1 if none */
  albedoAt(x: number, z: number): number {
    const fx = (x - this.minX) / this.size;
    const fz = (z - this.minZ) / this.size;
    if (fx < 0 || fz < 0 || fx >= this.cols || fz >= this.rows) return -1;
    const bin = this.bins[Math.floor(fz) * this.cols + Math.floor(fx)]!;
    for (let k = bin.length - 1; k >= 0; k--) {
      const p = this.patches[bin[k]!]!;
      const dx = x - p.cx;
      const dz = z - p.cz;
      // inverse of the clockwise page rotation
      const lx = dx * p.cos + dz * p.sin;
      const ly = -dx * p.sin + dz * p.cos;
      if (lx < -p.hw || lx >= p.hw || ly < -p.hh || ly >= p.hh) continue;
      if (!p.cells) return p.albedo;
      const col = Math.min(p.n - 1, Math.floor(((lx + p.hw) / (2 * p.hw)) * p.n));
      const row = Math.min(p.n - 1, Math.floor(((ly + p.hh) / (2 * p.hh)) * p.n));
      return p.cells[row * p.n + col]!;
    }
    return -1;
  }
}

/** Renders `o.board` (plus patches) as seen by the camera. */
export function renderBoard(o: RenderBoardOptions): GrayImage {
  const k = o.intrinsics;
  const { width: w, height: h } = k;
  const poses: readonly Mat4[] = Array.isArray(o.boardFromCamera)
    ? (o.boardFromCamera as readonly Mat4[])
    : [o.boardFromCamera as Mat4];
  if (poses.length === 0) throw new Error('matar/testing: no pose');
  const gamma = o.gamma ?? 2.2;
  const lin = (dn: number) => Math.pow(dn / 255, gamma);
  const ink = lin(o.inkLevel ?? 30);
  const paper = lin(o.paperLevel ?? 210);
  const background = lin(o.backgroundLevel ?? 90);
  const s = Math.max(1, Math.round(o.supersample ?? 8));

  const patches: Patch[] = (o.patches ?? []).map(toPatch);
  for (const tag of o.board.tags) {
    patches.push(
      toPatch({
        centerMm: tag.centerMm,
        sizeMm: [tag.sizeMm, tag.sizeMm],
        rotationDeg: tag.rotationDeg,
        cells: tagCells(o.board.family, tag.id),
      }),
    );
  }
  const index = new PatchIndex(patches);
  const page = o.pageMm;

  const acc = new Float32Array(w * h);
  const lattice = new Float32Array((w + 1) * (h + 1));

  for (const m of poses) {
    // Image → board plane: D = A·(u, v, 1) with A = R · Kgl, origin o = translation.
    const r00 = m[0]!,
      r10 = m[1]!,
      r20 = m[2]!;
    const r01 = m[4]!,
      r11 = m[5]!,
      r21 = m[6]!;
    const r02 = m[8]!,
      r12 = m[9]!,
      r22 = m[10]!;
    const ox = m[12]!,
      oy = m[13]!,
      oz = m[14]!;
    // Kgl maps (u, v, 1) to a GL camera direction ((u − cx)/fx, −(v − cy)/fy, −1)
    const a = (row0: number, row1: number, row2: number): [number, number, number] => [
      row0 / k.fx,
      -row1 / k.fy,
      (-row0 * k.cx) / k.fx + (row1 * k.cy) / k.fy - row2,
    ];
    const ax = a(r00, r01, r02);
    const ay = a(r10, r11, r12);
    const az = a(r20, r21, r22);

    const sample = (u: number, v: number): number => {
      const dy = ay[0] * u + ay[1] * v + ay[2];
      const t = -oy / dy;
      if (!(t > 0) || !Number.isFinite(t)) return background;
      const x = ox + t * (ax[0] * u + ax[1] * v + ax[2]);
      const z = oz + t * (az[0] * u + az[1] * v + az[2]);
      if (page && (x < page.min[0] || x >= page.max[0] || z < page.min[1] || z >= page.max[1])) {
        return background;
      }
      const al = index.albedoAt(x, z);
      return al < 0 ? paper : ink + al * (paper - ink);
    };

    for (let j = 0; j <= h; j++) {
      for (let i = 0; i <= w; i++) lattice[j * (w + 1) + i] = sample(i - 0.5, j - 0.5);
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c00 = lattice[y * (w + 1) + x]!;
        const c10 = lattice[y * (w + 1) + x + 1]!;
        const c01 = lattice[(y + 1) * (w + 1) + x]!;
        const c11 = lattice[(y + 1) * (w + 1) + x + 1]!;
        const cc = sample(x, y);
        let value: number;
        if (c00 === cc && c10 === cc && c01 === cc && c11 === cc) {
          value = cc;
        } else {
          let sum = 0;
          for (let sj = 0; sj < s; sj++) {
            const v = y - 0.5 + (sj + 0.5) / s;
            for (let si = 0; si < s; si++) sum += sample(x - 0.5 + (si + 0.5) / s, v);
          }
          value = sum / (s * s);
        }
        acc[y * w + x]! += value;
      }
    }
  }
  if (poses.length > 1) for (let i = 0; i < acc.length; i++) acc[i]! /= poses.length;

  if ((o.blurSigmaPx ?? 0) > 0) gaussianBlur(acc, w, h, o.blurSigmaPx!);

  const data = new Uint8Array(w * h);
  const noise = (o.noiseSigma ?? 0) > 0 ? normalSampler(mulberry32(o.seed ?? 1)) : null;
  const sigma = o.noiseSigma ?? 0;
  const inv = 1 / gamma;
  for (let i = 0; i < data.length; i++) {
    let dn = 255 * Math.pow(Math.max(0, acc[i]!), inv);
    if (noise) dn += sigma * noise();
    data[i] = dn <= 0 ? 0 : dn >= 255 ? 255 : Math.round(dn);
  }
  return { width: w, height: h, data };
}

/** In-place separable Gaussian blur with clamped borders. */
function gaussianBlur(img: Float32Array, w: number, h: number, sigma: number): void {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const kernel = new Float32Array(2 * r + 1);
  let total = 0;
  for (let i = -r; i <= r; i++) total += kernel[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= total;
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        sum += kernel[i + r]! * img[y * w + xx]!;
      }
      tmp[y * w + x] = sum;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        sum += kernel[i + r]! * tmp[yy * w + x]!;
      }
      img[y * w + x] = sum;
    }
  }
}
