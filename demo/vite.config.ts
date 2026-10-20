/**
 * Demo dev server and build (TASKS.md C4). `pnpm dev` serves it over HTTPS on
 * the LAN (self-signed, for phones); with MATAR_E2E=1 (Playwright) it serves
 * plain HTTP on localhost, which is a secure context too.
 *
 * The demo imports matar straight from `src/`. The tracker spawns its worker
 * with `new URL('../worker/main.js', import.meta.url)`, which is right for the
 * built `dist/` (tsc keeps the URL); `workerJsToTs` points Vite at the `.ts`
 * source in dev and build.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig, type Plugin } from 'vite';

const e2e = !!process.env.MATAR_E2E;

function workerJsToTs(): Plugin {
  return {
    name: 'matar-worker-js-to-ts',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('/src/tracker/tracker.ts')) return null;
      const target = fileURLToPath(new URL('../src/worker/main.ts', import.meta.url));
      if (!existsSync(target)) return null;
      return code.replace(
        "new URL('../worker/main.js', import.meta.url)",
        "new URL('../worker/main.ts', import.meta.url)",
      );
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [workerJsToTs(), ...(e2e ? [] : [basicSsl()])],
  server: { host: e2e ? 'localhost' : true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
});
