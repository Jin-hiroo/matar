/**
 * D2 (TASKS.md): edge refinement accuracy against `projectBoardCorners`.
 * Clean renders (blur 0.8 px, no noise, ≥ 5 px/cell, tilt ≤ 50°): corner RMS
 * ≤ 0.1 px, max ≤ 0.25 px; noise 3 DN + blur 1.2 px: RMS ≤ 0.3 px. The
 * detector linearises with edgeGamma = the render's gamma.
 */
import { describe, expect, it } from 'vitest';
import { rms, runFrames, type FrameRunOptions } from './detect-helpers.js';

const BASE: Omit<FrameRunOptions, 'seed' | 'blurSigmaPx' | 'noiseSigma'> = {
  width: 640,
  height: 480,
  distanceMm: [200, 320],
  supersample: 4,
  tiltDeg: [0, 50],
  minCellPx: 5,
  maxTiltDeg: 50,
  minInstances: 200,
};

function check(o: FrameRunOptions, rmsMaxPx: number, maxPx?: number): void {
  const r = runFrames(o);
  const e = rms(r.errsPx);
  const max = Math.max(...r.errsPx);
  const msg = `seed ${o.seed}: ${r.found}/${r.instances} found, rms ${e.toFixed(3)} px, max ${max.toFixed(3)} px`;
  expect(r.instances, msg).toBeGreaterThanOrEqual(o.minInstances);
  expect(r.misses, msg).toEqual([]);
  expect(r.wrong, msg).toEqual([]);
  expect(e, msg).toBeLessThanOrEqual(rmsMaxPx);
  if (maxPx !== undefined) expect(max, msg).toBeLessThanOrEqual(maxPx);
}

// heavy seeded renders: when the whole suite runs in parallel they can land on efficiency cores
describe('detector corner accuracy (D2)', { timeout: 120_000 }, () => {
  it('clean renders: RMS ≤ 0.1 px, max ≤ 0.25 px', () => {
    // the headline number: full 8 × 8 supersampling for the ground truth
    check({ ...BASE, seed: 201, blurSigmaPx: 0.8, noiseSigma: 0, supersample: 8 }, 0.1, 0.25);
  });

  it('noise 3 DN + blur 1.2 px: RMS ≤ 0.3 px', () => {
    check({ ...BASE, seed: 202, blurSigmaPx: 1.2, noiseSigma: 3 }, 0.3);
  });

  it('decimate 2 refines on the full image just as well (clean)', () => {
    check(
      {
        ...BASE,
        seed: 203,
        blurSigmaPx: 0.8,
        noiseSigma: 0,
        decimate: 2,
        minCellPx: 6,
        distanceMm: [180, 280],
      },
      0.1,
      0.25,
    );
  });

  it('linear-light frames with edgeGamma 1 (the LUT is the only gamma assumption)', () => {
    check(
      { ...BASE, seed: 204, blurSigmaPx: 0.8, noiseSigma: 0, gamma: 1, edgeGamma: 1 },
      0.1,
      0.25,
    );
  });

  it('without linearisation (edgeGamma 1 on gamma-2.2 frames) corners are biased ≈ 0.7 px', () => {
    // Documents why the LUT exists (TASKS.md D2): measured RMS ≈ 0.7 px.
    const r = runFrames({ ...BASE, seed: 205, blurSigmaPx: 0.8, noiseSigma: 0, edgeGamma: 1 });
    const e = rms(r.errsPx);
    expect(r.instances).toBeGreaterThanOrEqual(200);
    expect(e, `seed 205: rms ${e.toFixed(3)} px`).toBeGreaterThan(0.5);
    expect(e, `seed 205: rms ${e.toFixed(3)} px`).toBeLessThan(0.9);
  });
});
