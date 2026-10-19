/**
 * `MatarThree`: drives a three.js camera and background from a matar
 * `Tracker` (ARCHITECTURE.md §7).
 *
 * - Pose: the tracker's smoothed `boardFromCamera` (GL camera convention, mm,
 *   column-major) becomes `camera.matrix` with the translation × `mmToM`, then
 *   `decompose`d into position/quaternion/scale (§7.1). The board is the world,
 *   in metres: scene content in board coordinates sits on the paper.
 * - Projection: `makePerspective` with the §2.6 frustum of the cover-crop
 *   intrinsics (§7.3) for the canvas size in CSS px, honouring the camera's
 *   `coordinateSystem` and `reversedDepth`.
 * - Background (§7.2): a ring of 3 `VideoFrameTexture`s, filled on the
 *   tracker's synchronous `grab` event, so pose N is always shown over the
 *   pixels of frame N. A slot is never overwritten while it is on screen.
 * - Taps (§7.3): canvas client coordinates → NDC → a `Raycaster` through the
 *   current camera.
 *
 * Browser globals are only touched inside methods (SSR-safe import).
 */
import {
  LinearFilter,
  Matrix4,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  VideoFrameTexture,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import type { GrabEvent, Mat4, PoseEvent, Tracker } from '../types.js';
import { coverFit, frustum } from './fit.js';
import { mmToM } from './units.js';

/**
 * What `MatarThree` needs from a renderer: `WebGLRenderer` (or any renderer
 * with the same `domElement` and synchronous `initTexture`).
 */
export type MatarThreeRenderer = Pick<WebGLRenderer, 'domElement' | 'initTexture'>;

export interface MatarThreeOptions {
  tracker: Tracker;
  renderer: MatarThreeRenderer;
  /** no parent, or a parent whose world matrix is the identity */
  camera: PerspectiveCamera;
  scene: Scene;
  /** `'synced'` (default): `scene.background` = the analysed frame (§7.2); `'none'`: left to the app */
  background?: 'synced' | 'none';
  /** upload the grab event's `VideoFrame` (default; the `<video>` if it has none) or always the `<video>` */
  textureSource?: 'frame' | 'video';
}

export interface MatarThreeUpdate {
  /** the shown frame has a pose: `smoothed !== null` (§5.6) */
  tracking: boolean;
  /** tracker frame ID of the shown pose, −1 before the first */
  frameId: number;
}

/** One texture of the ring and the frame it holds. */
interface Slot {
  tex: VideoFrameTexture;
  frameId: number;
  /** grab order (1, 2, …; 0 = empty): survives frame-ID resets on tracker restarts */
  seq: number;
  /** this frame's pose event, once it arrived */
  pose: PoseEvent | null;
}

const IDENTITY = new Matrix4();

export class MatarThree {
  private readonly tracker: Tracker;
  private readonly renderer: MatarThreeRenderer;
  private readonly camera: PerspectiveCamera;
  private readonly scene: Scene;
  private readonly useVideo: boolean;
  private readonly ring: Slot[] = [];
  private seq = 0;
  private shown: Slot | null = null;
  /** `background: 'none'`: the newest pose event not applied yet */
  private pending: PoseEvent | null = null;
  /** the pose event on screen */
  private current: PoseEvent | null = null;

  constructor(opts: MatarThreeOptions) {
    this.tracker = opts.tracker;
    this.renderer = opts.renderer;
    this.camera = opts.camera;
    this.scene = opts.scene;
    this.useVideo = opts.textureSource === 'video';
    this.checkParent();
    if (opts.background !== 'none') {
      for (let i = 0; i < 3; i++) {
        const tex = new VideoFrameTexture();
        tex.colorSpace = SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = tex.magFilter = LinearFilter;
        this.ring.push({ tex, frameId: -1, seq: 0, pose: null });
      }
      this.tracker.addEventListener('grab', this.onGrab);
    }
    this.tracker.addEventListener('pose', this.onPose);
  }

  /**
   * Applies the newest pose whose frame is in the texture ring (any newest pose
   * with `background: 'none'`): background, camera pose, projection for the
   * current canvas size. Call once per rendered frame, before `render`.
   * Throws if the camera has a parent with a non-identity world matrix.
   */
  update(): MatarThreeUpdate {
    this.checkParent();
    let next = this.pending;
    this.pending = null;
    let slot: Slot | null = null;
    const shownSeq = this.shown ? this.shown.seq : 0;
    for (const s of this.ring) {
      if (s.pose && s.seq > shownSeq && (!slot || s.seq > slot.seq)) slot = s;
    }
    if (slot) {
      this.shown = slot;
      next = slot.pose;
      this.scene.background = slot.tex;
    }
    const cam = this.camera;
    if (next) {
      this.current = next;
      if (next.smoothed) setPose(cam, next.smoothed);
    }
    const e = this.current;
    if (!e) return { tracking: false, frameId: -1 };

    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const w = rect.width || el.width;
    const h = rect.height || el.height;
    if (w > 0 && h > 0) {
      const fit = coverFit(e.intrinsics, w, h);
      const [l, r, t, b] = frustum(fit.k, cam.near);
      cam.projectionMatrix.makePerspective(
        l,
        r,
        t,
        b,
        cam.near,
        cam.far,
        cam.coordinateSystem,
        cam.reversedDepth,
      );
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      if (this.shown) {
        this.shown.tex.repeat.set(fit.rx, fit.ry);
        this.shown.tex.offset.set((1 - fit.rx) / 2, (1 - fit.ry) / 2);
      }
    }
    return { tracking: e.smoothed !== null, frameId: e.frameId };
  }

  /** Normalised device coordinates of a pointer position over the canvas (§7.3). */
  pointerToNdc(e: { clientX: number; clientY: number }): Vector2 {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(
      (2 * (e.clientX - r.left)) / r.width - 1,
      1 - (2 * (e.clientY - r.top)) / r.height,
    );
  }

  /** A new `Raycaster` from the camera through a pointer position, with the projection of the last `update()`. */
  raycaster(e: { clientX: number; clientY: number }): Raycaster {
    const ray = new Raycaster();
    ray.setFromCamera(this.pointerToNdc(e), this.camera);
    return ray;
  }

  /** Removes the tracker listeners and disposes the ring; clears `scene.background` if it is ours. */
  dispose(): void {
    this.tracker.removeEventListener('grab', this.onGrab);
    this.tracker.removeEventListener('pose', this.onPose);
    for (const s of this.ring) {
      if (this.scene.background === s.tex) this.scene.background = null;
      s.tex.dispose();
    }
    this.ring.length = 0;
    this.shown = this.pending = null;
  }

  /** `grab` (synchronous, before the frame is transferred): upload into the oldest slot not on screen. */
  private readonly onGrab = (e: GrabEvent): void => {
    let slot: Slot | null = null;
    for (const s of this.ring) if (s !== this.shown && (!slot || s.seq < slot.seq)) slot = s;
    if (!slot) return; // disposed
    slot.frameId = e.frameId;
    slot.seq = ++this.seq;
    slot.pose = null;
    slot.tex.setFrame(this.useVideo || !e.frame ? e.video : e.frame);
    this.renderer.initTexture(slot.tex);
  };

  /** `pose`: remember it with its frame's texture; frames no longer in the ring are skipped. */
  private readonly onPose = (e: PoseEvent): void => {
    if (!this.ring.length) {
      this.pending = e;
      return;
    }
    let slot: Slot | null = null;
    for (const s of this.ring) {
      if (s.frameId === e.frameId && s.seq > 0 && (!slot || s.seq > slot.seq)) slot = s;
    }
    if (slot) slot.pose = e;
  };

  private checkParent(): void {
    const p = this.camera.parent;
    if (!p) return;
    p.updateWorldMatrix(true, false);
    if (!p.matrixWorld.equals(IDENTITY)) {
      throw new Error("matar/three: the camera's parent must have an identity world transform");
    }
  }
}

/** `boardFromCamera` (GL, mm, column-major) → camera position/quaternion/scale in metres. */
function setPose(cam: PerspectiveCamera, boardFromCamera: Mat4): void {
  const m = cam.matrix.fromArray(boardFromCamera);
  const el = m.elements; // column-major: translation in 12, 13, 14
  el[12] *= mmToM;
  el[13] *= mmToM;
  el[14] *= mmToM;
  m.decompose(cam.position, cam.quaternion, cam.scale);
  cam.updateMatrixWorld();
}
