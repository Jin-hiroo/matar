/**
 * `WorkerPort`: what the tracker needs from its processing back end, a module
 * `Worker` or the inline port (src/worker/inline.ts).
 */
import type { MainToWorker } from '../types.js';

export interface WorkerPort {
  postMessage(msg: MainToWorker, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error', fn: (e: MessageEvent | Event) => void): void;
  removeEventListener(type: 'message' | 'error', fn: (e: MessageEvent | Event) => void): void;
  terminate(): void;
  readonly kind: 'module' | 'inline';
}

/** Wraps a `Worker` (spawned by the tracker or passed in by the integrator). */
export function workerPort(worker: Worker): WorkerPort {
  return {
    postMessage: (msg, transfer) => worker.postMessage(msg, transfer ?? []),
    addEventListener: (type, fn) => worker.addEventListener(type, fn as EventListener),
    removeEventListener: (type, fn) => worker.removeEventListener(type, fn as EventListener),
    terminate: () => worker.terminate(),
    kind: 'module',
  };
}
