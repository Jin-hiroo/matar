/**
 * The inline (main-thread) transport (ARCHITECTURE.md §6.3, `worker: false`):
 * a `WorkerPort` that runs the same host as the module worker, loaded with a
 * dynamic `import()` so it costs nothing when unused. Replies are delivered
 * asynchronously (a macrotask), like a real worker's.
 */
import type { MainToWorker, WorkerToMain } from '../types.js';
import type { WorkerPort } from './port.js';

export function createInlinePort(): WorkerPort {
  const target = new EventTarget();
  let handle: ((msg: MainToWorker) => Promise<void>) | null = null;
  let queue: Promise<void> = Promise.all([import('./host.js'), import('./stages.js')]).then(
    ([h, s]) => {
      handle = h.createHost((msg: WorkerToMain) => {
        setTimeout(() => target.dispatchEvent(new MessageEvent('message', { data: msg })), 0);
      }, s.defaultStages);
    },
  );
  let closed = false;
  return {
    postMessage(msg: MainToWorker) {
      if (closed) return;
      queue = queue
        .then(() => handle?.(msg))
        .catch((e: unknown) => {
          target.dispatchEvent(new MessageEvent('error', { data: e }));
        });
    },
    addEventListener: (type, fn) => target.addEventListener(type, fn as EventListener),
    removeEventListener: (type, fn) => target.removeEventListener(type, fn as EventListener),
    terminate() {
      closed = true;
    },
    kind: 'inline',
  };
}
