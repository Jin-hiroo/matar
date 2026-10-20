/** Renders the fake camera video (TASKS.md S2) once, if it isn't there yet. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

export default function globalSetup(): void {
  if (existsSync('tests/out/fake-camera.y4m') && existsSync('tests/out/fake-camera.json')) return;
  execFileSync('pnpm', ['fake-video'], { stdio: 'inherit' });
}
