/**
 * The worker side of the protocol (ARCHITECTURE.md §6.3), independent of the
 * transport: `createHost(post)` returns the message handler. The module worker
 * (`./main.ts`) wires it to `self`; the inline path (`./inline.ts`) to a
 * same-thread port. Messages: `MainToWorker` in, `WorkerToMain` out (src/types.ts).
 *
 * Frames are handled one at a time (the tracker keeps one in flight). Every
 * `frame` message gets exactly one reply: `result`, `fallback` or `error`, so
 * the tracker's in-flight flag always clears.
 */
import type { MainToWorker, WorkerToMain } from '../types.js';
import { FrameReader, type VideoFrameLike } from './frame.js';
import { FrameProcessor, type Stages } from './process.js';

export type Post = (msg: WorkerToMain, transfer?: Transferable[]) => void;

export function createHost(post: Post, stages: Stages): (msg: MainToWorker) => Promise<void> {
  let processor: FrameProcessor | null = null;
  const reader = new FrameReader();

  return async (msg) => {
    switch (msg.type) {
      case 'init':
        processor = new FrameProcessor(stages, msg.board, msg.intrinsics, msg.options);
        post({ type: 'ready' });
        return;
      case 'board':
        processor?.setBoard(msg.board);
        return;
      case 'intrinsics':
        processor?.setIntrinsics(msg.intrinsics, msg.source);
        return;
      case 'dispose':
        processor = null;
        return;
      case 'frame': {
        const { frameId, timestampMs } = msg;
        const vf = msg.videoFrame as (VideoFrameLike & { close(): void }) | undefined;
        try {
          if (!processor) throw new Error('matar: frame before init');
          const t0 = now();
          if (vf) {
            const read = await reader.read(vf, msg);
            if (read === 'opaque') {
              post({ type: 'fallback', frameId, reason: 'opaque-frame' });
              return;
            }
            const { result, intrinsics } = processor.process(
              read.image,
              frameId,
              timestampMs,
              read.info,
              now() - t0,
            );
            postResult(post, result, intrinsics);
          } else if (msg.gray) {
            const g = msg.gray;
            const image = { width: g.width, height: g.height, data: new Uint8Array(g.data) };
            const { result, intrinsics } = processor.process(
              image,
              frameId,
              timestampMs,
              {
                path: 'canvas',
                format: null,
                codedWidth: g.width,
                codedHeight: g.height,
                rotationDeg: 0,
              },
              0,
            );
            result.returned = g.data;
            postResult(post, result, intrinsics);
          } else {
            throw new Error('matar: frame message without videoFrame or gray');
          }
        } catch (e) {
          post({
            type: 'error',
            code: 'unknown',
            message: e instanceof Error ? e.message : String(e),
            frameId,
          });
        } finally {
          vf?.close();
        }
        return;
      }
    }
  };
}

function postResult(
  post: Post,
  result: Extract<WorkerToMain, { type: 'result' }>,
  intrinsics: Extract<WorkerToMain, { type: 'intrinsics' }> | null,
): void {
  const transfer: Transferable[] = [];
  if (result.returned) transfer.push(result.returned);
  if (result.thumbnail) transfer.push(result.thumbnail.data);
  if (intrinsics) post(intrinsics);
  post(result, transfer);
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
