/**
 * D3 (TASKS.md): decoding and corner order. All four in-plane rotations give
 * the right ID and TL, TR, BR, BL; up to 2 flipped data cells decode to the
 * right ID, 3 don't decode; at ≥ 3 px/cell (shortest projected cell edge),
 * tilt ≤ 60°, blur 0.8 px, noise 2 DN: ≥ 99 % detected, 100 % correct IDs.
 */
import { describe, expect, it } from 'vitest';
import { createDetector } from '../../src/detect/index.js';
import { TagDetector } from '../../src/detect/detector.js';
import {
  intrinsicsFromFov,
  lookAtPose,
  mulberry32,
  randomViewPose,
  renderBoard,
} from '../../src/synth/index.js';
import type { SynthPatch } from '../../src/synth/index.js';
import { getFamilyDef } from '../../src/tags/families.js';
import { tagCells } from '../../src/tags/index.js';
import type { Board, BoardTag } from '../../src/types.js';
import { cornerErrorsPx, gridBoard, pickIds, runFrames, tagTruths } from './detect-helpers.js';

const K = intrinsicsFromFov(640, 480, 65);
const def = getFamilyDef('tag36h11');

describe('detector decoding (D3)', () => {
  it('gives the right ID and corner order for all four in-plane rotations', () => {
    const rng = mulberry32(301);
    const views = [
      lookAtPose([0, 300, 0], [0, 0, 0]), // fronto-parallel
      lookAtPose([90, 260, 120], [0, 0, 0]), // tilted
      lookAtPose([-150, 200, -60], [0, 0, 0], [1, 0, 0]), // tilted, page sideways in the image
    ];
    for (let v = 0; v < views.length; v++) {
      for (const base of [0, 90, 180, 270]) {
        const ids = pickIds(rng, 4);
        const tags: BoardTag[] = ids.map((id, i) => ({
          id,
          centerMm: [(i % 2 ? 1 : -1) * 25, (i < 2 ? -1 : 1) * 25],
          sizeMm: 30,
          rotationDeg: (base + i * 90) % 360,
        }));
        const board: Board = { family: 'tag36h11', tags };
        const pose = views[v]!;
        const img = renderBoard({ board, intrinsics: K, boardFromCamera: pose, blurSigmaPx: 0.8 });
        const dets = createDetector({ width: 640, height: 480, family: 'tag36h11', ids }).detect(
          img,
        );
        const msg = `view ${v} base ${base}°`;
        expect(dets.map((d) => d.id).sort(), msg).toEqual([...ids].sort());
        for (const t of tagTruths(board, K, pose)) {
          const d = dets.find((x) => x.id === t.id)!;
          expect(Math.max(...cornerErrorsPx(d, t)), `${msg} id ${t.id}`).toBeLessThan(0.5);
          expect(d.hammingBits).toBe(0);
        }
      }
    }
  });

  it('corrects up to 2 flipped data cells and rejects 3', () => {
    const rng = mulberry32(302);
    let cases = 0;
    for (let frame = 0; frame < 12; frame++) {
      const ids = pickIds(rng, 9);
      // the tags as printed, but drawn as patches with some data cells flipped
      const truthBoard = gridBoard(rng, ids, { cols: 3, rows: 3, pitchMm: 60, sizeMm: [28, 32] });
      const flips = new Map<number, number>();
      const patches: SynthPatch[] = truthBoard.tags.map((t, i) => {
        const cells = tagCells('tag36h11', t.id);
        const nFlip = 1 + ((frame * 9 + i) % 3);
        flips.set(t.id, nFlip);
        const bits = new Set<number>();
        while (bits.size < nFlip) bits.add(Math.floor(rng() * def.nbits));
        for (const b of bits) {
          const c = def.bitY[b]! * 8 + def.bitX[b]!;
          cells[c] = 1 - cells[c]!;
        }
        return {
          centerMm: t.centerMm,
          sizeMm: [t.sizeMm, t.sizeMm],
          rotationDeg: t.rotationDeg,
          cells,
        };
      });
      const pose = randomViewPose(rng, {
        distanceMm: [230, 300],
        tiltDeg: [0, 40],
        rollDeg: [0, 360],
        targetBoxMm: { min: [-10, -10], max: [10, 10] },
      });
      const img = renderBoard({
        board: { family: 'tag36h11', tags: [] },
        intrinsics: K,
        boardFromCamera: pose,
        patches,
        blurSigmaPx: 0.8,
        noiseSigma: 2,
        seed: frame + 1,
      });
      for (const ids2 of [ids, 'all'] as const) {
        const dets = createDetector({
          width: 640,
          height: 480,
          family: 'tag36h11',
          ids: ids2,
        }).detect(img);
        for (const t of tagTruths(truthBoard, K, pose)) {
          if (!t.inView || t.minCellPx < 4) continue;
          cases++;
          const nFlip = flips.get(t.id)!;
          const d = dets.find((x) => x.id === t.id);
          const msg = `seed 302 frame ${frame} id ${t.id} flips ${nFlip} ids ${ids2 === 'all' ? 'all' : 'board'}`;
          if (nFlip <= 2) {
            expect(d, msg).toBeDefined();
            expect(d!.hammingBits, msg).toBe(nFlip);
            expect(Math.max(...cornerErrorsPx(d!, t)), msg).toBeLessThan(0.5);
          } else {
            expect(d, msg).toBeUndefined();
          }
        }
        // nothing else may decode: every detection is one of the ≤ 2-flip tags
        for (const d of dets)
          expect(flips.get(d.id), `frame ${frame} stray id ${d.id}`).toBeLessThanOrEqual(2);
      }
    }
    expect(cases).toBeGreaterThanOrEqual(150);
  });

  it('detects ≥ 99 % at ≥ 3 px/cell, tilt ≤ 60° (blur 0.8, noise 2) with 100 % correct IDs', () => {
    const r = runFrames({
      seed: 303,
      width: 640,
      height: 480,
      blurSigmaPx: 0.8,
      noiseSigma: 2,
      supersample: 4,
      distanceMm: [250, 650],
      tiltDeg: [0, 60],
      minCellPx: 3,
      maxTiltDeg: 60,
      minInstances: 300,
    });
    const msg = `seed 303: ${r.found}/${r.instances} found; misses ${r.misses.join('; ')}`;
    expect(r.instances).toBeGreaterThanOrEqual(300);
    expect(r.found / r.instances, msg).toBeGreaterThanOrEqual(0.99);
    expect(r.wrong, msg).toEqual([]);
  });

  it("has no wrong IDs when matching the whole family ('all')", () => {
    const r = runFrames({
      seed: 304,
      width: 640,
      height: 480,
      blurSigmaPx: 0.8,
      noiseSigma: 2,
      supersample: 4,
      distanceMm: [250, 650],
      tiltDeg: [0, 60],
      minCellPx: 3,
      maxTiltDeg: 60,
      minInstances: 200,
      ids: 'all',
    });
    const msg = `seed 304: ${r.found}/${r.instances} found`;
    expect(r.found / r.instances, msg).toBeGreaterThanOrEqual(0.99);
    expect(r.wrong, msg).toEqual([]);
  });

  it('keeps the higher-margin detection when an ID appears twice', () => {
    const pose = lookAtPose([0, 320, 0], [0, 0, 0]);
    const big: BoardTag = { id: 77, centerMm: [-35, 0], sizeMm: 36, rotationDeg: 10 };
    const small: BoardTag = { id: 77, centerMm: [35, 0], sizeMm: 18, rotationDeg: -20 };
    const det = new TagDetector({ width: 640, height: 480, family: 'tag36h11', ids: [77] });
    const render = (tags: BoardTag[]) =>
      renderBoard({
        board: { family: 'tag36h11', tags },
        intrinsics: K,
        boardFromCamera: pose,
        blurSigmaPx: 1.5,
      });
    const [alone1] = det.detect(render([big]));
    const [alone2] = det.detect(render([small]));
    expect(alone1 && alone2).toBeTruthy();
    const both = det.detect(render([big, small]));
    expect(both.length).toBe(1);
    const keep = alone1!.margin >= alone2!.margin ? alone1! : alone2!;
    expect(both[0]!.margin).toBeCloseTo(keep.margin, 6);
    expect(both[0]!.corners[0][0]).toBeCloseTo(keep.corners[0][0], 6);
  });

  it('setIds swaps the code set; maxCorrectedBits is validated', () => {
    const board: Board = {
      family: 'tag36h11',
      tags: [{ id: 12, centerMm: [0, 0], sizeMm: 32, rotationDeg: 0 }],
    };
    const img = renderBoard({
      board,
      intrinsics: K,
      boardFromCamera: lookAtPose([20, 300, 30], [0, 0, 0]),
      blurSigmaPx: 0.8,
    });
    const det = createDetector({ width: 640, height: 480, family: 'tag36h11', ids: [12] });
    expect(det.detect(img).map((d) => d.id)).toEqual([12]);
    det.setIds([13, 14]);
    expect(det.detect(img)).toEqual([]);
    det.setIds('all');
    expect(det.detect(img).map((d) => d.id)).toEqual([12]);
    const opts = { width: 640, height: 480, family: 'tag36h11', ids: [12] };
    expect(() => createDetector({ ...opts, maxCorrectedBits: 3 })).toThrow(/maxCorrectedBits/);
    expect(() => createDetector({ ...opts, maxCorrectedBits: -1 })).toThrow(/maxCorrectedBits/);
    expect(() => createDetector({ ...opts, family: 'tag16h5' })).toThrow(/unknown tag family/);
    expect(() => createDetector({ ...opts, ids: [600] })).toThrow(/out of range/);
  });
});
