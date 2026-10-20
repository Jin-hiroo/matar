/**
 * `MatarThree`: drives a three.js camera and background from a matar
 * `Tracker` (ARCHITECTURE.md §7).
 *
 * - Pose: by default the **raw** pose of the shown frame (`pose: 'raw'`): in
 *   synced mode it was fitted to exactly the pixels on screen, so content stays
 *   on the paper with no filter lag; frames without a pose fall back to the
 *   tracker's smoothed pose (its loss hold). `pose: 'smoothed'` uses the One
 *   Euro output throughout. `boardFromCamera` (GL, mm, column-major) becomes
 *   `camera.matrix` with the translation × `mmToM`, then `decompose`d (§7.1).
 *   The board is the world, in metres.
 * - Projection: `makePerspective` with the §2.6 frustum of the cover-crop
 *   intrinsics (§7.3) for the canvas size in CSS px, honouring the camera's
 *   `coordinateSystem` and `reversedDepth`.
 * - Background (§7.2): `'synced'`: a ring of 3 `VideoFrameTexture`s, filled
 *   on the tracker's synchronous `grab` event, so pose N is always shown over
 *   the pixels of frame N (the video is one worker time behind the camera).
 *   `'live'`: the newest camera frame (`VideoTexture`), with the latest pose
 *   extrapolated at constant velocity to that frame's time (lowest latency;
 *   content can swim slightly during sudden moves). `'none'`: left to the app.
 * - Taps (§7.3): canvas client coordinates → NDC → a `Raycaster` through the
 *   current camera.
 *
 * Browser globals are only touched inside methods (SSR-safe import).
 */
