/**
 * Demo dev server and build (TASKS.md C4). `pnpm dev` serves it over HTTPS on
 * the LAN (self-signed, for phones); with MATAR_E2E=1 (Playwright) it serves
 * plain HTTP on localhost, which is a secure context too.
 *
 * The demo imports matar straight from `src/`. The tracker's
 * `new Worker(new URL('../worker/main.js', import.meta.url), { type: 'module' })`
 * needs no help: Vite resolves the `.js` URL to the `.ts` source in dev and
 * build (checked by the e2e test, which asserts the module worker ran), and the
 * same URL is right for the built `dist/`.
 */
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const e2e = !!process.env.MATAR_E2E;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: e2e ? [] : [basicSsl()],
  server: { host: e2e ? 'localhost' : true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
});
