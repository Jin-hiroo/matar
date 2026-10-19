/**
 * Pose filter (TASKS.md P5) at 30 fps with the default parameters.
 */
import { describe, expect, it } from 'vitest';
import {
  mat3Mul,
  mat4FromRotationTranslation,
  mat4GetRotation,
  maxAbsDiff,
  rotationAngleBetween,
  rotationFromAxisAngle,
} from '../../src/math/index.js';
import { createPoseFilter } from '../../src/pose/index.js';
import { intrinsicsFromFov, lookAtPose } from '../../src/synth/camera.js';
import { mulberry32, normalSampler } from '../../src/synth/random.js';
import type { Mat4, Vec3 } from '../../src/types.js';
import { DEG, fmt, overlayErrorMm, quantile, rms } from './pose-helpers.js';

const FPS = 30;
const DT_MS = 1000 / FPS;
const K = intrinsicsFromFov(1280, 720, 65);
const BASE = lookAtPose([50, 350, 200], [0, 0, 0]);

function translated(m: Mat4, d: Vec3): Mat4 {
  const out = Float64Array.from(m);
  out[12] = out[12]! + d[0];
  out[13] = out[13]! + d[1];
  out[14] = out[14]! + d[2];
  return out;
}

function rotated(m: Mat4, w: Vec3): Mat4 {
  return mat4FromRotationTranslation(mat3Mul(mat4GetRotation(m), rotationFromAxisAngle(w)), [
    m[12]!,
    m[13]!,
    m[14]!,
  ]);
}

function posErr(a: Mat4, b: Mat4): number {
  return Math.hypot(a[12]! - b[12]!, a[13]! - b[13]!, a[14]! - b[14]!);
}

function rotErrDeg(a: Mat4, b: Mat4): number {
  return rotationAngleBetween(mat4GetRotation(a), mat4GetRotation(b)) / DEG;
}

