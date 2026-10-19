/**
 * SVG output for printing (ARCHITECTURE.md §2.2–2.3, §8).
 *
 * Units: SVG user units are mm; `width`/`height` carry an `mm` suffix and the
 * `viewBox` matches, so the file prints at true size when printed at 100 %.
 * Numbers are written exactly: rounded to at most 6 decimals (1 nm), trailing
 * zeros stripped. Cells come from `tagCells` (the single source of truth): the
 * black cells are merged into rectangles (horizontal runs, stacked down while
 * the same run repeats) and written as one `<path>` over a white background,
 * with `shape-rendering="crispEdges"`.
 *
 * `boardSvg` draws one page: page background, the origin cross, a print-check
 * block (optional title, "Print at 100 % (Actual size)", a `rulerMm` ruler with
 * ticks every 10 mm, an ID-1 card outline), then every tag that touches the page
 * at page = board + originMm, each in `<g id="tag-<id>" transform="rotate(θ cx
 * cy)">` around its centre. Tags come last, so their white rings cover anything
 * under them.
 *
 * Print-check placement: the block goes as close as possible to the
 * bottom-centre of the page (L1 distance), at least 5 mm inside the page and
 * 3 mm clear of every tag footprint (black square + white ring, rotated
 * bounding box), the origin cross and `keepOutMm`. With a border ring of tags
 * that means just above the bottom row, centred, inside the ring. If no
 * position fits, `boardSvg` throws; pass `rulerMm: 0` and/or
 * `cardOutline: false` (or a larger page) to make room.
 */
import type { Board, Vec2 } from '../types.js';
import { getFamily, tagCells } from '../tags/index.js';
import { tagOuterSizeMm } from './board.js';
import type { RectMm } from './layout.js';

const DEG = Math.PI / 180;

/** ID-1 card (ISO/IEC 7810), mm */
const CARD_W_MM = 85.6;
const CARD_H_MM = 53.98;
const CARD_R_MM = 3.18;
/** print-check block: distance from the page edge, clearance to tags/keep-outs, mm */
const PAGE_MARGIN_MM = 5;
const CLEARANCE_MM = 3;
/** half-length of the origin cross arms, mm */
const CROSS_MM = 5;
/** width of a sans-serif glyph relative to the font size, for layout estimates */
const GLYPH_W = 0.6;
const STROKE_MM = 0.25;
const NOTE = 'Print at 100 % (Actual size)';

/** Options of `tagSvg`. */
export interface TagSvgOptions {
  /** edge of the black square, mm */
  sizeMm: number;
  /** draw the 1-cell white ring around the black square (default true) */
  quietZone?: boolean;
  /** print the family and ID under the tag (default false) */
  label?: boolean;
}

/** Options of `boardSvg`. Page mm. */
export interface BoardSvgOptions {
  /** page size [width, height], mm */
  pageMm: Vec2;
  /** board origin on this page, page mm: page = board + originMm */
  originMm: Vec2;
  /** ruler length, mm (default 100; 0 = no ruler) */
  rulerMm?: number;
  /** ID-1 card outline 85.60 × 53.98 mm (default true) */
  cardOutline?: boolean;
  /** title printed above the print check and stored in `<title>` */
  title?: string;
  /** page-mm rectangles the print-check block must avoid, e.g. where the object stands */
  keepOutMm?: readonly RectMm[];
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A number in mm for SVG: at most 6 decimals, no trailing zeros, no "-0". */
export function fmtMm(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`matar: cannot write ${v} to SVG`);
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? '0' : String(r);
}

/** Escapes text for XML content and attribute values. */
export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c] as string);
}
const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Black cells of an n × n grid (0 = black) as rectangles [col0, row0, col1,
 * row1) in cells: horizontal runs, each extended down while the rows below
 * have the identical run.
 */
function blackRects(cells: Uint8Array, n: number): [number, number, number, number][] {
  const used = new Uint8Array(n * n);
  const out: [number, number, number, number][] = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (cells[r * n + c] !== 0 || used[r * n + c]) {
        c++;
        continue;
      }
      let c1 = c;
      while (c1 < n && cells[r * n + c1] === 0 && !used[r * n + c1]) c1++;
      // same run in the next rows: black over [c, c1) bounded by white/edge on both sides
      const sameRun = (rr: number) => {
        for (let k = c; k < c1; k++) if (cells[rr * n + k] !== 0 || used[rr * n + k]) return false;
        const left = c === 0 || cells[rr * n + c - 1] !== 0 || used[rr * n + c - 1] === 1;
        const right = c1 === n || cells[rr * n + c1] !== 0 || used[rr * n + c1] === 1;
        return left && right;
      };
      let r1 = r + 1;
      while (r1 < n && sameRun(r1)) r1++;
      for (let rr = r; rr < r1; rr++) for (let k = c; k < c1; k++) used[rr * n + k] = 1;
      out.push([c, r, c1, r1]);
      c = c1;
    }
  }
  return out;
}

