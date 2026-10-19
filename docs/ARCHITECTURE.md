# matar — Architecture (the "how")

Normative for v0.1. SPEC.md says what; this says how. RESEARCH.md holds the
sources behind the platform and algorithm choices.

## 1. Pipeline at a glance

```
main thread                                   worker
───────────                                   ──────
getUserMedia (rear main lens)
  │  <video playsinline muted>
  │
  ├─ per new video frame (requestVideoFrameCallback)
  │    grab frame N ──────────── transfer ──▶  to gray (§6)
  │    onGrab(N): integrator snapshots          detect tags (§4)
  │      the same frame for display              │ quads → decode → sub-pixel corners
  │      (matar/three: texture ring)             pose (§5)
  │                                              │ homography → IPPE → LM, outliers
  │                                              focal self-calibration (§5.5)
  │  ◀──────────────── result N ─────────────────┘
  ├─ smoothing (One Euro, §5.6)
  └─ 'pose' event N  ──▶  matar/three: background = frame N, camera = pose N
```

- One frame in flight: a frame is grabbed only when the worker is idle. Late
  frames are dropped, never queued (lowest latency, bounded memory).
- The overlay is drawn on the frame that was analysed (§7.2), so content can't
  "swim" against the video by the worker latency.
- Everything per frame is preallocated: typed-array buffers are transferred
  back and forth, never re-created.

## 2. Frames and units

### 2.1 Board frame (the world)

Right-handed, **Y up** (out of the paper), paper on the **XZ** plane, **+X to
the right**, **+Z toward the bottom edge of the printed page**, millimetres.
Seen from above (+Y) with the page upright: X right, Z down the page.

### 2.2 Page frame (print)

SVG user units = mm, x right, y down, origin at the page's top-left. A board is
printed with a chosen **board origin** `originMm` (page coordinates):

```
board (x, z) = page (x, y) − originMm        board y = 0 on the paper
```

No flips, no scale. Multi-page (tiled) boards: each page has its own offset;
the library only ever sees board coordinates.

### 2.3 Tags

- `BoardTag.sizeMm` is the outer edge of the black square (the black border
  included, the white quiet zone excluded).
- Unrotated corners in page-local coordinates (y down), relative to the centre:
  TL (−h, −h), TR (h, −h), BR (h, h), BL (−h, h), with h = sizeMm / 2.
- `rotationDeg` θ rotates clockwise on the printed page, like SVG `rotate(θ)`:
  `x' = x cos θ − y sin θ`, `y' = x sin θ + y cos θ` (in y-down page axes).
- `boardTagCornersMm(tag)` returns the four corners in board [x, z] in the order
  TL, TR, BR, BL (clockwise on the page, clockwise seen from +Y). Detections
  (`TagDetection.corners`) use the same order, so corner i ↔ corner i.
- Cells: `tagCells(family, id)` returns `squareCells²` values, row-major from the
  printed top-left of the unrotated tag, `1 = white`. It is the **single source
  of truth** for the SVG writer, the synthetic renderer and the decoder's code
  table. Its bit order follows the source family exactly (§3), so tags print
  identically to the reference generator.

### 2.4 Camera and image

- **CV camera** (internal): +X right, +Y down, +Z forward (into the scene).
- **GL camera** (public): +X right, +Y up, −Z forward. `GL = CV · diag(1, −1, −1)`.
  Conversions live only in `src/pose/frames.ts`.
- **Image**: pixels, x right, y down. Pixel centres are at integer coordinates;
  an image of width w spans [−0.5, w − 0.5].
- **Projection** (CV, no distortion): `u = fx·X/Z + cx`, `v = fy·Y/Z + cy`.
- Default principal point: `cx = (w − 1)/2`, `cy = (h − 1)/2`.

### 2.5 Matrices and poses

- `Mat3` row-major (9), `Mat4` column-major (16, three.js order).
- Internally the solver works with `cameraFromBoard` in CV (R, t: board mm →
  camera mm). Public results are `boardFromCamera` in GL, mm:
  `boardFromCamera = inverse(cameraFromBoard_CV) · diag(1, −1, −1, 1)`.
- With the board as the world, `boardFromCamera` is the camera's world matrix.
  `matar/three` scales its translation by `mmToM` (§7).

### 2.6 three.js projection from intrinsics

For a frame of w × h px with intrinsics (fx, fy, cx, cy), near n, far f, the
GL projection (column-major `P[col*4 + row]`, written here as rows):

