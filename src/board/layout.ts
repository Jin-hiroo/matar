/**
 * Border-ring layout (ARCHITECTURE.md §3.1, RESEARCH.md §2.8): places tags in
 * the border band of a page rectangle.
 *
 * Inputs are page mm (SVG frame: x right, y down); the result is board tags,
 * board (x, z) = page (x, y) − originMm (§2.2), all with `rotationDeg` 0.
 *
 * Rules:
 * - A tag's footprint is its black square plus its 1-cell white ring:
 *   F = sizeMm · (squareCells + 2) / squareCells (10/8 · sizeMm for tag36h11).
 * - `marginMm` (default 8) runs from the area edge to the outer edge of the
 *   footprint.
 * - Neighbouring footprints are at least gap = max(minGapMm, one cell =
 *   sizeMm / squareCells) apart (the "one extra white cell"), so the minimum
 *   pitch is F + gap.
 * - The four corner positions are shared by two edges. Each edge holds as many
 *   tags as fit at the minimum pitch, spaced evenly between its corner tags.
 * - Order: clockwise on the printed page from the top-left corner (top edge
 *   left → right, right edge top → bottom, bottom edge right → left, left edge
 *   bottom → top). `ids` are assigned in that order; layout stops when they
 *   run out.
 * - A position whose footprint overlaps a keep-out rectangle (interiors
 *   intersect; touching is fine) is dropped, not moved, and uses no ID.
 *
 * An inner ring around an object is a second call whose `areaMm` is the
 * object's bounding rectangle grown outward by at least marginMm + F (+ any
 * clearance), so the band of tags lies outside the object.
 */
import type { BoardTag, Vec2 } from '../types.js';
import { DEFAULT_FAMILY, getFamily } from '../tags/index.js';
import { tagOuterSizeMm } from './board.js';

/** Axis-aligned rectangle in page mm: top-left (x, y), size width × height. */
export interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options of `layoutBorderTags`. Page mm unless stated otherwise. */
export interface LayoutBorderTagsOptions {
  /** rectangle whose border band receives the tags, page mm */
  areaMm: RectMm;
  /** board origin, page mm */
  originMm: Vec2;
  /** edge of the black square, mm */
  sizeMm: number;
  /** from the area edge to the outer edge of the white ring, default 8 */
  marginMm?: number;
  /** minimum gap between neighbouring white rings, default 0; at least one cell is always kept */
  minGapMm?: number;
  /** page-mm rectangles no footprint may overlap; overlapping positions are dropped */
  keepOutMm?: readonly RectMm[];
  /** tag IDs, assigned in ring order; layout stops when they run out */
  ids: readonly number[];
  /** `TagFamily.name`, default `DEFAULT_FAMILY` */
  family?: string;
}

/** Default `marginMm` of `layoutBorderTags`. */
export const DEFAULT_LAYOUT_MARGIN_MM = 8;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function checkRect(r: RectMm | undefined, what: string): RectMm {
  if (
    !r ||
    !isFiniteNumber(r.x) ||
    !isFiniteNumber(r.y) ||
    !isFiniteNumber(r.width) ||
    !isFiniteNumber(r.height) ||
    r.width < 0 ||
    r.height < 0
  ) {
    throw new Error(
      `matar: layoutBorderTags: ${what} must be { x, y, width ≥ 0, height ≥ 0 } in finite mm`,
    );
  }
  return r;
}

/**
 * Evenly spaced centres from `a` to `b` (both included) at a pitch ≥ `pitch`,
 * as many as fit. Null if not even the two ends fit.
 */
function edgeCentres(a: number, b: number, pitch: number): number[] | null {
  const span = b - a;
  // the 1e-9 lets an exact fit through despite rounding in `span`
  const gaps = Math.floor(span / pitch + 1e-9);
  if (gaps < 1) return null;
  const out: number[] = [];
  for (let k = 0; k < gaps; k++) out.push(a + (span * k) / gaps);
  out.push(b);
  return out;
}

/**
 * Tags in the border band of `areaMm` (see the module comment for the rules).
 * Returns board tags (board = page − originMm), in ring order, rotation 0.
 * Throws if `areaMm` can't hold the four corner tags, or on invalid options
 * (sizes, rectangles, IDs out of range or repeated, unknown family).
 */
