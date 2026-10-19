import { describe, expect, it } from 'vitest';
import { tagCells } from '../tags/index.js';
import type { Board, BoardTag, Vec2 } from '../types.js';
import { createBoard } from './board.js';
import { pickTagIds } from './ids.js';
import { layoutBorderTags, type RectMm } from './layout.js';
import { mulberry32 } from './random.js';
import { boardSvg, escapeXml, fmtMm, tagSvg } from './svg.js';

// ---------------------------------------------------------------------------
// A tiny SVG reader for the round trip (no dependencies)

/** Checks that elements nest properly; returns the element names in order. */
function checkWellFormed(svg: string): string[] {
  const stack: string[] = [];
  const names: string[] = [];
  for (const m of svg.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    const [, close, name, , selfClose] = m as unknown as [string, string, string, string, string];
    if (close) expect(stack.pop()).toBe(name);
    else {
      names.push(name);
      if (!selfClose) stack.push(name);
    }
  }
  expect(stack).toEqual([]);
  // nothing but escaped text between tags
  expect(svg.replace(/<[^>]*>/g, '')).not.toMatch(/[<>]|&(?!amp;|lt;|gt;|quot;|#\d+;)/);
  return names;
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  if (!m) throw new Error(`no ${name} in ${tag}`);
  return m[1] as string;
}

/** Axis-aligned rectangles of a path made of `M x y H x V y H x Z` subpaths. */
function pathRects(d: string): RectMm[] {
  const tokens = d.match(/[MHVZ]|-?\d*\.?\d+/g) ?? [];
  const rects: RectMm[] = [];
  let pts: Vec2[] = [];
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    const last = pts[pts.length - 1];
    if (cmd === 'M') pts = [[num(), num()]];
    else if (cmd === 'H') pts.push([num(), last![1]]);
    else if (cmd === 'V') pts.push([last![0], num()]);
    else if (cmd === 'Z') {
      expect(pts).toHaveLength(4);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      // a closed axis-aligned rectangle: two distinct xs and ys
      expect(new Set(xs).size).toBe(2);
      expect(new Set(ys).size).toBe(2);
      rects.push({ x: x0, y: y0, width: Math.max(...xs) - x0, height: Math.max(...ys) - y0 });
    } else throw new Error(`unexpected path token ${cmd}`);
  }
  return rects;
}

/** Black square bounds and its cell grid (1 = white) recovered from black rectangles. */
function readTag(d: string, n = 8): { box: RectMm; cells: Uint8Array } {
  const rects = pathRects(d);
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  const cw = (x1 - x0) / n;
  const ch = (y1 - y0) / n;
  const cells = new Uint8Array(n * n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const px = x0 + (c + 0.5) * cw;
      const py = y0 + (r + 0.5) * ch;
      const black = rects.filter(
        (q) => px > q.x && px < q.x + q.width && py > q.y && py < q.y + q.height,
      ).length;
      expect(black).toBeLessThanOrEqual(1); // rectangles don't overlap
      cells[r * n + c] = black ? 0 : 1;
    }
  }
  return { box: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, cells };
}

interface ParsedTag {
  id: number;
  rotationDeg: number;
  center: Vec2;
  ring: RectMm;
  box: RectMm;
  cells: Uint8Array;
}

function readBoardTags(svg: string): ParsedTag[] {
  const re =
    /<g id="tag-(\d+)" transform="rotate\(([^ )]+) ([^ )]+) ([^ )]+)\)">(<rect [^>]*\/>)<path fill="#000" d="([^"]+)"\/><\/g>/g;
  return [...svg.matchAll(re)].map((m) => {
    const rect = m[5] as string;
    const { box, cells } = readTag(m[6] as string);
    return {
      id: Number(m[1]),
      rotationDeg: Number(m[2]),
      center: [Number(m[3]), Number(m[4])],
      ring: {
        x: Number(attr(rect, 'x')),
        y: Number(attr(rect, 'y')),
        width: Number(attr(rect, 'width')),
        height: Number(attr(rect, 'height')),
      },
      box,
      cells,
    };
  });
}

const intersects = (a: RectMm, b: RectMm) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Rotated footprint bounding box of a board tag on the page. */
function footprintBox(t: BoardTag, origin: Vec2): RectMm {
  const th = (t.rotationDeg * Math.PI) / 180;
  const r = ((t.sizeMm * 10) / 16) * (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)));
  const cx = t.centerMm[0] + origin[0];
  const cy = t.centerMm[1] + origin[1];
  return { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r };
}

// ---------------------------------------------------------------------------