import {
  LinearFilter,
  Matrix4,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Vector2,
  Vector3,
  VideoFrameTexture,
  VideoTexture,
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
  /**
   * `'synced'` (default): `scene.background` = the analysed frame (§7.2);
   * `'live'`: the newest camera frame with an extrapolated pose; `'none'`: left to the app
   */
  background?: 'synced' | 'live' | 'none';
  /**
   * `'raw'` (default): each frame's own pose (the smoothed one only when a frame has
   * none); `'smoothed'`: the tracker's One Euro output (§5.6)
   */
  pose?: 'raw' | 'smoothed';
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
/** live mode: extrapolate at most this far ahead of the last pose, ms */
const MAX_EXTRAPOLATE_MS = 100;

/** A pose in metres with its frame timestamp (live-mode extrapolation). */
interface Sample {
  t: number;
  p: Vector3;
  q: Quaternion;
}

export class MatarThree {
  private readonly tracker: Tracker;
  private readonly renderer: MatarThreeRenderer;
  private readonly camera: PerspectiveCamera;
  private readonly scene: Scene;
  private readonly useVideo: boolean;
  private readonly mode: 'synced' | 'live' | 'none';
  private readonly poseKind: 'raw' | 'smoothed';
  private readonly ring: Slot[] = [];
  private liveTex: VideoTexture | null = null;
  private liveFrameT: number | null = null;
  private liveHandle: number | null = null;
  /** live mode: the last two poses (older first) */
  private readonly samples: Sample[] = [];
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
    this.mode = opts.background ?? 'synced';
    this.poseKind = opts.pose ?? 'raw';
    this.checkParent();
    if (this.mode === 'synced') {
      for (let i = 0; i < 3; i++) {
        const tex = new VideoFrameTexture();
        tex.colorSpace = SRGBColorSpace;
        tex.generateMipmaps = false;
        tex.minFilter = tex.magFilter = LinearFilter;
        this.ring.push({ tex, frameId: -1, seq: 0, pose: null });
      }
      this.tracker.addEventListener('grab', this.onGrab);
    } else if (this.mode === 'live') {
      const tex = new VideoTexture(this.tracker.video);
      tex.colorSpace = SRGBColorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = tex.magFilter = LinearFilter;
      this.liveTex = tex;
      this.watchVideoFrames();
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
      const m = this.poseOf(next);
      if (m && this.mode === 'live') this.addSample(next.timestampMs, m);
      else if (m) setPose(cam, m);
      if (!m) this.samples.length = 0;
    }
    if (this.liveTex) {
      this.scene.background = this.liveTex;
      if (this.current && this.poseOf(this.current)) this.applyExtrapolated();
    }
    const e = this.current;
    if (!e) {
      this.fitBackground(
        this.liveTex,
        this.tracker.video.videoWidth,
        this.tracker.video.videoHeight,
      );
      return { tracking: false, frameId: -1 };
    }

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
      const tex = this.liveTex ?? this.shown?.tex ?? null;
      if (tex) {
        tex.repeat.set(fit.rx, fit.ry);
        tex.offset.set((1 - fit.rx) / 2, (1 - fit.ry) / 2);
      }
    }
    return { tracking: e.smoothed !== null, frameId: e.frameId };
  }

  /** The matrix that drives the camera for a pose event (see `pose`). */
  private poseOf(e: PoseEvent): Mat4 | null {
    if (this.poseKind === 'smoothed') return e.smoothed;
    return e.pose?.boardFromCamera ?? e.smoothed;
  }

  /** live: remember a pose (metres) for extrapolation. */
  private addSample(t: number, m: Mat4): void {
    const s = this.samples.length === 2 ? this.samples.shift()! : null; // `!`: length 2
    const sample = s ?? { t: 0, p: new Vector3(), q: new Quaternion() };
    sample.t = t;
    TMP_M.fromArray(m);
    sample.p.setFromMatrixPosition(TMP_M).multiplyScalar(mmToM);
    sample.q.setFromRotationMatrix(TMP_M);
    const last = this.samples[this.samples.length - 1];
    if (last && (t <= last.t || t - last.t > 250)) this.samples.length = 0; // gap or restart
    this.samples.push(sample);
  }

  /**
   * live: the newest pose moved forward at constant velocity to the time of the
   * video frame on screen (at most MAX_EXTRAPOLATE_MS and 3 pose intervals).
   */
  private applyExtrapolated(): void {
    const cam = this.camera;
    const n = this.samples.length;
    const s1 = this.samples[n - 1];
    if (!s1) return;
    cam.position.copy(s1.p);
    cam.quaternion.copy(s1.q);
    const s0 = n > 1 ? this.samples[0] : undefined;
    const target = this.liveFrameT ?? performance.now();
    const ahead = Math.min(Math.max(target - s1.t, 0), MAX_EXTRAPOLATE_MS);
    if (s0 && ahead > 0) {
      const k = Math.min(ahead / (s1.t - s0.t), 3);
      cam.position.addScaledVector(TMP_V.subVectors(s1.p, s0.p), k);
      // rotation: q1 · (q0⁻¹ q1)^k
      TMP_Q.copy(s0.q).invert().multiply(s1.q);
      if (TMP_Q.w < 0) TMP_Q.set(-TMP_Q.x, -TMP_Q.y, -TMP_Q.z, -TMP_Q.w);
      const angle = 2 * Math.acos(Math.min(1, TMP_Q.w));
      if (angle > 1e-9) {
        TMP_V.set(TMP_Q.x, TMP_Q.y, TMP_Q.z).normalize();
        cam.quaternion.multiply(TMP_Q.setFromAxisAngle(TMP_V, angle * k));
      }
    }
    cam.scale.set(1, 1, 1);
    cam.updateMatrix();
    cam.updateMatrixWorld();
  }

  /** live: track the presentation time of the newest video frame (same clock as pose timestamps). */
  private watchVideoFrames(): void {
    const v = this.tracker.video;
    if (typeof v.requestVideoFrameCallback !== 'function') return;
    const tick = (now: number, meta: VideoFrameCallbackMetadata) => {
      this.liveFrameT = meta.expectedDisplayTime || now;
      if (this.liveTex) this.liveHandle = v.requestVideoFrameCallback(tick);
    };
    this.liveHandle = v.requestVideoFrameCallback(tick);
  }

  /** Cover-crop a background texture for a frame size before any pose arrived. */
  private fitBackground(tex: VideoTexture | null, w: number, h: number): void {
    const el = this.renderer.domElement;
    const rect = el.getBoundingClientRect();
    const cw = rect.width || el.width;
    const ch = rect.height || el.height;
    if (!tex || !w || !h || !cw || !ch) return;
    const s = Math.max(cw / w, ch / h);
    const rx = cw / (s * w);
    const ry = ch / (s * h);
    tex.repeat.set(rx, ry);
    tex.offset.set((1 - rx) / 2, (1 - ry) / 2);
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
    if (this.liveTex) {
      if (this.scene.background === this.liveTex) this.scene.background = null;
      this.liveTex.dispose();
      this.liveTex = null;
      const v = this.tracker.video;
      if (this.liveHandle !== null) v.cancelVideoFrameCallback?.(this.liveHandle);
      this.liveHandle = null;
    }
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

const TMP_M = new Matrix4();
const TMP_V = new Vector3();
const TMP_Q = new Quaternion();

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
