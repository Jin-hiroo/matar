'use client';
import { useState } from 'react';
import { createBoard, createTracker, layoutBorderTags, pickTagIds, type PoseEvent } from 'matar';

declare global {
  interface Window {
    __smoke?: { events: { pose: boolean; worker: string }[]; errors: string[] };
  }
}

export default function Tracker() {
  const [started, setStarted] = useState(false);
  const start = async () => {
    setStarted(true);
    const board = createBoard({
      tags: layoutBorderTags({
        areaMm: { x: 0, y: 0, width: 210, height: 297 },
        originMm: [105, 148.5],
        sizeMm: 32,
        ids: pickTagIds('tag36h11', 16, 'matar-demo'),
      }),
    });
    const s: NonNullable<Window['__smoke']> = { events: [], errors: [] };
    window.__smoke = s;
    const tracker = createTracker({ board });
    tracker.addEventListener('pose', (e) => {
      const p = e as PoseEvent;
      s.events.push({ pose: p.pose !== null, worker: p.stats.worker });
    });
    tracker.addEventListener('error', (e) =>
      s.errors.push(String((e as Event & { code?: string }).code)),
    );
    await tracker.start();
  };
  return (
    <button type="button" onClick={start} disabled={started}>
      Start
    </button>
  );
}