describe('P5 pose filter (defaults, 30 fps)', () => {
  it('static pose, noise 1 mm / 0.2° RMS (3D) → output RMS ≤ 0.55 mm / 0.10°', () => {
    const seed = 505;
    const g = normalSampler(mulberry32(seed));
    const sPos = 1 / Math.sqrt(3); // per axis, so the 3D RMS is 1 mm
    const sRot = (0.2 * DEG) / Math.sqrt(3);
    const outPos: number[] = [];
    const outRot: number[] = [];
    const inPos: number[] = [];
    const inRot: number[] = [];
    const runs = 10;
    const frames = 30 * FPS;
    for (let run = 0; run < runs; run++) {
      const f = createPoseFilter();
      for (let i = 0; i < frames; i++) {
        const raw = rotated(translated(BASE, [sPos * g(), sPos * g(), sPos * g()]), [
          sRot * g(),
          sRot * g(),
          sRot * g(),
        ]);
        const out = f.update(raw, 1000 + i * DT_MS)!;
        if (i < FPS) continue; // settle for 1 s
        inPos.push(posErr(raw, BASE));
        inRot.push(rotErrDeg(raw, BASE));
        outPos.push(posErr(out, BASE));
        outRot.push(rotErrDeg(out, BASE));
      }
    }
    const r = { inPos: rms(inPos), inRot: rms(inRot), pos: rms(outPos), rot: rms(outRot) };
    console.log(
      `P5 static (seed ${seed}, ${outPos.length} frames): input ${fmt(r.inPos)} mm / ${fmt(r.inRot)}° → ` +
        `output ${fmt(r.pos)} mm / ${fmt(r.rot)}° RMS`,
    );
    expect(r.inPos).toBeCloseTo(1, 1);
    expect(r.inRot).toBeCloseTo(0.2, 2);
    expect(r.pos, `seed ${seed}`).toBeLessThanOrEqual(0.55);
    expect(r.rot, `seed ${seed}`).toBeLessThanOrEqual(0.1);
  });

  it('orbiting the board at 30°/s at 400 mm: content at the origin slides ≤ 0.3 mm', () => {
    const results: string[] = [];
    let worst = 0;
    for (const tiltDeg of [20, 40, 60]) {
      const f = createPoseFilter();
      const slide: number[] = [];
      const tilt = tiltDeg * DEG;
      for (let i = 0; i < 6 * FPS; i++) {
        const az = 30 * DEG * (i / FPS);
        const eye: Vec3 = [
          400 * Math.sin(tilt) * Math.cos(az),
          400 * Math.cos(tilt),
          400 * Math.sin(tilt) * Math.sin(az),
        ];
        const truth = lookAtPose(eye, [0, 0, 0]);
        const out = f.update(truth, i * DT_MS)!;
        if (i < 2 * FPS) continue;
        slide.push(overlayErrorMm(K, out, truth, [0, 0, 0]));
      }
      const m = quantile(slide, 1);
      worst = Math.max(worst, m);
      results.push(`tilt ${tiltDeg}°: max ${fmt(m)} mm`);
    }
    console.log(`P5 orbit 30°/s at 400 mm, slide of the origin: ${results.join(', ')}`);
    expect(worst).toBeLessThanOrEqual(0.3);
  });

  it('constant 100 mm/s motion → steady lag ≤ 20 ms', () => {
    const f = createPoseFilter();
    const dir: Vec3 = [0.6, 0, 0.8];
    const lags: number[] = [];
    for (let i = 0; i < 5 * FPS; i++) {
      const s = 100 * (i / FPS); // mm along dir
      const truth = translated(BASE, [dir[0] * s, dir[1] * s, dir[2] * s]);
      const out = f.update(truth, i * DT_MS)!;
      if (i < 3 * FPS) continue;
      const behind = (truth[12]! - out[12]!) * dir[0] + (truth[14]! - out[14]!) * dir[2];
      lags.push((behind / 100) * 1000); // ms
    }
    const lag = quantile(lags, 1);
    console.log(
      `P5 steady lag at 100 mm/s: ${fmt(lag, 2)} ms (${fmt((lag / 1000) * 100, 2)} mm behind)`,
    );
    expect(Math.max(...lags) - Math.min(...lags)).toBeLessThan(0.1); // steady
    expect(lag).toBeLessThanOrEqual(20);
    expect(lag).toBeGreaterThan(0);
  });

  it('ignores a 30 mm one-frame spike', () => {
    const f = createPoseFilter();
    let last: Mat4 | null = null;
    for (let i = 0; i < 60; i++) {
      const raw = i === 30 ? translated(BASE, [30, 0, 0]) : BASE;
      const out = f.update(raw, i * DT_MS)!;
      if (i === 30) expect(maxAbsDiff(out, last!)).toBe(0); // held
      expect(maxAbsDiff(out, BASE)).toBeLessThan(1e-12);
      last = out;
    }
    // a 10° one-frame rotation spike as well
    const g = createPoseFilter();
    for (let i = 0; i < 60; i++) {
      const out = g.update(i === 30 ? rotated(BASE, [0, 10 * DEG, 0]) : BASE, i * DT_MS)!;
      expect(maxAbsDiff(out, BASE)).toBeLessThan(1e-12);
    }
  });

  it('takes a persisting jump after 3 frames', () => {
    for (const jump of [translated(BASE, [0, 0, 50]), rotated(BASE, [8 * DEG, 0, 0])]) {
      const f = createPoseFilter();
      for (let i = 0; i < 30; i++) f.update(BASE, i * DT_MS);
      expect(maxAbsDiff(f.update(jump, 30 * DT_MS)!, BASE)).toBeLessThan(1e-12);
      expect(maxAbsDiff(f.update(jump, 31 * DT_MS)!, BASE)).toBeLessThan(1e-12);
      expect(maxAbsDiff(f.update(jump, 32 * DT_MS)!, jump)).toBeLessThan(1e-12);
      // and then filters normally from there
      expect(maxAbsDiff(f.update(jump, 33 * DT_MS)!, jump)).toBeLessThan(1e-12);
    }
    // two jump frames then back: never taken
    const f = createPoseFilter();
    for (let i = 0; i < 30; i++) f.update(BASE, i * DT_MS);
    const away = translated(BASE, [40, 0, 0]);
    f.update(away, 30 * DT_MS);
    f.update(away, 31 * DT_MS);
    f.update(BASE, 32 * DT_MS);
    expect(maxAbsDiff(f.update(away, 33 * DT_MS)!, BASE)).toBeLessThan(1e-12);
  });

  it('update(null) holds the last output until lostAfterMs, then returns null and resets', () => {
    const f = createPoseFilter();
    let last: Mat4 | null = null;
    for (let i = 0; i < 30; i++) last = f.update(translated(BASE, [i, 0, 0]), i * DT_MS);
    const t0 = 29 * DT_MS;
    expect(f.update(null, t0 + 100)).toEqual(last);
    expect(f.update(null, t0 + 300)).toEqual(last);
    expect(f.update(null, t0 + 301)).toBeNull();
    expect(f.update(null, t0 + 400)).toBeNull();
    // after a loss the next pose is taken as is (no smoothing, no jump gate)
    const far = translated(BASE, [200, 0, 0]);
    expect(maxAbsDiff(f.update(far, t0 + 500)!, far)).toBeLessThan(1e-12);
    // custom lostAfterMs; reset() forgets the state
    const g = createPoseFilter({ lostAfterMs: 50 });
    g.update(BASE, 0);
    expect(g.update(null, 50)).not.toBeNull();
    expect(g.update(null, 51)).toBeNull();
    g.update(BASE, 100);
    g.reset();
    expect(g.update(null, 110)).toBeNull();
    expect(maxAbsDiff(g.update(far, 120)!, far)).toBeLessThan(1e-12);
  });

  it('passes the first pose through and returns fresh matrices', () => {
    const f = createPoseFilter();
    const a = f.update(BASE, 0)!;
    expect(maxAbsDiff(a, BASE)).toBeLessThan(1e-12);
    const b = f.update(BASE, DT_MS)!;
    expect(b).not.toBe(a);
    // a repeated timestamp changes nothing
    expect(maxAbsDiff(f.update(translated(BASE, [5, 0, 0]), DT_MS)!, b)).toBe(0);
  });
});
