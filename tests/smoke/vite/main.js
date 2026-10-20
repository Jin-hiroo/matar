import { createBoard, createTracker, layoutBorderTags, pickTagIds } from 'matar';
document.getElementById('start').addEventListener('click', async () => {
  const board = createBoard({
    tags: layoutBorderTags({
      areaMm: { x: 0, y: 0, width: 210, height: 297 },
      originMm: [105, 148.5],
      sizeMm: 32,
      ids: pickTagIds('tag36h11', 16, 'matar-demo'),
    }),
  });
  const s = (window.__smoke = { events: [], errors: [] });
  const tracker = createTracker({ board });
  tracker.addEventListener('pose', (e) =>
    s.events.push({ pose: e.pose !== null, worker: e.stats.worker }),
  );
  tracker.addEventListener('error', (e) => s.errors.push(e.code));
  await tracker.start();
});
