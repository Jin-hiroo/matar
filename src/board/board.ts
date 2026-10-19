/**
 * Board model (ARCHITECTURE.md §3.1): validation and print-scale correction.
 *
 * Input and output tags are in the board frame: centre [x, z] mm on the paper
 * plane, `sizeMm` = edge of the black square, `rotationDeg` clockwise on the
 * printed page (§2.3). A tag's *footprint* is its black square plus the 1-cell
 * white ring around it: a square of edge `sizeMm · (squareCells + 2) /
 * squareCells` (10/8 of `sizeMm` for tag36h11), rotated with the tag.
 *
 * `createBoard` rejects boards whose footprints overlap. Rotated footprints are
 * tested exactly with the separating-axis theorem on the two rotated squares
 * (not their bounding boxes); footprints that only touch are allowed.
 */
import type { Board, BoardTag, TagFamily, Vec2 } from '../types.js';
import { DEFAULT_FAMILY, getFamily } from '../tags/index.js';

const DEG = Math.PI / 180;
/** IDs listed in one error message before it is cut short. */
const MAX_LISTED = 12;

/** Input of `createBoard`. */
export interface CreateBoardInput {
  /** `TagFamily.name`; default `DEFAULT_FAMILY` ('tag36h11') */
  family?: string;
  tags: readonly BoardTag[];
}

/**
 * Edge of a tag's footprint (black square + its 1-cell white ring), mm:
 * `sizeMm · (squareCells + 2) / squareCells`.
 */
export function tagOuterSizeMm(
  sizeMm: number,
  family: string | TagFamily = DEFAULT_FAMILY,
): number {
  const f = typeof family === 'string' ? getFamily(family) : family;
  return (sizeMm * (f.squareCells + 2)) / f.squareCells;
}

