import Tracker from './tracker';
import { createBoard, layoutBorderTags, pickTagIds } from 'matar';

// server component: importing matar during SSR must not throw
const ids = pickTagIds('tag36h11', 16, 'matar-demo');

export default function Page() {
  createBoard({
    tags: layoutBorderTags({
      areaMm: { x: 0, y: 0, width: 210, height: 297 },
      originMm: [105, 148.5],
      sizeMm: 32,
      ids,
    }),
  });
  return <Tracker />;
}
