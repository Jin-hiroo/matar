/**
 * Renders the fake camera video (TASKS.md S2) unless an up-to-date one exists:
 * same board as the demo, and the frame-index strip the e2e test relies on.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { demoBoard } from '../../demo/board.js';

const Y4M = 'tests/out/fake-camera.y4m';
const JSON_PATH = 'tests/out/fake-camera.json';

function upToDate(): boolean {
  if (!existsSync(Y4M) || !existsSync(JSON_PATH)) return false;
  try {
    const meta = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as {
      board?: unknown;
      frameIndex?: unknown;
    };
    return !!meta.frameIndex && JSON.stringify(meta.board) === JSON.stringify(demoBoard());
  } catch {
    return false;
  }
}

export default function globalSetup(): void {
  if (upToDate()) return;
  console.log('rendering the fake camera video (≈ 30 s)…');
  execFileSync('pnpm', ['fake-video'], { stdio: 'inherit' });
}
