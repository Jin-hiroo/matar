/**
 * Refits the `corners` line of a demo report (demo/report.ts): one frame's
 * detected tag corners on the demo board, to tell apart why the corners don't
 * fit a flat board (a high `homography fit` in the `calib` line) on a device.
 *
 *   pnpm exec tsx scripts/refit-corners.ts < report.txt
 *   pnpm exec tsx scripts/refit-corners.ts report.txt
 *
 * Each cause leaves its own mark (synthetic checks, DEVICE-TESTS.md 2026-10-24):
 * - lens distortion: one radial term about the image centre takes most of it out;
 * - a bent or folded sheet: each half of the board fits much better alone;
 * - edges placed off by the camera's processing (blur with a tone curve the
 *   detector's `edgeGamma` doesn't match, sharpening): every tag looks bigger
 *   (or smaller) than the board says by about the same amount;
 * - random corner error: none of these helps.
 * The table lists each used tag's residuals against the homography fit.
 */
import { readFileSync } from 'node:fs';
import { boardTagCornersMm } from '../src/board/index.js';
import { homographyDlt } from '../src/math/homography.js';
import type { Vec2 } from '../src/types.js';
import { demoBoard } from '../demo/board.js';

interface Tag {
  id: number;
  used: boolean;
  /** detected corners, image px (TL, TR, BR, BL) */
  img: Vec2[];
  /** printed corners, board [x, z] mm */
  board: Vec2[];
}

interface Fit {
  rmsPx: number;
  /** per corner: detected (after the radial correction) − fitted, px */
  res: Vec2[];
}

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : readFileSync(0, 'utf8');
const line = /corners {2}(.*)/.exec(text)?.[1];
if (!line) throw new Error('no `corners` line in the input');
const head = /(\d+)×(\d+) fx [\d.]+ fy [\d.]+ cx ([\d.]+) cy ([\d.]+)/.exec(line);
if (!head) throw new Error('no frame size and intrinsics in the `corners` line');
const [w, h, cx, cy] = head.slice(1).map(Number) as [number, number, number, number];
const longPx = Math.max(w, h);

const printed = new Map(demoBoard().tags.map((t) => [t.id, boardTagCornersMm(t)]));
const tags: Tag[] = [];
for (const part of line.split(' · ').slice(1)) {
  const m = /^(\d+)(\*?): (.*)$/.exec(part);
  if (!m) continue;
  const id = Number(m[1]);
  const board = printed.get(id);
  if (!board) {
    console.log(`tag ${id} is not on the demo board`);
    continue;
  }
  const img = m[3]!.split(' ').map((p) => p.split(',').map(Number)); // `!`: group 3 matched
  if (img.length !== 4 || img.some((p) => p.length !== 2 || !p.every(Number.isFinite))) {
    console.log(`tag ${id}: not 4 corners "u,v"; skipped`);
    continue;
  }
  tags.push({ id, used: m[2] !== '*', img: img as Vec2[], board });
}
const used = tags.filter((t) => t.used);
if (used.length < 2) throw new Error('fewer than 2 used tags');

/**
 * Homography fit of `ts`, after moving each detected corner radially about the
 * image centre by (1 + k1 r²), r in units of the long side.
 */
function fit(ts: Tag[], k1 = 0): Fit {
  const src: number[] = [];
  const dst: number[] = [];
  for (const t of ts) {
    for (let c = 0; c < 4; c++) {
      const [u, v] = t.img[c]!; // `!`: 4 corners
      const x = (u - cx) / longPx;
      const y = (v - cy) / longPx;
      const s = 1 + k1 * (x * x + y * y);
      src.push(...t.board[c]!);
      dst.push(cx + x * s * longPx, cy + y * s * longPx);
    }
  }
  const n = src.length / 2;
  const hm = homographyDlt(src, dst, n);
  if (!hm) return { rmsPx: Infinity, res: [] };
  const res: Vec2[] = [];
  let e2 = 0;
  // `!` below: i < n, and a Mat3 has 9 entries
  for (let i = 0; i < n; i++) {
    const X = src[2 * i]!;
    const Z = src[2 * i + 1]!;
    const d = hm[6]! * X + hm[7]! * Z + hm[8]!;
    const du = dst[2 * i]! - (hm[0]! * X + hm[1]! * Z + hm[2]!) / d;
    const dv = dst[2 * i + 1]! - (hm[3]! * X + hm[4]! * Z + hm[5]!) / d;
    res.push([du, dv]);
    e2 += du * du + dv * dv;
  }
  return { rmsPx: Math.sqrt(e2 / n), res };
}