describe('fmtMm / escapeXml', () => {
  it('writes up to 6 decimals without trailing zeros', () => {
    expect(fmtMm(4)).toBe('4');
    expect(fmtMm(2.5)).toBe('2.5');
    expect(fmtMm(100 / 3)).toBe('33.333333');
    expect(fmtMm(0.1 + 0.2)).toBe('0.3');
    expect(fmtMm(1e-7)).toBe('0');
    expect(fmtMm(-1e-7)).toBe('0');
    expect(fmtMm(0.000004)).toBe('0.000004');
    expect(fmtMm(-12.3456789)).toBe('-12.345679');
    expect(() => fmtMm(NaN)).toThrow();
  });

  it('escapes XML specials', () => {
    expect(escapeXml(`a & b < c > d "e" 'f'`)).toBe(
      'a &amp; b &lt; c &gt; d &quot;e&quot; &#39;f&#39;',
    );
  });
});

describe('tagSvg', () => {
  it('is an <svg> in mm with a matching viewBox and crisp edges', () => {
    const svg = tagSvg('tag36h11', 0, { sizeMm: 32 });
    checkWellFormed(svg);
    const root = /^<svg [^>]*>/.exec(svg)![0];
    expect(attr(root, 'xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(attr(root, 'width')).toBe('40mm');
    expect(attr(root, 'height')).toBe('40mm');
    expect(attr(root, 'viewBox')).toBe('0 0 40 40');
    expect(attr(root, 'shape-rendering')).toBe('crispEdges');
    expect(svg.endsWith('</svg>')).toBe(true);
    // one path holds all black cells
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it('round-trips the exact cells and the black square, with and without the ring', () => {
    const rng = mulberry32(7);
    const ids = [0, 1, 42, 586, ...Array.from({ length: 40 }, () => Math.floor(rng() * 587))];
    for (const sizeMm of [32, 20, 33.3, 100 / 3, 7]) {
      for (const id of ids) {
        for (const quietZone of [true, false]) {
          const svg = tagSvg('tag36h11', id, { sizeMm, quietZone });
          const d = /<path fill="#000" d="([^"]+)"/.exec(svg)![1]!;
          const { box, cells } = readTag(d);
          expect(cells).toEqual(tagCells('tag36h11', id));
          const q = quietZone ? sizeMm / 8 : 0;
          expect(Math.abs(box.x - q)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(box.y - q)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(box.width - sizeMm)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(box.height - sizeMm)).toBeLessThanOrEqual(1e-6);
          const root = /^<svg [^>]*>/.exec(svg)![0];
          expect(attr(root, 'width')).toBe(`${fmtMm(sizeMm + 2 * q)}mm`);
          // the white background covers the ring (or the square)
          const bg = /<rect [^>]*>/.exec(svg)![0];
          expect(Number(attr(bg, 'width'))).toBeCloseTo(sizeMm + 2 * q, 6);
        }
      }
    }
  });

  it('stays under 2 KB for every ID, even with a label and awkward sizes', () => {
    let max = 0;
    for (let id = 0; id < 587; id++) {
      for (const sizeMm of [32, 100 / 3, 7.777777]) {
        max = Math.max(max, tagSvg('tag36h11', id, { sizeMm, label: true }).length);
      }
    }
    expect(max).toBeLessThan(2048);
  });

  it('merges cells into few rectangles', () => {
    let total = 0;
    for (let id = 0; id < 587; id++) {
      const d = /d="([^"]+)"/.exec(tagSvg('tag36h11', id, { sizeMm: 32 }))![1]!;
      total += pathRects(d).length;
    }
    // 64 cells, ≥ 28 of them black (border); runs merge them into ≈ 15 rectangles
    expect(total / 587).toBeLessThan(20);
  });

  it('adds a label below the tag', () => {
    const svg = tagSvg('tag36h11', 42, { sizeMm: 32, label: true });
    checkWellFormed(svg);
    expect(svg).toContain('>tag36h11 #42</text>');
    const root = /^<svg [^>]*>/.exec(svg)![0];
    const h = Number(attr(root, 'height').replace('mm', ''));
    expect(h).toBeGreaterThan(40);
    expect(attr(root, 'viewBox')).toBe(`0 0 40 ${fmtMm(h)}`);
  });

  it('rejects bad input', () => {
    expect(() => tagSvg('tag36h11', 0, { sizeMm: 0 })).toThrow(/sizeMm/);
    expect(() => tagSvg('tag36h11', 587, { sizeMm: 10 })).toThrow(/587/);
    expect(() => tagSvg('nope', 0, { sizeMm: 10 })).toThrow(/nope/);
  });
});

