/**
 * Tag geometry on the board plane (ARCHITECTURE.md §2.3).
 *
 * Board [x, z] mm; the page is y-down and board (x, z) = page (x, y) − originMm,
 * so board x/z axes are page x/y axes. `rotationDeg` θ turns clockwise on the
 * printed page like SVG `rotate(θ)`: x' = x cos θ − y sin θ, y' = x sin θ + y cos θ.
 */
import type { BoardTag, Vec2 } from '../types.js';

const DEG = Math.PI / 180;

/** Tag-local point (mm from the tag centre, page axes, unrotated) → board [x, z]. */
export function tagLocalToBoard(tag: BoardTag, lx: number, ly: number): Vec2 {
  const c = Math.cos(tag.rotationDeg * DEG);
  const s = Math.sin(tag.rotationDeg * DEG);
  return [tag.centerMm[0] + lx * c - ly * s, tag.centerMm[1] + lx * s + ly * c];
}

/**
 * The four outer corners of the black square in board [x, z] mm, in the order
 * TL, TR, BR, BL of the unrotated printed tag (clockwise on the page, and
 * clockwise seen from +Y). `TagDetection.corners` uses the same order.
 */
export function boardTagCornersMm(tag: BoardTag): [Vec2, Vec2, Vec2, Vec2] {
  const h = tag.sizeMm / 2;
  return [
    tagLocalToBoard(tag, -h, -h),
    tagLocalToBoard(tag, h, -h),
    tagLocalToBoard(tag, h, h),
    tagLocalToBoard(tag, -h, h),
  ];
}
