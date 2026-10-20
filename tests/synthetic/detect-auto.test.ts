/**
 * D5 (TASKS.md): the `decimate: 'auto'` policy (ARCHITECTURE.md §4.1 step 1):
 * ×1 on every 8th call and whenever the previous call found nothing;
 * otherwise ×2 if the previous call's smallest cell was ≥ 5 px, else ×1.
 */
import { describe, expect, it } from 'vitest';
import { TagDetector } from '../../src/detect/detector.js';
import { intrinsicsFromFov, lookAtPose, renderBoard } from '../../src/synth/index.js';
import type { Board, BoardTag, GrayImage } from '../../src/types.js';
import { tagTruths } from './detect-helpers.js';

const K = intrinsicsFromFov(640, 480, 65);
const POSE = lookAtPose([10, 250, 20], [0, 0, 0]);

/** Three 40 mm tags: ≈ 9.6–9.8 px per cell from 25 cm. */
const BIG: BoardTag[] = [1, 2, 3].map((id, i) => ({
  id,
  centerMm: [-60 + i * 60, -30],
  sizeMm: 40,
  rotationDeg: 15 * i,
}));
/** Three 12–16 mm tags: 3.0, 3.6 and 4.1 px per cell. */
const SMALL: BoardTag[] = [5, 6, 7].map((id, i) => ({
  id,
  centerMm: [-40 + i * 40, 50],
  sizeMm: 12 + i * 2,
  rotationDeg: 20 * i,
}));

function render(tags: BoardTag[]): GrayImage {
  const board: Board = { family: 'tag36h11', tags };
  return renderBoard({
    board,
    intrinsics: K,
    boardFromCamera: POSE,
    blurSigmaPx: 0.8,
    noiseSigma: 2,
    supersample: 4,
  });
}

const bigOnly = render(BIG);
const bigAndSmall = render([...BIG, ...SMALL]);
const empty = render([]);

function auto(): TagDetector {
  return new TagDetector({ width: 640, height: 480, family: 'tag36h11', ids: 'all' });
}

describe("decimate 'auto' (D5)", () => {
  it('the scenes have the intended cell sizes', () => {
    const cells = tagTruths({ family: 'tag36h11', tags: [...BIG, ...SMALL] }, K, POSE);
    for (const t of cells) {
      expect(t.inView).toBe(true);
      if (t.id < 5) expect(t.minCellPx).toBeGreaterThan(8);
      else expect(t.minCellPx).toBeLessThan(4.2);
    }
  });

  it('is the default and leaves fixed 1 and 2 alone', () => {
    expect(auto().decimateMode).toBe('auto');
    for (const d of [1, 2] as const) {
      const det = new TagDetector({
        width: 640,
        height: 480,
        family: 'tag36h11',
        ids: 'all',
        decimate: d,
      });
      for (let i = 0; i < 10; i++) {
        det.detect(bigOnly);
        expect(det.lastDecimate).toBe(d);
      }
    }
  });

  it('runs ×2 after big cells were found, with a ×1 call every 8th', () => {
    const det = auto();
    const used: number[] = [];
    for (let i = 0; i < 20; i++) {
      expect(det.detect(bigOnly).length, `call ${i}`).toBe(3);
      used.push(det.lastDecimate);
    }
    expect(used).toEqual([1, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2]);
  });

  it('stays ×1 when nothing is found or the smallest cell is < 5 px', () => {
    const det = auto();
    for (let i = 0; i < 10; i++) {
      det.detect(empty);
      expect(det.lastDecimate).toBe(1);
    }
    for (let i = 0; i < 10; i++) {
      expect(det.detect(bigAndSmall).length).toBe(6);
      expect(det.lastDecimate).toBe(1);
    }
  });

  it('finds 3–4 px/cell tags that appear during a ×2 run within 8 calls, then stays ×1', () => {
    for (let start = 1; start <= 8; start++) {
      // a ×2 steady state on big tags, entered at every phase of the 8-call cycle
      const det = auto();
      for (let i = 0; i < 8 + start; i++) det.detect(bigOnly);
      // ×2 often finds these too (measured: 99.6 % at 3–4 px/cell), so check the
      // guarantee itself: a full-resolution call within 8 calls, which finds them
      let calls = 0;
      let found: number;
      do {
        calls++;
        found = det.detect(bigAndSmall).length;
      } while (det.lastDecimate !== 1 && calls < 8);
      expect(det.lastDecimate, `phase ${start}: no ×1 call within 8 calls`).toBe(1);
      expect(found, `phase ${start}`).toBe(6);
      for (let i = 0; i < 10; i++) {
        expect(det.detect(bigAndSmall).length, `phase ${start}, after ${i}`).toBe(6);
        expect(det.lastDecimate).toBe(1);
      }
    }
  });

  it('setIds forces the next call to full resolution', () => {
    const det = auto();
    det.detect(bigOnly);
    det.detect(bigOnly);
    expect(det.lastDecimate).toBe(2);
    det.setIds([1, 2, 3]);
    det.detect(bigOnly);
    expect(det.lastDecimate).toBe(1);
  });

  it('falls back to ×1 on frames too small to decimate', () => {
    const det = new TagDetector({
      width: 5,
      height: 5,
      family: 'tag36h11',
      ids: 'all',
      decimate: 2,
    });
    det.detect({ width: 5, height: 5, data: new Uint8Array(25) });
    expect(det.lastDecimate).toBe(1);
  });
});
