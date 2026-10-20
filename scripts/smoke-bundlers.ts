/**
 * Bundler smoke tests (TASKS.md I3): the packed tarball, consumed by small
 * apps the way integrators do, must bundle the worker and track in a browser.
 *
 *   pnpm smoke                  # all: next (turbopack, webpack, dev), vite
 *   pnpm smoke --only vite
 *
 * For each app: copy `tests/smoke/<app>` to a temp dir, depend on the
 * `pnpm pack` tarball, install (`--prefer-offline`: needs the packages in the
 * pnpm store or the network), build, serve, then open it in Chromium with the
 * fake camera (the S2 video of the demo board) and wait for 30 pose events
 * from the **module** worker, with no request leaving the page's origin.
 * Importing matar in a Next server component also checks SSR safety.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const { values: args } = parseArgs({
  options: { only: { type: 'string' }, keep: { type: 'boolean' } },
});
const root = resolve(import.meta.dirname, '..');
const y4m = join(root, 'tests/out/fake-camera.y4m');
if (!existsSync(y4m)) execFileSync('pnpm', ['fake-video'], { cwd: root, stdio: 'inherit' });

interface Case {
  name: string;
  app: 'next' | 'vite';
  build: string[];
  serve: (port: number) => string[];
}
const CASES: Case[] = [
  {
    name: 'next-turbopack',
    app: 'next',
    build: ['exec', 'next', 'build'],
    serve: (p) => ['exec', 'next', 'start', '-p', `${p}`],
  },
  {
    name: 'next-webpack',
    app: 'next',
    build: ['exec', 'next', 'build', '--webpack'],
    serve: (p) => ['exec', 'next', 'start', '-p', `${p}`],
  },
  { name: 'next-dev', app: 'next', build: [], serve: (p) => ['exec', 'next', 'dev', '-p', `${p}`] },
  {
    name: 'vite',
    app: 'vite',
    build: ['exec', 'vite', 'build'],
    serve: (p) => ['exec', 'vite', 'preview', '--port', `${p}`, '--strictPort'],
  },
];

const work = mkdtempSync(join(tmpdir(), 'matar-smoke-'));
execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });
execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: root, stdio: 'ignore' });
const tgz = join(
  work,
  readdirSync(work).find((f) => f.endsWith('.tgz'))!,
); // `!`: pack just wrote it

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const installed = new Set<string>();
let failed = 0;
let port = 5400;
for (const c of CASES.filter((c) => !args.only || c.name.startsWith(args.only))) {
  const dir = join(work, c.app);
  if (!installed.has(c.app)) {
    cpSync(join(root, 'tests/smoke', c.app), dir, { recursive: true });
    const pkg = join(dir, 'package.json');
    writeFileSync(pkg, readFileSync(pkg, 'utf8').replace('MATAR_TGZ', `file:${tgz}`));
    execFileSync('pnpm', ['install', '--prefer-offline', '--ignore-workspace'], {
      cwd: dir,
      stdio: 'ignore',
      env,
    });
    installed.add(c.app);
  }
  rmSync(join(dir, '.next'), { recursive: true, force: true });
  if (c.build.length) execFileSync('pnpm', c.build, { cwd: dir, stdio: 'ignore', env });
  const p = port++;
  const server = spawn('pnpm', c.serve(p), { cwd: dir, env, detached: true, stdio: 'ignore' });
  try {
    const url = `http://localhost:${p}/`;
    await waitForHttp(url);
    const r = await track(url);
    const ok =
      r.poses >= 30 && r.workers.join() === 'module' && !r.errors.length && !r.foreign.length;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name}: ${JSON.stringify(r)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${c.name}: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    kill(server);
  }
}
if (!args.keep) rmSync(work, { recursive: true, force: true });
process.exit(failed ? 1 : 0);

async function waitForHttp(url: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no server at ${url}`);
}

async function track(url: string) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${y4m}`,
    ],
  });
  try {
    const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
    const foreign: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).origin !== new URL(url).origin) foreign.push(r.url());
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Start' }).click();
    type Smoke = { events: { pose: boolean; worker: string }[]; errors: string[] };
    await page
      .waitForFunction(
        () => ((window as { __smoke?: Smoke }).__smoke?.events.length ?? 0) >= 30,
        null,
        { timeout: 30_000 },
      )
      .catch(() => undefined);
    const s = await page.evaluate(
      () => (window as { __smoke?: Smoke }).__smoke ?? { events: [], errors: ['no state'] },
    );
    return {
      poses: s.events.filter((e) => e.pose).length,
      workers: [...new Set(s.events.map((e) => e.worker))],
      errors: s.errors,
      foreign,
    };
  } finally {
    await browser.close();
  }
}

function kill(child: ChildProcess): void {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGTERM'); // the whole group: pnpm → next → next-server
  } catch {
    // already gone
  }
}
