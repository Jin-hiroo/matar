/**
 * The demo's test board (also rendered into the e2e fake camera video by
 * scripts/make-fake-video.ts): 16 tags of 32 mm around an A4 portrait page,
 * board origin at the page centre, IDs seeded from 'matar-demo'.
 */
import { createBoard, layoutBorderTags, pickTagIds } from '../src/board/index.js';
import type { Board, Vec2 } from '../src/types.js';

export const DEMO_PAGE_MM: Vec2 = [210, 297];
export const DEMO_ORIGIN_MM: Vec2 = [105, 148.5];

export function demoBoard(): Board {
  return createBoard({
    tags: layoutBorderTags({
      areaMm: { x: 0, y: 0, width: DEMO_PAGE_MM[0], height: DEMO_PAGE_MM[1] },
      originMm: DEMO_ORIGIN_MM,
      sizeMm: 32,
      ids: pickTagIds('tag36h11', 16, 'matar-demo'),
    }),
  });
}