function list(values: readonly unknown[]): string {
  const shown = values.slice(0, MAX_LISTED).map(String).join(', ');
  return values.length > MAX_LISTED ? `${shown}, … (${values.length} in all)` : shown;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Footprint of one tag prepared for the separating-axis test. */
interface Footprint {
  id: number;
  cx: number;
  cz: number;
  /** half edge, mm */
  h: number;
  /** unit edge directions: u = (c, s), v = (−s, c) */
  c: number;
  s: number;
}

/** Projection radius of footprint `f` onto unit axis (ax, az). */
function radius(f: Footprint, ax: number, az: number): number {
  return f.h * (Math.abs(f.c * ax + f.s * az) + Math.abs(-f.s * ax + f.c * az));
}

/** True if the two rotated squares overlap by more than `eps` mm on every axis. */
function overlaps(a: Footprint, b: Footprint, eps: number): boolean {
  const dx = b.cx - a.cx;
  const dz = b.cz - a.cz;
  // quick reject: circumscribed circles apart
  const rr = (a.h + b.h) * Math.SQRT2;
  if (dx * dx + dz * dz >= rr * rr) return false;
  const axes: Vec2[] = [
    [a.c, a.s],
    [-a.s, a.c],
    [b.c, b.s],
    [-b.s, b.c],
  ];
  for (const [ax, az] of axes) {
    const d = Math.abs(dx * ax + dz * az);
    if (d >= radius(a, ax, az) + radius(b, ax, az) - eps) return false;
  }
  return true;
}

/**
 * Validates a board and returns a deep-frozen copy (ARCHITECTURE.md §3.1).
 *
 * Throws an `Error` naming the offending tag ID(s) if any tag has an ID that is
 * not an integer in 0 … count − 1 of the family, a duplicate ID, `sizeMm` ≤ 0
 * (or not finite), a non-finite centre or rotation, or if two tags' footprints
 * (black square + 1-cell white ring) overlap. Throws on an unknown family and on
 * a board with no tags.
 */
export function createBoard(input: CreateBoardInput): Board {
  const familyName = input.family ?? DEFAULT_FAMILY;
  const family = getFamily(familyName);
  const tags = input.tags;
  if (!Array.isArray(tags)) throw new Error('matar: createBoard: tags must be an array');
  if (tags.length === 0) throw new Error('matar: createBoard: a board needs at least one tag');

  const badId: unknown[] = [];
  const badSize: unknown[] = [];
  const badCenter: unknown[] = [];
  const badRotation: unknown[] = [];
  for (const t of tags as readonly Partial<BoardTag>[]) {
    const id = t.id;
    if (!Number.isInteger(id) || (id as number) < 0 || (id as number) >= family.count) {
      badId.push(id);
    }
    if (!isFiniteNumber(t.sizeMm) || t.sizeMm <= 0) badSize.push(id);
    const c = t.centerMm;
    if (!Array.isArray(c) || c.length !== 2 || !isFiniteNumber(c[0]) || !isFiniteNumber(c[1])) {
      badCenter.push(id);
    }
    if (!isFiniteNumber(t.rotationDeg)) badRotation.push(id);
  }
  if (badId.length > 0) {
    throw new Error(
      `matar: createBoard: tag id(s) ${list(badId)} not valid for ${familyName} ` +
        `(integers 0…${family.count - 1})`,
    );
  }
  if (badSize.length > 0) {
    throw new Error(
      `matar: createBoard: sizeMm must be a finite number > 0 (tag id(s) ${list(badSize)})`,
    );
  }
  if (badCenter.length > 0) {
    throw new Error(
      `matar: createBoard: centerMm must be two finite numbers (tag id(s) ${list(badCenter)})`,
    );
  }
  if (badRotation.length > 0) {
    throw new Error(
      `matar: createBoard: rotationDeg must be a finite number (tag id(s) ${list(badRotation)})`,
    );
  }

  const seen = new Set<number>();
  const dup = new Set<number>();
  for (const t of tags) {
    if (seen.has(t.id)) dup.add(t.id);
    seen.add(t.id);
  }
  if (dup.size > 0) throw new Error(`matar: createBoard: duplicate tag id(s) ${list([...dup])}`);

  const ring = (family.squareCells + 2) / family.squareCells;
  const feet: Footprint[] = tags.map((t) => ({
    id: t.id,
    cx: t.centerMm[0],
    cz: t.centerMm[1],
    h: (t.sizeMm * ring) / 2,
    c: Math.cos(t.rotationDeg * DEG),
    s: Math.sin(t.rotationDeg * DEG),
  }));
  const pairs: string[] = [];
  for (let i = 0; i < feet.length; i++) {
    const a = feet[i] as Footprint;
    for (let j = i + 1; j < feet.length; j++) {
      const b = feet[j] as Footprint;
      // touching footprints are fine; allow for rounding in computed layouts
      if (overlaps(a, b, 1e-9 * (a.h + b.h))) pairs.push(`${a.id} & ${b.id}`);
    }
  }
  if (pairs.length > 0) {
    throw new Error(
      `matar: createBoard: tags overlap (black square + 1-cell white ring): ${list(pairs)}`,
    );
  }

  const out: BoardTag[] = tags.map((t) => {
    const centerMm: Vec2 = [t.centerMm[0], t.centerMm[1]];
    Object.freeze(centerMm);
    return Object.freeze({ id: t.id, centerMm, sizeMm: t.sizeMm, rotationDeg: t.rotationDeg });
  });
  return Object.freeze({ family: familyName, tags: Object.freeze(out) });
}

/**
 * The board printed at scale `s`: centres and sizes × s, IDs and rotations
 * unchanged. This is the print-scale correction: `s = measured ruler / rulerMm`.
 * Returns a validated, deep-frozen board. Throws unless `s` is finite and > 0.
 */
export function scaleBoard(board: Board, s: number): Board {
  if (!isFiniteNumber(s) || s <= 0) {
    throw new Error(`matar: scaleBoard: scale must be a finite number > 0 (got ${s})`);
  }
  return createBoard({
    family: board.family,
    tags: board.tags.map((t) => ({
      id: t.id,
      centerMm: [t.centerMm[0] * s, t.centerMm[1] * s],
      sizeMm: t.sizeMm * s,
      rotationDeg: t.rotationDeg,
    })),
  });
}
