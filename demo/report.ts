/**
 * The demo's timing report (DEVICE-TESTS.md): the last 5 s of per-frame
 * numbers, summarised as median / 90th percentile, as plain text to paste
 * into a device-test note or an issue.
 *
 * Times are `performance.now()` ms, the clock of `PoseEvent.timestampMs`
 * (the analysed frame's `expectedDisplayTime`).
 */
import type { PoseEvent } from '../src/types.js';

const WINDOW_MS = 5000;

interface PoseSample {
  at: number;
  tracked: boolean;
  total: number;
  gray: number;
  detect: number;
  pose: number;
  focal: number;
  tags: number;
  errPx: number | null;
}

interface RenderSample {
  at: number;
  renderMs: number;
  /** age of the frame behind the content (ms) */
  bgAgeMs: number | null;
  /** age of the frame the shown pose was computed from (ms) */
  poseAgeMs: number | null;
}

/** What the report header says about the run. */
export interface ReportContext {
  bg: string;
  pose: string;
  device: string;
  screen: string;
}

export class Report {
  private readonly poses: PoseSample[] = [];
  private readonly renders: RenderSample[] = [];
  private readonly cameraFrames: number[] = [];
  private last: PoseEvent | null = null;

  addPose(e: PoseEvent, at: number): void {
    const t = e.stats.timingsMs;
    this.last = e;
    push(this.poses, at, {
      at,
      tracked: e.pose !== null,
      total: t.total,
      gray: t.gray,
      detect: t.detect,
      pose: t.pose,
      focal: t.focal,
      tags: e.detections.length,
      errPx: e.pose ? e.pose.rmsErrPx : null,
    });
  }

  addRender(sample: RenderSample): void {
    push(this.renders, sample.at, sample);
  }

  addCameraFrame(at: number): void {
    push(this.cameraFrames, at, at);
  }

  /** Clears the window (after a mode switch, so the numbers are of one mode). */
  reset(): void {
    this.poses.length = this.renders.length = this.cameraFrames.length = 0;
  }

  text(ctx: ReportContext, now: number): string {
    const e = this.last;
    const poses = this.poses.filter((p) => now - p.at <= WINDOW_MS);
    const renders = this.renders.filter((r) => now - r.at <= WINDOW_MS);
    const cams = this.cameraFrames.filter((t) => now - t <= WINDOW_MS);
    const span = (n: number, first: number | undefined) =>
      first === undefined || n < 2 ? 0 : ((n - 1) * 1000) / (now - first);
    const tracked = poses.filter((p) => p.tracked);
    const lines = [
      `matar demo report (last ${(WINDOW_MS / 1000).toFixed(0)} s)`,
      `mode     bg ${ctx.bg}, pose ${ctx.pose}, worker ${e ? e.stats.worker : '-'}`,
      `device   ${ctx.device}`,
      `screen   ${ctx.screen}`,
    ];
    if (e) {
      const f = e.stats.frame;
      lines.push(
        `camera   ${e.stats.camera.label || '?'} (${e.stats.camera.lens}), ${f.path} ${f.format ?? '-'} ${f.codedWidth}×${f.codedHeight} rot ${f.rotationDeg}°, analysed ${e.intrinsics.width}×${e.intrinsics.height}`,
      );
    }
    lines.push(
      `fps      camera ${span(cams.length, cams[0]).toFixed(1)}, analysed ${span(poses.length, poses[0]?.at).toFixed(1)}, with a pose ${tracked.length}/${poses.length}`,
      `worker   ${mp(poses.map((p) => p.total))} ms`,
      `stages   gray ${mp(poses.map((p) => p.gray))}  detect ${mp(poses.map((p) => p.detect))}  pose ${mp(poses.map((p) => p.pose))}  focal ${mp(poses.map((p) => p.focal))} ms`,
      `bg age   ${mp(nums(renders.map((r) => r.bgAgeMs)), 0)} ms at render`,
      `pose age ${mp(nums(renders.map((r) => r.poseAgeMs)), 0)} ms at render`,
      `pose lag ${mp(nums(renders.map((r) => (r.bgAgeMs === null || r.poseAgeMs === null ? null : r.poseAgeMs - r.bgAgeMs))), 0)} ms behind the background (0 with bg frame)`,
      `render   ${mp(renders.map((r) => r.renderMs))} ms`,
      `tags     ${mp(
        tracked.map((p) => p.tags),
        0,
      )}, err ${mp(nums(tracked.map((p) => p.errPx)), 2)} px`,
    );
    if (e) {
      const fc = e.stats.focal;
      lines.push(
        `focal    ${fc.fx.toFixed(1)} px (${fc.source}${fc.stdDevPct === null ? '' : ` ±${fc.stdDevPct.toFixed(2)} %`})`,
      );
    }
    lines.push(
      '(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)',
    );
    return lines.join('\n');
  }
}

/** Appends and drops samples older than twice the window. */
function push<T>(list: T[], at: number, item: T): void {
  list.push(item);
  while (list.length > 0 && at - atOf(list[0]!) > 2 * WINDOW_MS) list.shift(); // `!`: length > 0
}

function atOf(item: unknown): number {
  return typeof item === 'number' ? item : (item as { at: number }).at;
}

function nums(v: (number | null)[]): number[] {
  return v.filter((x): x is number => x !== null);
}

/** "median / p90", or "-" without samples. */
function mp(v: number[], digits = 1): string {
  if (!v.length) return '-';
  const s = [...v].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!; // `!`: in range
  return `${q(0.5).toFixed(digits)} / ${q(0.9).toFixed(digits)}`;
}