```
[ 2fx/w   0       1 − 2(cx + 0.5)/w      0          ]
[ 0       2fy/h   2(cy + 0.5)/h − 1      0          ]
[ 0       0       −(f + n)/(f − n)       −2fn/(f − n)]
[ 0       0       −1                     0          ]
```

Derivation: NDC x = 2(u + 0.5)/w − 1, NDC y = 1 − 2(v + 0.5)/h, with
X = x, Y = −y, Z = −z (GL camera coordinates x, y, z). Unit test: projecting
board points with this matrix must match `u, v` from §2.4 to 1e-9 px.

When the frame is shown cropped/scaled in a canvas (object-fit "cover"), the
same formula is applied to the **effective intrinsics of the visible crop**
(§7.3). Getting this wrong is the usual cause of overlays that drift toward
the screen edges.

## 3. Tag family (`src/tags/`)

**AprilTag tag36h11** is the only family in v0.1 (`DEFAULT_FAMILY =
'tag36h11'`; choice and alternatives in RESEARCH.md §2.1).

- 36 data bits, minimum Hamming distance 11 over all rotations, 587 IDs.
- Geometry: 10 × 10 cells in total = a 1-cell white ring around an 8 × 8 black
  square, whose 1-cell black border surrounds the 6 × 6 data cells.
  `TagFamily = { name: 'tag36h11', dataCells: 6, squareCells: 8, minHamming: 11,
maxCorrectedBits: 2, count: 587 }`.
- Code table: `codedata[587]` and `bit_x[]`/`bit_y[]` copied from AprilTag 3
  [`tag36h11.c` @ a29f685f](https://github.com/AprilRobotics/apriltag/blob/a29f685ff40564e951f3ea276e518e7d541cdd05/tag36h11.c)
  (BSD-2-Clause, University of Michigan). The file `src/tags/tag36h11.ts`
  starts with a `/*! @license BSD-2-Clause … */` header with the full notice
  (minifiers keep `/*!` comments), and `THIRD_PARTY_NOTICES` repeats it.
- Bit order, as in AprilTag's own renderer: bit i (0 = most significant of the 36) is the cell at column `bit_x[i]`, row `bit_y[i]` of the 8 × 8 black-square
  grid (data cells are 1…6), `1 = white`. `tagCells()` implements exactly this;
  a test checks IDs 0, 1, 42 and 586 against the official
  [apriltag-imgs](https://github.com/AprilRobotics/apriltag-imgs) renders
  (patterns transcribed into the test as text, source noted).
- Internal representation (not public): `FamilyDef { family: TagFamily;
codesHi: Uint32Array; codesLo: Uint32Array /* 36-bit codes split 4 + 32 */;
bitX: Uint8Array; bitY: Uint8Array }` via `getFamilyDef(name)`.
- **Decoding against the board only**: the detector matches codes against the
  IDs on the current board (≤ ~40), not all 587. The false-positive rate scales
  with the number of codes in use (RESEARCH.md §2.1), and matching 160 rotated
  codes by popcount is cheap. A debug option matches the whole family.
- Corrected bits: up to 2 (default). False positives that survive decoding are
  removed by the pose consensus (§5.4).

### 3.1 Board design rules (enforced by `createBoard`, applied by `layoutBorderTags`)

- IDs unique within a board. Different boards should use different seeded ID
  sets (`pickTagIds`); random 40-of-587 sets share ≈ 2.7 IDs on average, and
  the consensus step (§5.4) rejects a neighbour's tags that slip in.
- Black squares + their 1-cell white rings must not overlap (validated). The
  layout helper adds one more white cell of gap (RESEARCH.md §2.8) and keeps
  tags ≥ 8 mm from the area edge.
- Recommended (docs, not enforced): ≤ 40 tags per board; A4 border ring of
  12–14 × 32 mm tags, plus an inner ring of 4–6 × 20 mm tags around the object
  for close-ups; A3 for objects ≳ 10 cm; matte paper; a 100 mm ruler and an
  ID-1 card outline (85.60 × 53.98 mm) for the print-scale check.
- Tiled (multi-page) boards: tiles must be aligned to ≲ 1 mm; misalignment is
  overlay error. Per-tile offset estimation is future work.

## 4. Detector (`src/detect/`)

Input: `GrayImage` (analysis resolution, default 1280 × 720 or 720 × 1280).
Output: `TagDetection[]` with sub-pixel corners. Pure functions, preallocated
state object (`createDetector({ width, height, family, ids, options })` returns
an object whose `detect(gray)` reuses its buffers; it reallocates only when the
frame size changes; `setIds(ids)` swaps the board's code set).

A hybrid (RESEARCH.md §2.3): ArUco-style candidate search (simple, small),
AprilTag-style edge refinement and decoding (accurate). Pixel centres at
integer coordinates throughout (§2.4). AprilTag's code uses +0.5 centres:
**don't port its offsets verbatim**.

### 4.1 Steps

1. **Decimation** (optional): quad search on a point-sampled ×2 image when
   `decimate: 2`, or `'auto'` (default): ×2 if the previous frame's smallest
   detected cell was ≥ 8 px at full resolution (≥ 4 px decimated), else ×1.
   Decimated → full coordinates: `full = (p + 0.5)·d − 0.5`. Steps 4–5 always
   run on the full-resolution image.
2. **Adaptive threshold** (AprilTag 3): 4 × 4 px tiles, each tile's min and
   max, extrema dilated over the 3 × 3 tile neighbourhood, threshold
   (min + max)/2. Pixels whose local max − min < `minContrast` (default 10) are
   "unknown" (neither black nor white). Output: `Uint8Array` labels
   (0 black, 255 white, 127 unknown).
3. **Candidates**: border following (Suzuki–Abe 1985) on black regions,
   outer borders only, perimeter ≥ `minPerimeterPx` (default 32); Douglas–
   Peucker (ε = 0.03 × perimeter); keep convex 4-gons with every side ≥
   `minSidePx` (default 8), interior angles 20°–160°, not touching the image
   border. Corners ordered clockwise in the image (y down). The tag's black
   border is a black component whose outer border is the square; the white ring
   keeps it apart from other ink.
4. **Edge refinement** (AprilTag `refine_edges`, integer-centre convention):
   for each side, sample points along the line; at each, search ±(d + 1) px
   along the normal at 4 steps/px in the **full-res gray image** (bilinear),
   weight each step by the squared gradient, discard steps whose gradient has
   the wrong sign (must go black inside → white outside); the weighted mean is
   the edge point. Fit a line per side (weighted total least squares);
   corners = intersections of adjacent lines. Reject if a corner moved > 3 px
   or the quad became non-convex.
5. **Decode**: homography (8 unknowns, h33 = 1) from the 8 × 8 cell grid to
   the refined corners; bilinear samples at each cell centre, with 0.25
   Laplacian sharpening over the cell grid (AprilTag). Per-tag threshold:
   midpoint of the means of the black border cells and the white ring cells
   (sampled just outside the square). Build the 36-bit code (§3 bit order),
   match against the board's codes in all four rotations by popcount
   (`src/detect/decode.ts`); accept if distance ≤ `maxCorrectedBits` and
   ≥ 75 % of border samples are dark. `margin` = mean |sample − threshold| over
   data cells.
6. **Corner order**: the matched rotation tells which image corner is the
   printed TL; rotate so corners are TL, TR, BR, BL (§2.3).
7. **Duplicates**: the same ID twice → keep the higher-margin one.

### 4.2 Performance

Target on an M-series Mac: median ≤ 4 ms for 1280 × 720 with ~15 tags (phones
are typically 2–3× slower; the device budget is ≤ 12 ms for the whole worker
step). No published phone timings exist for JS tag detectors (RESEARCH.md
§2.3): benchmark early (`tests/bench`). Later optimisations, only if device
numbers demand them: ROI search from a constant-velocity prediction with a
full-frame search every 8th frame, a WASM SIMD threshold/contour stage.

## 5. Pose (`src/pose/`, `src/math/`)

Inputs: detections, the board, intrinsics. All maths in float64.

### 5.1 Correspondences

For every detected tag present in the board: four pairs
`board (x, 0, z) ↔ image (u, v)`. Detections whose ID isn't on the board are
`rejectedTagIds`. Image points are normalised: `x = (u − cx)/fx`, `y = (v − cy)/fy`.

### 5.2 Initial pose: homography + IPPE

1. Planar homography from board (x, z) to normalised image points by DLT with
   Hartley normalisation (≥ 4 points; one tag is enough).
2. **IPPE** (Collins & Bartoli 2014, "Infinitesimal Plane-Based Pose
   Estimation") from the homography: two candidate rotations, each with its
   translation. One method for every case, including a single tag.
3. Refine both candidates (§5.3); keep the one with lower reprojection error.
   If e2/e1 < 1.5 (the two-fold planar ambiguity of small or near-fronto-
   parallel views, Schweighofer & Pinz 2006) and a previous pose exists, keep
   the candidate nearer the previous pose (rotation angle). A whole mat in view
   resolves the ambiguity by itself; it matters for close-ups of 1–2 tags.

The OpenCV IPPE port (`ippe.cpp`, BSD-3, Toby Collins) is a valid reference;
if code is ported rather than re-derived from the paper, add its notice to
`THIRD_PARTY_NOTICES`.

### 5.3 Refinement

Levenberg–Marquardt over 6 DoF (rotation as a local axis-angle increment,
translation) minimising pixel reprojection error with a Huber loss
(δ = 1.5 px). Analytic Jacobian of the pinhole projection; 6 × 6 normal
equations solved by Cholesky. ≤ 10 iterations, stop when the step < 1e-6.

### 5.4 Outlier tags

A tag can be wrong for real reasons: a misprint, a tile page placed crooked, a
neighbouring board sharing an ID, or a false decode. With ≥ 3 tags: RANSAC over
**tag pairs**, exhaustively (≤ 780 pairs for 40 visible tags; ~45 for a typical
10): each pair's 8 corners give a pixel homography; inliers are tags whose 4
corners all reproject within `inlierPx` (default 4 px); the largest inlier set
(ties: lower total error) goes to §5.2–5.3. With 1–2 tags: no consensus, use
them as they are. After the fit, drop any tag whose RMS > max(3 px, 3 × median
tag RMS) and refit once. Stateless per frame, so results are deterministic.

`BoardPose.rmsErrPx` is over inlier corners; `usedTagIds` / `rejectedTagIds`
report the split.

### 5.5 Focal-length self-calibration

Browsers don't expose focal length (RESEARCH.md §1). Start from a prior,
refine from the board:

1. **Prior**: `fx = fy = (L/2) / tan(fovDeg/2)` where L is the frame's long side
   and `fovPriorDeg` the long-side field of view (default **68°**, RESEARCH.md
   §1.3; Android EIS crops make it narrower). Principal point at the centre
   ((w − 1)/2, (h − 1)/2), square pixels, no skew, no distortion.
2. **Keyframes** (worker): frames with ≥ 6 inlier tags, RMS < 1 px and board
   tilt ≥ 20°, each differing from the kept ones by ≥ 10° in viewing direction;
   keep up to 20 (drop the least tilted).
3. **Closed form** (RESEARCH.md §2.5): with centred, normalised homographies,
   each keyframe gives two linear equations in w = 1/f²; least squares over all
   keyframes gives w, f = 1/√w (reject w ≤ 0).
4. **Bundle**: joint LM over f and the keyframe poses (shared f), started from
   the closed form. Never free f in the per-frame pose LM (f and depth are
   coupled).
5. **Accept** when ≥ 3 keyframes, the estimate's standard deviation (LM
   covariance) < 1 %, and f ∈ [0.7, 1.4] × prior. Emit `intrinsics` with
   `source: 'estimated'`. Keep refining until the deviation < 0.3 %; once
   accepted, never move more than 2 % per update.
6. **Jumps**: if 5 consecutive keyframe-quality frames each give a closed-form f
   more than 10 % from the accepted one (e.g. a lens switch), drop the
   keyframes and start again from the latest estimate.
7. Integrators may persist `{ width, height, fx, fy, cx, cy }` per device and
   pass it back (`source: 'provided'`); calibration then only refines it.
   Intrinsics are reused only for the same frame size and orientation.

Why this is enough: 1 % focal error moves a point 10 cm above the mat by
≤ 0.15 mm, 3 % by ≤ 0.4 mm (RESEARCH.md §2.5). The principal point matters more
(20 px off → 1.3 mm at 10 cm height) but isn't estimated in v0.1; device
tests measure the overlay offset at height to see whether it needs to be.
Print scale is unobservable (SPEC.md §7); `scaleBoard()` applies a user-measured
correction.

### 5.6 Smoothing (`src/pose/filter.ts`, main thread)

Lag costs more than jitter (27 ms at 100 mm/s ≈ 2.7 mm; iid corner noise
gives < 0.1 mm, RESEARCH.md §2.7), so the filter must be nearly transparent in
motion, and same-frame display (§7.2) matters more than smoothing.

One Euro filter (Casiez et al. 2012) on the camera position (mm) and on
rotation (quaternion: q̂ ← q̂ · exp(α · log(q̂⁻¹ q)), hemisphere-aligned).
Defaults (to be tuned on device): position `minCutoffHz` 1.5, `beta` 0.1 Hz per
mm/s; rotation `minCutoffHz` 1.5, `beta` 20 Hz per rad/s; `dCutoffHz` 1.
**Jump gating**: a raw pose > 20 mm or > 5° from the filtered one is ignored
unless the jump persists for 3 frames, then the filter resets to it. Reset also
after a loss. dt comes from frame timestamps, not wall-clock.

Pose loss: no inlier tag for `lostAfterMs` (default 300 ms) → `pose` event with
`pose: null`. Until then the last pose is held.

## 6. Camera, frames and the worker (`src/camera/`, `src/worker/`, `src/tracker/`)

Sources for everything below: RESEARCH.md §1.

### 6.1 Opening the camera

Constraints: `{ audio: false, video: { facingMode: { ideal: 'environment' },
width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }`.
Never ask for > 30 fps by default (Safari may lower the resolution to meet it;
high-fps formats are heavily cropped). The `<video>` is `playsinline muted
autoplay`, and `play()` is called in `start()`.

**Lens pinning.** A lens switch silently changes the intrinsics, so the tracker
tries to stay on one lens:

1. `camera.deviceId` given → use it (`exact`), nothing else.
2. Open with the constraints above. After permission, `enumerateDevices()`
   has labels.
3. **iOS / WebKit**: `facingMode` opens a virtual multi-lens device
   (it switches to the ultra-wide close up). If a `videoinput` is labelled
   exactly `Back Camera` (English; labels are localised), reopen on that
   device (the plain wide lens). Otherwise stay on the virtual device and
   apply `zoom: 1` if the capabilities offer `zoom.min < 1` (wide framing).
   Report `lens: 'pinned' | 'virtual'` in stats and the chosen label. More
   locales are added from device-test data, not guessed.
4. **Android / Chrome**: back cameras are labelled `camera2 N, facing back`
   (not localised). Choose the lowest N; reopen if the current track isn't it.
5. Expose `listCameras()` (labels + deviceIds after permission) so apps can
   offer a picker and persist the choice.

The demo HUD shows every `videoinput` label and the chosen one, so device
tests collect real labels (DEVICE-TESTS.md).

### 6.2 Frame path

**v0.1 path (iOS 17+, Android Chrome; one code path):** in the main-thread
`requestVideoFrameCallback`, when the worker is idle:

1. `onGrab(frameId, video)` (the display snapshot, §7.2), then
2. `new VideoFrame(video, { timestamp })` → `postMessage(…, [frame])`.
3. Worker: `frame.allocationSize()` → `copyTo(buffer)` into a reused buffer;
   then `frame.close()`.
   - `NV12` / `I420` / `I420A` (and other planar YUV): the **Y plane is the
     gray image** (respect `layout[0].offset` and `stride`). WebKit camera
     frames are full-range NV12 (no conversion at all).
   - `RGBA` / `RGBX` / `BGRA` / `BGRX`: luma = (77 R + 150 G + 29 B) >> 8.
   - Size from the frame (`visibleRect`, `codedWidth`/`codedHeight`), **never
     from `getSettings()`** (it can report landscape for portrait frames).
   - If `frame.rotation` (Chrome 138+) is non-zero, rotate the gray image so
     the analysed image has the orientation of what `<video>` shows.

Canvas `getImageData` is **never** used on the hot path (Safari's
fingerprinting protection can make it ~60× slower). A canvas fallback exists
only for desktop browsers without `VideoFrame` (`gray` message variant).

**Later (v0.2, measure first):** iOS 18+ can run `MediaStreamTrackProcessor` in
the worker on a transferred track clone (no main-thread work per frame), and
Chrome can transfer a main-thread processor's `readable`. Both need a way to
match worker frames to displayed frames (timestamps), so they aren't in v0.1.

Frame timing: `rVFC` metadata `mediaTime`/`presentedFrames` identify frames;
`timestampMs` is `performance.now()`-based (`metadata.expectedDisplayTime` or
`now`), used for filter dt.

### 6.3 Worker protocol

Messages are plain objects with a `type`; buffers are transferred.

```ts
// main → worker
{ type: 'init', board: Board, intrinsics: CameraIntrinsics | null, options: WorkerOptions }
{ type: 'board', board: Board }
{ type: 'intrinsics', intrinsics: CameraIntrinsics, source: 'provided' | 'prior' }
{ type: 'frame', frameId: number, timestampMs: number,
  // exactly one of:
  videoFrame?: VideoFrame,                               // transferred (§6.2)
  gray?: { width: number; height: number; data: ArrayBuffer } } // transferred (fallback, tests)
{ type: 'dispose' }

// worker → main
{ type: 'ready' }
{ type: 'result', frameId, timestampMs, width, height,
  detections: TagDetection[], pose: BoardPose | null,   // raw (unsmoothed)
  timingsMs: { gray: number; detect: number; pose: number; total: number },
  returned?: ArrayBuffer }                               // gray buffer back for reuse
{ type: 'intrinsics', intrinsics: CameraIntrinsics, source: 'estimated', stdDevPct: number }
{ type: 'error', message: string }
```

The worker is spawned with
`new Worker(new URL('../worker/main.js', import.meta.url), { type: 'module' })`
so bundlers (Vite, webpack, Turbopack) emit it as a separate chunk. Integrators
may pass their own `Worker` (`createTracker({ worker })`), or `worker: false`
to run inline on the main thread (tests, debugging, environments without
module workers). The worker and inline paths call the same `processFrame()`.

### 6.4 Tracker lifecycle

`idle → starting → running ⇄ paused → stopped`, plus `error`.

- `start()` asks for the camera (permission prompt), starts the video, the
  worker and the frame loop. Call it from a user gesture.
- `document.visibilitychange` hidden, or the track fires `mute` → `paused`
  (frame loop stops; tracks stay open). Visible / `unmute` → resume; if the
  track `ended` meanwhile (iOS does this), re-acquire the camera with the same
  device and settings.
- iOS Low Power Mode caps animation frames at 30 fps; nothing assumes more.
- Errors surface as `error` events with a stable `code`:
  `insecure-context`, `no-camera-api`, `permission-denied`, `no-camera`,
  `camera-in-use`, `overconstrained`, `worker-failed`, `unknown`.

## 7. `matar/three` (`src/three/`)

Peer `three ≥ 0.170`. ≤ 8 KB. The only place that knows metres:
`src/three/units.ts` exports `mmToM` (0.001).

### 7.1 Usage

```ts
const ar = new MatarThree({ tracker, renderer, camera, scene });
renderer.setAnimationLoop(() => {
  ar.update(); // applies the newest finished frame
  renderer.render(scene, camera);
});
```

The board is the world: content added to `scene` in metres in board
coordinates sits on the paper. `ar.update()`:

1. takes the newest result whose frame is in the texture ring;
2. sets `scene.background` to that frame's texture with the cover crop (§7.3);
3. sets `camera.matrixWorld` from the smoothed `boardFromCamera` (translation ×
   `mmToM`), `matrixWorldInverse`, `projectionMatrix` from §2.6 and
   `projectionMatrixInverse`. The camera has `matrixAutoUpdate = false`;
   never call `camera.updateProjectionMatrix()` on it.
4. returns `{ tracking: boolean, frameId }` so apps can hide content when lost.

### 7.2 Same-frame display (texture ring)

The tracker calls `onGrab(frameId, video)` synchronously in the task that grabs
frame N. `MatarThree` uploads the video's current frame into ring texture
`N mod 3` right there (`texture.needsUpdate = true; renderer.initTexture(tex)`).
When result N arrives, `update()` shows texture N with pose N. Display latency
= worker time + up to one frame, and video and overlay always match.
`background: 'live'` (show the `<video>` directly, lowest latency, slight
swim) and `'none'` (app draws its own background) are options.

### 7.3 Canvas fit

The canvas usually has a different aspect from the frame. matar uses "cover":
scale s = max(Wc/w, Hc/h), centred crop. The background texture gets the
matching `repeat`/`offset`, and the projection uses the effective intrinsics of
the visible crop (fx·s, fy·s, principal point shifted by the crop offset, in
canvas pixels). `ar.pointerToNdc(event)` and `ar.raycaster(event)` map taps to
rays with the same mapping.

## 8. Public API (normative)

```ts
// 'matar'
export type {
  Vec2,
  Vec3,
  Mat3,
  Mat4,
  GrayImage,
  TagFamily,
  BoardTag,
  Board,
  TagDetection,
  CameraIntrinsics,
  BoardPose,
} from './types.js';

// tags (src/tags)
export function getFamily(name: string): TagFamily; // throws on unknown
export const DEFAULT_FAMILY: string; // §3
export function tagCells(family: string, id: number): Uint8Array; // squareCells², 1 = white

// boards (src/board)
export function createBoard(input: { family?: string; tags: BoardTag[] }): Board;
// validates: family known, IDs unique and in range, sizeMm > 0, tags don't overlap
// (incl. quiet zones); returns a frozen copy
export function boardTagCornersMm(tag: BoardTag): [Vec2, Vec2, Vec2, Vec2]; // board [x, z]
export function pickTagIds(family: string, count: number, seed: string): number[];
// deterministic seeded random subset, distinct (§3.1)
export function scaleBoard(board: Board, s: number): Board;
// positions and sizes × s: the print-scale correction (measured ruler / 100 mm)
export function layoutBorderTags(opts: {
  areaMm: { x: number; y: number; width: number; height: number }; // page mm
  originMm: Vec2; // page mm of the board origin
  sizeMm: number; // tag edge (black square)
  minGapMm?: number; // between quiet zones, default 0
  keepOutMm?: Vec2[][]; // page-mm polygons tags must not overlap (incl. quiet zone)
  ids: number[]; // used in order; layout stops when they run out
  family?: string;
}): BoardTag[]; // board coordinates
export function tagSvg(
  family: string,
  id: number,
  opts: {
    sizeMm: number;
    quietZone?: boolean /* default true */;
    label?: boolean;
  },
): string;
// an <svg> element string in mm units, black square sizeMm wide
export function boardSvg(
  board: Board,
  opts: {
    pageMm: Vec2;
    originMm: Vec2;
    rulerMm?: number /* default 100, 0 = none */;
    cardOutline?: boolean /* ID-1 card, default true */;
    title?: string;
  },
): string;
// one page; tiled boards call it per page with that page's originMm

// tracking (src/tracker)
export function createTracker(opts: TrackerOptions): Tracker;
export function listCameras(): Promise<{ deviceId: string; label: string; rear: boolean }[]>;
// labels are empty until camera permission was granted once
export interface TrackerOptions {
  board: Board;
  video?: HTMLVideoElement; // created (hidden, playsinline, muted) if omitted
  camera?: { width?: number; height?: number; frameRate?: number; deviceId?: string };
  intrinsics?: CameraIntrinsics; // restore a saved calibration (same frame size)
  fovPriorDeg?: number; // long-side FOV prior, §5.5
  autoFocal?: boolean; // default true
  smoothing?: { minCutoffHz?: number; beta?: number; dCutoffHz?: number } | false;
  lostAfterMs?: number; // default 300
  worker?: Worker | false; // default: bundled module worker
  onGrab?: (frameId: number, video: HTMLVideoElement) => void; // §7.2
}
export interface Tracker extends EventTarget {
  readonly state: 'idle' | 'starting' | 'running' | 'paused' | 'stopped' | 'error';
  readonly video: HTMLVideoElement;
  readonly intrinsics: CameraIntrinsics | null;
  start(): Promise<void>;
  stop(): void;
  setBoard(board: Board): void;
  // events: 'pose' (PoseEvent), 'intrinsics' (IntrinsicsEvent), 'state', 'error' (TrackerErrorEvent)
}
export interface PoseEvent extends Event {
  readonly frameId: number;
  readonly timestampMs: number;
  readonly pose: BoardPose | null; // raw; null when lost
  readonly smoothed: Mat4 | null; // boardFromCamera after §5.6
  readonly detections: readonly TagDetection[];
  readonly intrinsics: CameraIntrinsics; // used for this frame
  readonly stats: {
    fps: number;
    workerMs: number;
    timingsMs: Record<string, number>;
    camera: { label: string; lens: 'pinned' | 'virtual' | 'unknown' };
    focal: { fx: number; source: 'prior' | 'provided' | 'estimated'; stdDevPct: number | null };
  };
}

// pure stages (also usable without the tracker)
export function createDetector(opts: {
  width: number;
  height: number;
  family: string;
  ids: readonly number[] | 'all';
  maxCorrectedBits?: number;
  minContrast?: number;
  decimate?: 1 | 2 | 'auto';
}): {
  detect(img: GrayImage): TagDetection[];
  setIds(ids: readonly number[] | 'all'): void;
};
export function estimatePose(
  detections: readonly TagDetection[],
  board: Board,
  intrinsics: CameraIntrinsics,
  previous?: Mat4,
): BoardPose | null;
export function projectionFromIntrinsics(k: CameraIntrinsics, nearMm: number, farMm: number): Mat4;

// 'matar/three'
export class MatarThree {
  constructor(opts: {
    tracker: Tracker;
    renderer: WebGLRenderer;
    camera: PerspectiveCamera;
    scene: Scene;
    background?: 'synced' | 'live' | 'none';
  });
  update(): { tracking: boolean; frameId: number };
  pointerToNdc(e: { clientX: number; clientY: number }): Vector2;
  raycaster(e: { clientX: number; clientY: number }): Raycaster;
  dispose(): void;
}
export const mmToM: number;

// 'matar/testing'
export function renderBoard(opts: RenderBoardOptions): GrayImage; // §9.1
export function projectBoardCorners(
  board: Board,
  k: CameraIntrinsics,
  boardFromCamera: Mat4,
): Map<number, [Vec2, Vec2, Vec2, Vec2]>;
export function lookAtPose(eyeMm: Vec3, targetMm: Vec3, upHint?: Vec3): Mat4; // GL boardFromCamera
export function mulberry32(seed: number): () => number;
```

Changing this section is an API change: bump the minor version while < 1.0,
note it in the commit, and update SPEC.md §4 if the shape changes.

## 9. Testing

### 9.1 Synthetic renderer (`src/synth/`)

`renderBoard({ board, intrinsics, boardFromCamera, width, height, supersample,
blurSigmaPx, noiseSigma, seed, paper, ink, background, distractors })`:

- For each pixel, cast rays through s × s stratified sample positions (pixel
  centres at integers, §2.4; default s = 8) into the board plane y = 0, and
  look up the albedo analytically at board (x, z): tag cells via `tagCells`,
  white ring and paper elsewhere, `background` beyond the page, optional
  `distractors` (dark rectangles, text-like strokes, a ruler, random tag-like
  squares with invalid codes). Adaptive: a pixel whose 4 corner rays and centre
  hit the same uniform region gets 1 sample (keeps 1280 × 720 renders fast).
- Work in linear light: average samples, Gaussian blur (`blurSigmaPx`), map to
  `ink` … `paper` levels (default 30 … 210 DN after encoding), gamma-encode
  (2.2), add Gaussian noise (`noiseSigma` DN, seeded `mulberry32`), clamp,
  quantise to `Uint8`. Blurring after gamma would shift edges.
- Optional motion blur: average `motionSamples` renders along a pose path.
- Ground truth: `projectBoardCorners` with the same camera. Because the
  rendering is exact geometry, corner errors measured against it are the
  detector's own error.
- Pitfalls to test for explicitly (RESEARCH.md §2.9): H vs H⁻¹, the page y-down
  vs board z, corner order, rotation sense, the 0.5 px centre convention.

### 9.2 Test layers

| Layer     | Where                                        | What                                                                                                                                                                                                                                                                                                                                                            |
| --------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit      | next to the code, `*.test.ts`                | maths identities, family table checksums, SVG structure, protocol                                                                                                                                                                                                                                                                                               |
| Synthetic | `tests/synthetic/*.test.ts`                  | detector and pose accuracy over seeded random poses (tolerances in TASKS.md)                                                                                                                                                                                                                                                                                    |
| Bench     | `tests/bench/*.bench.ts` (`vitest bench`)    | per-stage timing on 1280 × 720 synthetic frames                                                                                                                                                                                                                                                                                                                 |
| e2e       | `tests/e2e/*.spec.ts` (Playwright, Chromium) | demo page with a fake camera: Chromium's `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>` fed by a Y4M rendered from `renderBoard` (`scripts/make-fake-video.ts`, output in `tests/out/`, gitignored). Asserts pose events near ground truth and **no network requests** beyond the page's own origin, and no request bodies at all |
| Device    | `docs/DEVICE-TESTS.md`                       | maintainer, real phones                                                                                                                                                                                                                                                                                                                                         |

All randomness is seeded; tests print the seed on failure.

## 10. Packaging and size

- ESM only, `tsc -p tsconfig.build.json` → `dist/` mirroring `src/` (tree-
  shakeable, `sideEffects: false`). Entry points: `matar` (`src/index.ts`),
  `matar/three` (`src/three/index.ts`), `matar/testing` (`src/synth/index.ts`),
  and the worker `dist/worker/main.js`.
- `pnpm size` (size-limit, `.size-limit.json`) checks: core entry + worker ≤ 35 KB,
  `matar/three` ≤ 8 KB (three.js excluded), min+gzip.
- The tag code table ships as a compact hex string in source, no binary asset
  fetches (core idea 1).