/**
 * White background + black path of one unrotated tag whose black square has
 * its top-left at (x0, y0), page mm.
 */
function tagBody(
  family: string,
  id: number,
  x0: number,
  y0: number,
  sizeMm: number,
  ring: boolean,
): string {
  const n = getFamily(family).squareCells;
  const cells = tagCells(family, id);
  const cell = sizeMm / n;
  const q = ring ? cell : 0;
  const bg =
    `<rect x="${fmtMm(x0 - q)}" y="${fmtMm(y0 - q)}" width="${fmtMm(sizeMm + 2 * q)}" ` +
    `height="${fmtMm(sizeMm + 2 * q)}" fill="#fff"/>`;
  let d = '';
  for (const [c0, r0, c1, r1] of blackRects(cells, n)) {
    const xa = fmtMm(x0 + c0 * cell);
    d += `M${xa} ${fmtMm(y0 + r0 * cell)}H${fmtMm(x0 + c1 * cell)}V${fmtMm(y0 + r1 * cell)}H${xa}Z`;
  }
  return `${bg}<path fill="#000" d="${d}"/>`;
}

/**
 * One tag as a standalone `<svg>` element string in mm: the black square is
 * `sizeMm` wide; with `quietZone` (default) the 1-cell white ring is included
 * and the SVG is `sizeMm · (squareCells + 2) / squareCells` wide. `label` adds a
 * line of text with the family and ID below the tag.
 */
export function tagSvg(family: string, id: number, opts: TagSvgOptions): string {
  const { sizeMm } = opts;
  if (!isFiniteNumber(sizeMm) || sizeMm <= 0) {
    throw new Error(`matar: tagSvg: sizeMm must be a finite number > 0 (got ${sizeMm})`);
  }
  const ring = opts.quietZone ?? true;
  const w = ring ? tagOuterSizeMm(sizeMm, family) : sizeMm;
  const q = (w - sizeMm) / 2;
  let h = w;
  let label = '';
  if (opts.label) {
    const fontMm = Math.max(1.5, Math.min(5, sizeMm / 8));
    const gap = Math.max(q, fontMm * 0.3);
    label =
      `<text x="${fmtMm(w / 2)}" y="${fmtMm(w + gap + fontMm * 0.8)}" font-family="sans-serif" ` +
      `font-size="${fmtMm(fontMm)}" text-anchor="middle" fill="#000">` +
      `${escapeXml(family)} #${id}</text>`;
    h = w + gap + fontMm * 1.1;
  }
  const W = fmtMm(w);
  const H = fmtMm(h);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" ` +
    `viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges">` +
    tagBody(family, id, q, q, sizeMm, ring) +
    label +
    '</svg>'
  );
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Top-left of a w × h block closest (L1) to the bottom-centre of the page,
 * inside the page margin and not overlapping any obstacle's interior; null if
 * none. Coordinates are snapped to 0.1 mm (outward from obstacles).
 *
 * The optimum of a separable L1 cost over a page minus axis-aligned boxes has
 * each coordinate at its target or against an obstacle or page edge, so
 * trying those candidates is exact.
 */