/** Golden-section minimum of `f` on [a, b]. */
function minimise(f: (x: number) => number, a: number, b: number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 60; i++) {
    if (fc < fd) {
      [b, d, fd] = [d, c, fc];
      c = b - g * (b - a);
      fc = f(c);
    } else {
      [a, c, fc] = [c, d, fd];
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

const mean = (ps: Vec2[]): Vec2 => [
  ps.reduce((s, p) => s + p[0], 0) / ps.length,
  ps.reduce((s, p) => s + p[1], 0) / ps.length,
];
const centre = (t: Tag) => mean(t.board);

const all = fit(used);
if (!Number.isFinite(all.rmsPx)) throw new Error('no homography fits these corners');
const k1 = minimise((k) => fit(used, k).rmsPx, -1, 1);
const radial = fit(used, k1);
// the shift k1 means at the image corner (r = half-diagonal)
const rc = Math.hypot(w, h) / 2 / longPx;
const halves = (inA: (t: Tag) => boolean) => {
  const one = (ts: Tag[]) => (ts.length >= 2 ? fit(ts).rmsPx.toFixed(2) : '-');
  return `${one(used.filter(inA))} / ${one(used.filter((t) => !inA(t)))}`;
};

// per tag: its residuals less their mean, along fitted centre → corner
// (+ = the tag looks bigger than printed), and what is left without that
let left2 = 0;
const perTag = used.map((t, i) => {
  const res = all.res.slice(4 * i, 4 * i + 4);
  const shift = mean(res);
  const fitted = t.img.map((p, c): Vec2 => [p[0] - res[c]![0], p[1] - res[c]![1]]); // `!`: 4 each
  const g = mean(fitted);
  const out = fitted.map((p): Vec2 => {
    const n = Math.hypot(p[0] - g[0], p[1] - g[1]);
    return [(p[0] - g[0]) / n, (p[1] - g[1]) / n];
  });
  const expansionPx =
    res.reduce(
      (s, r, c) => s + (r[0] - shift[0]) * out[c]![0] + (r[1] - shift[1]) * out[c]![1],
      0,
    ) / 4; // `!`: 4 each
  res.forEach((r, c) => {
    left2 += (r[0] - expansionPx * out[c]![0]) ** 2 + (r[1] - expansionPx * out[c]![1]) ** 2; // `!`: 4 each
  });
  const rmsPx = Math.sqrt(res.reduce((s, r) => s + r[0] ** 2 + r[1] ** 2, 0) / 4);
  const at = mean(t.img);
  const r = Math.hypot(at[0] - cx, at[1] - cy);
  const radialPx = r > 0 ? (shift[0] * (at[0] - cx) + shift[1] * (at[1] - cy)) / r : 0;
  return { t, rmsPx, shift, at, radialPx, expansionPx };
});
const exp = perTag.map((p) => p.expansionPx).sort((a, b) => a - b);

console.log(`${used.length} used tags (${tags.length} found), ${w}×${h}`);
console.log(`homography fit                   ${all.rmsPx.toFixed(2)} px`);
console.log(
  `with a radial term (k1 ${k1.toFixed(3)})   ${radial.rmsPx.toFixed(2)} px  (${(k1 * rc * rc * 100).toFixed(1)} % at the image corner, ${(k1 * rc ** 3 * longPx).toFixed(1)} px)`,
);
console.log(`halves alone: left / right       ${halves((t) => centre(t)[0] < 0)} px (board x)`);
console.log(`halves alone: top / bottom       ${halves((t) => centre(t)[1] < 0)} px (board z)`);
console.log(
  `tag expansion                    median ${exp[exp.length >> 1]!.toFixed(2)} px (${exp[0]!.toFixed(2)} to ${exp.at(-1)!.toFixed(2)}), ${exp.filter((e) => e > 0).length} of ${exp.length} bigger; fit without it ${Math.sqrt(left2 / all.res.length).toFixed(2)} px`, // `!`: ≥ 2 tags
);
console.log(
  'per tag: id  board x, z mm  image u, v px  rms  mean shift du, dv  radial  expansion (px)',
);
for (const p of perTag) {
  const [bx, bz] = centre(p.t);
  console.log(
    `  ${String(p.t.id).padStart(3)}  ${bx.toFixed(0).padStart(5)}, ${bz.toFixed(0).padStart(4)}  ${p.at[0].toFixed(0).padStart(5)}, ${p.at[1].toFixed(0).padStart(4)}  ${p.rmsPx.toFixed(2)}  ${p.shift[0].toFixed(2).padStart(6)}, ${p.shift[1].toFixed(2).padStart(5)}  ${p.radialPx.toFixed(2).padStart(6)}  ${p.expansionPx.toFixed(2).padStart(6)}`,
  );
}
