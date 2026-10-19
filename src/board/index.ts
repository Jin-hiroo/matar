/**
 * Boards and print (ARCHITECTURE.md §2.2–2.3, §3.1, §8): the board model,
 * seeded ID sets, border-ring layout and SVG output. All units are mm; board
 * coordinates are [x, z] on the paper plane, page coordinates are SVG (x right,
 * y down) with board (x, z) = page (x, y) − originMm.
 */
export { boardTagCornersMm, tagLocalToBoard } from './corners.js';
export { createBoard, scaleBoard, tagOuterSizeMm, type CreateBoardInput } from './board.js';
export { pickTagIds } from './ids.js';
export {
  layoutBorderTags,
  DEFAULT_LAYOUT_MARGIN_MM,
  type LayoutBorderTagsOptions,
  type RectMm,
} from './layout.js';
export { tagSvg, boardSvg, type TagSvgOptions, type BoardSvgOptions } from './svg.js';