function placeBlock(pageW: number, pageH: number, w: number, h: number, obstacles: Box[]) {
  const m = PAGE_MARGIN_MM;
  const ceil = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
  const floor = (v: number) => Math.floor(v * 10 + 1e-6) / 10;
  const xMin = ceil(m);
  const xMax = floor(pageW - m - w);
  const yMin = ceil(m);
  const yMax = floor(pageH - m - h);
  if (xMin > xMax || yMin > yMax) return null;
  const xTarget = Math.min(xMax, Math.max(xMin, Math.round(((pageW - w) / 2) * 10) / 10));
  const yTarget = yMax;
  const xs = new Set([xTarget, xMin, xMax]);
  const ys = new Set([yTarget, yMin]);
  for (const o of obstacles) {
    xs.add(ceil(o.x1));
    xs.add(floor(o.x0 - w));
    ys.add(ceil(o.y1));
    ys.add(floor(o.y0 - h));
  }
  const cands: [number, number, number][] = [];
  for (const x of xs) {
    if (x < xMin || x > xMax) continue;
    for (const y of ys) {
      if (y < yMin || y > yMax) continue;
      cands.push([Math.abs(x - xTarget) + Math.abs(y - yTarget), x, y]);
    }
  }
  cands.sort((a, b) => a[0] - b[0] || b[2] - a[2] || a[1] - b[1]);
  for (const [, x, y] of cands) {
    const hit = obstacles.some((o) => x < o.x1 && x + w > o.x0 && y < o.y1 && y + h > o.y0);
    if (!hit) return { x, y };
  }
  return null;
}

/**
 * One printable page of `board` as an SVG document string (see the module
 * comment for its contents and the print-check placement). Tiled boards call
 * it once per page with that page's `originMm`; tags that don't touch the page
 * are left out.
 */
