/**
 * D4 (TASKS.md): false positives. Clutter frames (`randomPatches` dark blocks,
 * strokes and tag-like squares, plus real tags whose IDs are not on the board)
 * must give **0** detections of the board's IDs: 1000 frames in CI, 10 000 with
 * MATAR_LONG (`pnpm test:long`). The same frames are also run with the whole
 * family (`ids: 'all'`): every detection must then be one of the real tags,
 * at its true position.
 *
 * Small frames (320 × 240) and 2 × 2 supersampling: only false positives
 * matter here, not sub-pixel accuracy.
 */
import { describe, expect, it } from 'vitest';
import { TagDetector } from '../../src/detect/detector.js';
import {
  intrinsicsFromFov,
  mulberry32,
  randomPatches,
  randomViewPose,
  renderBoard,
} from '../../src/synth/index.js';
import type { Board, BoardTag } from '../../src/types.js';
import { cornerErrorsPx, pickIds, tagTruths } from './detect-helpers.js';

const FRAMES = process.env.MATAR_LONG ? 10_000 : 1000;
const SEED = 401;
const W = 320;
const H = 240;

describe('detector false positives (D4)', () => {
  it(
    `finds no board IDs in ${FRAMES} clutter frames, and no wrong IDs with 'all'`,
    () => {
      const k = intrinsicsFromFov(W, H, 65);
      const rng = mulberry32(SEED);
      const boardIds = pickIds(rng, 40);
      const det = new TagDetector({ width: W, height: H, family: 'tag36h11', ids: boardIds });
      const all = new TagDetector({ width: W, height: H, family: 'tag36h11', ids: 'all' });
      const falsePositives: string[] = [];
      const wrong: string[] = [];
      let quadsRead = 0;
      let realFound = 0;
      for (let frame = 0; frame < FRAMES; frame++) {
        // 0–4 real tags with IDs that are not on the board, white rings kept apart
        const tags: BoardTag[] = [];
        for (const id of pickIds(rng, Math.floor(rng() * 5), boardIds)) {
          for (let tries = 0; tries < 20; tries++) {
            const sizeMm = 15 + rng() * 25;
            const c: [number, number] = [-100 + rng() * 200, -75 + rng() * 150];
            const clear = tags.every(
              (t) =>
                Math.hypot(t.centerMm[0] - c[0], t.centerMm[1] - c[1]) >
                0.9 * (t.sizeMm + sizeMm) + 4,
            );
            if (clear) {
              tags.push({ id, centerMm: c, sizeMm, rotationDeg: rng() * 360 });
              break;
            }
          }
        }
        const real: Board = { family: 'tag36h11', tags };
        const patches = randomPatches(rng, {
          areaMm: { min: [-130, -100], max: [130, 100] },
          count: 30,
          avoid: real,
        });
        const pose = randomViewPose(rng, {
          distanceMm: [150, 350],
          tiltDeg: [0, 60],
          rollDeg: [0, 360],
          targetBoxMm: { min: [-40, -30], max: [40, 30] },
        });
        const img = renderBoard({
          board: real,
          intrinsics: k,
          boardFromCamera: pose,
          patches,
          pageMm: { min: [-150, -110], max: [150, 110] },
          blurSigmaPx: 0.6 + rng() * 0.8,
          noiseSigma: rng() * 4,
          inkLevel: 15 + rng() * 45,
          paperLevel: 160 + rng() * 70,
          seed: SEED * 100_000 + frame,
          supersample: 2,
        });

        for (const d of det.detect(img)) {
          falsePositives.push(
            `frame ${frame}: id ${d.id} (${d.hammingBits} bits, margin ${d.margin.toFixed(1)})`,
          );
        }
        quadsRead += det.stats.read;

        const truths = new Map(tagTruths(real, k, pose).map((t) => [t.id, t]));
        for (const d of all.detect(img)) {
          const t = truths.get(d.id);
          const err = t ? Math.max(...cornerErrorsPx(d, t)) : Infinity;
          if (err <= 2) realFound++;
          else wrong.push(`frame ${frame}: id ${d.id} err ${err.toFixed(2)} px`);
        }
      }
      const msg = `seed ${SEED}, ${FRAMES} frames, ${quadsRead} quads read, ${realFound} real tags found`;
      if (process.env.MATAR_LONG)
        console.info(`D4: ${msg}, ${falsePositives.length} false positives, ${wrong.length} wrong`);
      expect(falsePositives, msg).toEqual([]);
      expect(wrong, msg).toEqual([]);
      // the test is only meaningful if many candidates reached the decoder
      expect(quadsRead, msg).toBeGreaterThan(2 * FRAMES);
      expect(realFound, msg).toBeGreaterThan(FRAMES / 2);
    },
    FRAMES * 300,
  );
});