export function layoutBorderTags(opts: LayoutBorderTagsOptions): BoardTag[] {
  const familyName = opts.family ?? DEFAULT_FAMILY;
  const family = getFamily(familyName);
  const { sizeMm } = opts;
  const marginMm = opts.marginMm ?? DEFAULT_LAYOUT_MARGIN_MM;
  const minGapMm = opts.minGapMm ?? 0;
  if (!isFiniteNumber(sizeMm) || sizeMm <= 0) {
    throw new Error(`matar: layoutBorderTags: sizeMm must be a finite number > 0 (got ${sizeMm})`);
  }
  if (!isFiniteNumber(marginMm) || marginMm < 0) {
    throw new Error(`matar: layoutBorderTags: marginMm must be finite and ≥ 0 (got ${marginMm})`);
  }
  if (!isFiniteNumber(minGapMm) || minGapMm < 0) {
    throw new Error(`matar: layoutBorderTags: minGapMm must be finite and ≥ 0 (got ${minGapMm})`);
  }
  const area = checkRect(opts.areaMm, 'areaMm');
  const keepOut = (opts.keepOutMm ?? []).map((r, i) => checkRect(r, `keepOutMm[${i}]`));
  const origin = opts.originMm;
  if (!Array.isArray(origin) || !isFiniteNumber(origin[0]) || !isFiniteNumber(origin[1])) {
    throw new Error('matar: layoutBorderTags: originMm must be two finite numbers');
  }
  const ids = opts.ids;
  if (!Array.isArray(ids)) throw new Error('matar: layoutBorderTags: ids must be an array');
  const bad = ids.filter((id) => !Number.isInteger(id) || id < 0 || id >= family.count);
  if (bad.length > 0) {
    throw new Error(
      `matar: layoutBorderTags: tag id(s) ${bad.join(', ')} not valid for ${familyName} ` +
        `(integers 0…${family.count - 1})`,
    );
  }
  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  if (dup.size > 0) {
    throw new Error(`matar: layoutBorderTags: duplicate tag id(s) ${[...dup].join(', ')}`);
  }

  const outerMm = tagOuterSizeMm(sizeMm, family);
  const gapMm = Math.max(minGapMm, sizeMm / family.squareCells);
  const pitchMm = outerMm + gapMm;
  const half = outerMm / 2;
  const xs = edgeCentres(area.x + marginMm + half, area.x + area.width - marginMm - half, pitchMm);
  const ys = edgeCentres(area.y + marginMm + half, area.y + area.height - marginMm - half, pitchMm);
  if (!xs || !ys) {
    const need = 2 * marginMm + 2 * outerMm + gapMm;
    throw new Error(
      `matar: layoutBorderTags: areaMm ${area.width} × ${area.height} mm is too small for the ` +
        `4 corner tags (sizeMm ${sizeMm}, marginMm ${marginMm}, gap ${gapMm} mm): it needs ` +
        `at least ${need} × ${need} mm`,
    );
  }

  // ring positions, clockwise on the page from the top-left corner
  const nx = xs.length;
  const ny = ys.length;
  const xL = xs[0] as number;
  const xR = xs[nx - 1] as number;
  const yT = ys[0] as number;
  const yB = ys[ny - 1] as number;
  const ring: Vec2[] = [];
  for (let k = 0; k < nx; k++) ring.push([xs[k] as number, yT]);
  for (let k = 1; k < ny; k++) ring.push([xR, ys[k] as number]);
  for (let k = nx - 2; k >= 0; k--) ring.push([xs[k] as number, yB]);
  for (let k = ny - 2; k >= 1; k--) ring.push([xL, ys[k] as number]);

  const out: BoardTag[] = [];
  for (const [px, py] of ring) {
    if (out.length >= ids.length) break;
    const blocked = keepOut.some(
      (r) =>
        px - half < r.x + r.width &&
        px + half > r.x &&
        py - half < r.y + r.height &&
        py + half > r.y,
    );
    if (blocked) continue;
    out.push({
      id: ids[out.length] as number,
      centerMm: [px - origin[0], py - origin[1]],
      sizeMm,
      rotationDeg: 0,
    });
  }
  return out;
}