export function boardSvg(board: Board, opts: BoardSvgOptions): string {
  const [pageW, pageH] = opts.pageMm;
  const [ox, oy] = opts.originMm;
  if (!isFiniteNumber(pageW) || !isFiniteNumber(pageH) || pageW <= 0 || pageH <= 0) {
    throw new Error('matar: boardSvg: pageMm must be two finite numbers > 0');
  }
  if (!isFiniteNumber(ox) || !isFiniteNumber(oy)) {
    throw new Error('matar: boardSvg: originMm must be two finite numbers');
  }
  const rulerMm = opts.rulerMm ?? 100;
  if (!isFiniteNumber(rulerMm) || rulerMm < 0) {
    throw new Error(`matar: boardSvg: rulerMm must be finite and ≥ 0 (got ${rulerMm})`);
  }
  const card = opts.cardOutline ?? true;
  const title = opts.title;
  if (title !== undefined && typeof title !== 'string') {
    throw new Error('matar: boardSvg: title must be a string');
  }

  // tags on this page, page coordinates
  const ring = tagOuterSizeMm(1, board.family);
  const obstacles: Box[] = [];
  const tagEls: string[] = [];
  for (const t of board.tags) {
    const cx = t.centerMm[0] + ox;
    const cy = t.centerMm[1] + oy;
    const th = t.rotationDeg * DEG;
    const r = ((t.sizeMm * ring) / 2) * (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)));
    if (cx + r <= 0 || cy + r <= 0 || cx - r >= pageW || cy - r >= pageH) continue;
    obstacles.push({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r });
    const h = t.sizeMm / 2;
    tagEls.push(
      `<g id="tag-${t.id}" transform="rotate(${fmtMm(t.rotationDeg)} ${fmtMm(cx)} ${fmtMm(cy)})">` +
        tagBody(board.family, t.id, cx - h, cy - h, t.sizeMm, true) +
        '</g>',
    );
  }
  obstacles.push({ x0: ox - CROSS_MM, y0: oy - CROSS_MM, x1: ox + CROSS_MM, y1: oy + CROSS_MM });
  for (const k of opts.keepOutMm ?? []) {
    obstacles.push({ x0: k.x, y0: k.y, x1: k.x + k.width, y1: k.y + k.height });
  }
  for (const o of obstacles) {
    o.x0 -= CLEARANCE_MM;
    o.y0 -= CLEARANCE_MM;
    o.x1 += CLEARANCE_MM;
    o.y1 += CLEARANCE_MM;
  }

  // print-check block, laid out top to bottom in block-local mm
  const noteFont = 3.5;
  const baseW = Math.max(GLYPH_W * noteFont * NOTE.length, rulerMm, card ? CARD_W_MM : 0);
  const pad = 0.5;
  const w = baseW + 2 * pad;
  type Item = (x: number, y: number, cx: number) => string;
  const items: [number, Item][] = []; // [height, draw at block-local top y]
  if (title) {
    const len = Math.max(1, title.length);
    const font = Math.max(2.5, Math.min(5, baseW / (GLYPH_W * len)));
    const fit =
      GLYPH_W * font * len > baseW
        ? ` textLength="${fmtMm(baseW)}" lengthAdjust="spacingAndGlyphs"`
        : '';
    items.push([
      font * 1.4,
      (_x, y, cx) =>
        `<text x="${fmtMm(cx)}" y="${fmtMm(y + font)}" font-size="${fmtMm(font)}"${fit}>` +
        `${escapeXml(title)}</text>`,
    ]);
  }
  items.push([
    noteFont * 1.4,
    (_x, y, cx) =>
      `<text x="${fmtMm(cx)}" y="${fmtMm(y + noteFont)}" font-size="${fmtMm(noteFont)}">${NOTE}</text>`,
  ]);
  if (rulerMm > 0) {
    items.push([
      2.5 + 4 + 5,
      (_x, y, cx) => {
        const yb = y + 2.5 + 4; // baseline; ticks rise from it
        const x0 = cx - rulerMm / 2;
        let ticks = '';
        const tick = (dx: number, long: boolean) => {
          ticks += `M${fmtMm(x0 + dx)} ${fmtMm(yb)}V${fmtMm(yb - (long ? 4 : 2.5))}`;
        };
        const last = Math.floor(rulerMm / 10 + 1e-9);
        for (let k = 0; k <= last; k++) tick(10 * k, k % 5 === 0 || 10 * k === rulerMm);
        if (rulerMm - 10 * last > 1e-9) tick(rulerMm, true);
        return (
          `<path id="ruler" d="M${fmtMm(x0)} ${fmtMm(yb)}H${fmtMm(x0 + rulerMm)}" fill="none" ` +
          `stroke="#000" stroke-width="${STROKE_MM}"/>` +
          `<path d="${ticks}" fill="none" stroke="#000" stroke-width="0.2"/>` +
          `<text x="${fmtMm(cx)}" y="${fmtMm(yb + 4)}" font-size="3">${fmtMm(rulerMm)} mm</text>`
        );
      },
    ]);
  }
  if (card) {
    items.push([
      3 + CARD_H_MM + STROKE_MM,
      (_x, y, cx) => {
        const top = y + 3 + STROKE_MM / 2;
        return (
          `<rect id="card" x="${fmtMm(cx - CARD_W_MM / 2)}" y="${fmtMm(top)}" ` +
          `width="${CARD_W_MM}" height="${CARD_H_MM}" rx="${CARD_R_MM}" fill="none" ` +
          `stroke="#000" stroke-width="${STROKE_MM}" stroke-dasharray="2 1"/>` +
          `<text x="${fmtMm(cx)}" y="${fmtMm(top + CARD_H_MM / 2)}" font-size="3">` +
          `ID-1 card 85.60 &#215; 53.98 mm</text>` +
          `<text x="${fmtMm(cx)}" y="${fmtMm(top + CARD_H_MM / 2 + 4.5)}" font-size="2.5">` +
          `a bank card must fit this outline</text>`
        );
      },
    ]);
  }
  const h = items.reduce((s, [ih]) => s + ih, 0) + 2 * pad;
  const at = placeBlock(pageW, pageH, w, h, obstacles);
  if (!at) {
    throw new Error(
      `matar: boardSvg: no room on the ${fmtMm(pageW)} × ${fmtMm(pageH)} mm page for the ` +
        `print check (${fmtMm(w)} × ${fmtMm(h)} mm) clear of the tags; pass rulerMm: 0 and/or ` +
        'cardOutline: false, or use a larger page',
    );
  }
  const cx = at.x + w / 2;
  let y = at.y + pad;
  let block = '';
  for (const [ih, draw] of items) {
    block += draw(at.x, y, cx);
    y += ih;
  }

  const W = fmtMm(pageW);
  const H = fmtMm(pageH);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
    title ? `<title>${escapeXml(title)}</title>` : '',
    `<rect width="${W}" height="${H}" fill="#fff"/>`,
    `<path id="origin" d="M${fmtMm(ox - CROSS_MM)} ${fmtMm(oy)}H${fmtMm(ox + CROSS_MM)}` +
      `M${fmtMm(ox)} ${fmtMm(oy - CROSS_MM)}V${fmtMm(oy + CROSS_MM)}" fill="none" stroke="#000" ` +
      `stroke-width="${STROKE_MM}"/>`,
    `<g id="print-check" font-family="sans-serif" text-anchor="middle" fill="#000">${block}</g>`,
    `<g id="tags" shape-rendering="crispEdges">`,
    ...tagEls,
    '</g>',
    '</svg>',
  ]
    .filter((line) => line !== '')
    .join('\n')
    .concat('\n');
}
