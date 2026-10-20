/**
 * Module-worker entry (ARCHITECTURE.md §6.3), spawned by the tracker with
 * `new Worker(new URL('../worker/main.js', import.meta.url), { type: 'module' })`.
 * Only ever loaded as a worker; it touches `self` behind a guard so that
 * importing it elsewhere (tests, SSR) is harmless.
 */
import type { MainToWorker } from '../types.js';
import { createHost } from './host.js';
import { defaultStages } from './stages.js';

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: MessageEvent<MainToWorker>) => void): void;
}

const scope = (typeof self !== 'undefined' ? self : undefined) as WorkerScope | undefined;
if (scope && typeof (globalThis as { document?: unknown }).document === 'undefined') {
  const handle = createHost(
    (msg, transfer) => scope.postMessage(msg, transfer ?? []),
    defaultStages,
  );
  let queue = Promise.resolve();
  scope.addEventListener('message', (e) => {
    queue = queue.then(() => handle(e.data));
  });
}