describe('boardSvg', () => {
  const A4: Vec2 = [210, 297];
  const origin: Vec2 = [105, 148.5];
  const ids = pickTagIds('tag36h11', 40, 'svg-test');
  const board = createBoard({
    tags: layoutBorderTags({
      areaMm: { x: 0, y: 0, width: 210, height: 297 },
      originMm: origin,
      sizeMm: 32,
      ids,
    }),
  });
  const svg = boardSvg(board, { pageMm: A4, originMm: origin, title: 'Board <1> & "two"' });

  it('is a well-formed page in mm', () => {
    const names = checkWellFormed(svg);
    expect(names[0]).toBe('svg');
    const root = /^<svg [^>]*>/.exec(svg)![0];
    expect(attr(root, 'width')).toBe('210mm');
    expect(attr(root, 'height')).toBe('297mm');
    expect(attr(root, 'viewBox')).toBe('0 0 210 297');
    expect(svg).toContain('<g id="tags" shape-rendering="crispEdges">');
    expect(svg).toContain('>Print at 100 % (Actual size)</text>');
  });

  it('round-trips every tag: ID, exact cells, position (1e-6 mm), size and ring', () => {
    const parsed = readBoardTags(svg);
    expect(parsed.map((p) => p.id)).toEqual(board.tags.map((t) => t.id));
    parsed.forEach((p, i) => {
      const t = board.tags[i]!;
      const cx = t.centerMm[0] + origin[0];
      const cy = t.centerMm[1] + origin[1];
      expect(p.cells).toEqual(tagCells('tag36h11', t.id));
      expect(p.rotationDeg).toBe(0);
      expect(Math.abs(p.center[0] - cx)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.center[1] - cy)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.x + p.box.width / 2 - cx)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.y + p.box.height / 2 - cy)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.width - 32)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.height - 32)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.ring.x + 20 - cx)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.ring.width - 40)).toBeLessThanOrEqual(1e-6);
    });
  });

  it('round-trips rotated tags of different sizes', () => {
    const rotated: Board = createBoard({
      tags: [
        { id: 5, centerMm: [-50, -60], sizeMm: 30, rotationDeg: 30 },
        { id: 77, centerMm: [40, -60], sizeMm: 25.4, rotationDeg: 90 },
        { id: 300, centerMm: [-50, 60], sizeMm: 20, rotationDeg: -45 },
        { id: 586, centerMm: [45.123456789, 70.987654321], sizeMm: 33.3, rotationDeg: 200.5 },
      ],
    });
    const out = boardSvg(rotated, { pageMm: A4, originMm: origin, rulerMm: 0, cardOutline: false });
    checkWellFormed(out);
    const parsed = readBoardTags(out);
    expect(parsed).toHaveLength(4);
    parsed.forEach((p, i) => {
      const t = rotated.tags[i]!;
      const cx = t.centerMm[0] + origin[0];
      const cy = t.centerMm[1] + origin[1];
      expect(p.id).toBe(t.id);
      expect(p.rotationDeg).toBeCloseTo(t.rotationDeg, 9);
      expect(p.cells).toEqual(tagCells('tag36h11', t.id));
      // the tag is drawn unrotated around (cx, cy), then rotated about it
      expect(Math.abs(p.center[0] - cx)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.center[1] - cy)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.x + p.box.width / 2 - cx)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.y + p.box.height / 2 - cy)).toBeLessThanOrEqual(1e-6);
      expect(Math.abs(p.box.width - t.sizeMm)).toBeLessThanOrEqual(1e-6);
    });
  });

  it('draws a ruler exactly rulerMm long with ticks every 10 mm', () => {
    for (const rulerMm of [100, 105, 75, 33.3]) {
      const out = boardSvg(board, { pageMm: A4, originMm: origin, rulerMm, cardOutline: false });
      const ruler = /<path id="ruler" d="M([^ ]+) ([^H]+)H([^"]+)"/.exec(out)!;
      const x0 = Number(ruler[1]);
      expect(Math.abs(Number(ruler[3]) - x0 - rulerMm)).toBeLessThanOrEqual(1e-9);
      const ticksD = /<path id="ruler"[^>]*\/><path d="([^"]+)"/.exec(out)![1]!;
      const ticks = [...ticksD.matchAll(/M([^ ]+) /g)].map((m) => Number(m[1]) - x0);
      const expected = Array.from({ length: Math.floor(rulerMm / 10) + 1 }, (_, k) => 10 * k);
      if (rulerMm % 10 !== 0) expected.push(rulerMm);
      expect(ticks.length).toBe(expected.length);
      ticks.forEach((t, k) => expect(Math.abs(t - expected[k]!)).toBeLessThanOrEqual(1e-6));
      expect(out).toContain(`>${fmtMm(rulerMm)} mm</text>`);
    }
  });

  it('draws the ID-1 card outline and the origin cross', () => {
    const card = /<rect id="card" [^>]*>/.exec(svg)![0];
    expect(attr(card, 'width')).toBe('85.6');
    expect(attr(card, 'height')).toBe('53.98');
    expect(attr(card, 'rx')).toBe('3.18');
    expect(svg).toContain('<path id="origin" d="M100 148.5H110M105 143.5V153.5"');
  });

  it('puts the print check bottom-centre inside the ring, clear of every tag', () => {
    const card = /<rect id="card" [^>]*>/.exec(svg)![0];
    const cardBox: RectMm = {
      x: Number(attr(card, 'x')),
      y: Number(attr(card, 'y')),
      width: 85.6,
      height: 53.98,
    };
    const ruler = /<path id="ruler" d="M([^ ]+) ([^H]+)H([^"]+)"/.exec(svg)!;
    const rulerBox: RectMm = {
      x: Number(ruler[1]),
      y: Number(ruler[2]) - 4,
      width: 100,
      height: 4,
    };
    expect(cardBox.x + cardBox.width / 2).toBeCloseTo(105, 6);
    // just above the bottom row of footprints (top edge at 249 mm)
    expect(cardBox.y + cardBox.height).toBeLessThan(249 - 3);
    expect(cardBox.y + cardBox.height).toBeGreaterThan(249 - 10);
    for (const t of board.tags) {
      const f = footprintBox(t, origin);
      expect(intersects(f, cardBox)).toBe(false);
      expect(intersects(f, rulerBox)).toBe(false);
    }
    // texts sit between the ring's inner edges (48…162 mm)
    for (const m of svg.matchAll(/<text x="([^"]+)" y="([^"]+)"/g)) {
      expect(Number(m[2])).toBeGreaterThan(48);
      expect(Number(m[2])).toBeLessThan(249);
    }
  });

  it('avoids keep-outs and skips the ruler/card on request', () => {
    const keepOutMm = [{ x: 50, y: 150, width: 110, height: 95 }];
    const out = boardSvg(board, { pageMm: A4, originMm: origin, keepOutMm });
    const card = /<rect id="card" [^>]*>/.exec(out)![0];
    const box = {
      x: Number(attr(card, 'x')),
      y: Number(attr(card, 'y')),
      width: 85.6,
      height: 53.98,
    };
    expect(intersects(box, keepOutMm[0]!)).toBe(false);
    const plain = boardSvg(board, { pageMm: A4, originMm: origin, rulerMm: 0, cardOutline: false });
    expect(plain).not.toContain('id="ruler"');
    expect(plain).not.toContain('id="card"');
    expect(plain).toContain('>Print at 100 % (Actual size)</text>');
  });

  it('throws when the print check cannot fit, and fits once it is reduced', () => {
    // keep-out fills the page down to 230 mm, leaving a 13 mm strip above the bottom row
    const keepOutMm = [{ x: 0, y: 0, width: 210, height: 230 }];
    expect(() => boardSvg(board, { pageMm: A4, originMm: origin, keepOutMm })).toThrow(
      /no room.*rulerMm: 0.*cardOutline: false/,
    );
    expect(() =>
      boardSvg(board, {
        pageMm: A4,
        originMm: origin,
        keepOutMm,
        rulerMm: 0,
        cardOutline: false,
      }),
    ).not.toThrow();
  });

  it('escapes the title', () => {
    expect(svg).toContain('<title>Board &lt;1&gt; &amp; &quot;two&quot;</title>');
    expect(svg).toContain('>Board &lt;1&gt; &amp; &quot;two&quot;</text>');
    expect(svg).not.toContain('<1>');
  });

  it('leaves out tags that are not on this page (tiled boards)', () => {
    const tiled = createBoard({
      tags: [
        { id: 1, centerMm: [0, 0], sizeMm: 32, rotationDeg: 0 },
        { id: 2, centerMm: [300, 0], sizeMm: 32, rotationDeg: 0 },
      ],
    });
    const page1 = boardSvg(tiled, { pageMm: A4, originMm: origin });
    const page2 = boardSvg(tiled, { pageMm: A4, originMm: [origin[0] - 300, origin[1]] });
    expect(readBoardTags(page1).map((p) => p.id)).toEqual([1]);
    expect(readBoardTags(page2).map((p) => p.id)).toEqual([2]);
    expect(readBoardTags(page2)[0]!.center).toEqual([105, 148.5]);
  });

  it('is deterministic and rejects bad options', () => {
    expect(boardSvg(board, { pageMm: A4, originMm: origin, title: 'Board <1> & "two"' })).toBe(svg);
    expect(() => boardSvg(board, { pageMm: [0, 297], originMm: origin })).toThrow(/pageMm/);
    expect(() => boardSvg(board, { pageMm: A4, originMm: [NaN, 0] })).toThrow(/originMm/);
    expect(() => boardSvg(board, { pageMm: A4, originMm: origin, rulerMm: -1 })).toThrow(/rulerMm/);
  });
});
