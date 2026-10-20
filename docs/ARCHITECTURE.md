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
  │    'grab' event N: matar/three           detect tags (§4)
  │      uploads the same frame for display      │ quads → decode → sub-pixel corners
  │      (texture ring, §7.2)                    pose (§5)
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
  In the board frame that is a rotation by **−θ about +Y** (right-hand rule),
  since board (x, z) = page (x, y).
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

The same matrix as a frustum (`glFrustum`, three's `makePerspective`), which is
how `matar/three` sets it so three's `coordinateSystem` (WebGL/WebGPU) and
`reversedDepth` are respected:

```
l = −n(cx + 0.5)/fx      r = n(w − cx − 0.5)/fx
t =  n(cy + 0.5)/fy      b = −n(h − cy − 0.5)/fy
```

`projectionFromIntrinsics(k, near, far)` (core, `src/pose/frames.ts`) returns
the WebGL matrix above; `near`/`far` are in the units of camera space (mm for
core poses, metres in three.js).

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
- Black squares + their 1-cell white rings must not overlap (validated, with
  rotated squares tested exactly, not by bounding boxes).
- **Layout** (`layoutBorderTags`): a tag's footprint is its black square plus
  its white ring (`sizeMm · 10/8`). The ring of tags fills the border band of
  `areaMm`: footprints ≥ `marginMm` (default 8) from the area edge, measured to
  the outer edge of the white ring; neighbouring footprints at least one cell
  (`sizeMm/8`, RESEARCH.md §2.8) or `minGapMm` apart, whichever is larger. The
  four corner positions are shared by two edges; each edge gets the most tags
  that fit at the minimum pitch, spaced evenly. Order: clockwise on the page
  from the top-left corner tag; `ids` are used in that order and layout stops
  when they run out. Tags whose footprint intersects a `keepOutMm` rectangle
  are dropped (not moved) without consuming an ID. A4 with 32 mm tags → 4 per
  short edge, 6 per long edge, **16 tags**. An inner ring around an object is
  a second call whose `areaMm` is the object's footprint rectangle grown
  outward.
- Recommended (docs, not enforced): ≤ 40 tags per board; the A4 border ring of
  16 × 32 mm tags (free interior 114 × 201 mm), plus an inner ring of 20 mm
  tags around the object for close-ups. On A4 the inner ring fits only around
  footprints up to ≈ 55 × 140 mm; larger objects need A3 or no inner ring; A3 for objects ≳ 10 cm; matte paper; a 100 mm ruler and an ID-1
  card outline (85.60 × 53.98 mm) for the print-scale check.
- Tiled (multi-page) boards: tiles must be aligned to ≲ 1 mm; misalignment is
  overlay error. Per-tile offset estimation is future work.

## 4. Detector (`src/detect/`)

Input: `GrayImage` (analysis resolution, default 1280 × 720 or 720 × 1280).
Output: `TagDetection[]` with sub-pixel corners. Pure functions, preallocated
state object (`createDetector(opts: DetectorOptions)` returns
an object whose `detect(gray)` reuses its buffers; it reallocates only when the
frame size changes; `setIds(ids)` swaps the board's code set).

A hybrid (RESEARCH.md §2.3): ArUco-style candidate search (simple, small),
AprilTag-style edge refinement and decoding (accurate). Pixel centres at
integer coordinates throughout (§2.4). AprilTag's code uses +0.5 centres:
**don't port its offsets verbatim**.

### 4.1 Steps

1. **Decimation** (optional): quad search on a 2 × 2 box-averaged image when
   `decimate: 2`. Decimated → full coordinates: `full = (p + 0.5)·d − 0.5`.
   Steps 4–5 always run on the full-resolution image. `'auto'` (added with D5,
   then the default): ×1 on every 8th frame and whenever the previous frame
   detected nothing; otherwise ×2 if the previous frame's smallest detected
   cell was ≥ 8 px at full resolution (≥ 4 px decimated), else ×1.
2. **Adaptive threshold** (AprilTag 3): 4 × 4 px tiles, each tile's min and
   max, extrema dilated over the 3 × 3 tile neighbourhood, threshold
   (min + max)/2. Pixels whose local max − min < `minContrast` (default 10) are
   "unknown" (neither black nor white). Output: `Uint8Array` labels
   (0 black, 255 white, 127 unknown).
3. **Candidates**: border following (Suzuki–Abe 1985) on black regions,
   outer borders only, perimeter ≥ 32 px; Douglas–Peucker (ε = 0.03 ×
   perimeter); drop near-collinear vertices (Douglas–Peucker can split a
   straight edge into two), then keep convex 4-gons with every side ≥ 8 px
   (both constants internal, measured on the decimated image; an odd last row
   or column is dropped when decimating), interior angles 20°–160°, not touching the image border. Corners ordered clockwise in the image (y down). The tag's black
   border is a black component whose outer border is the square; the white ring
   keeps it apart from other ink.
4. **Edge refinement** (AprilTag `refine_edges`, integer-centre convention):
   for each side, sample points along the line; at each, search ±(d + 1) px
   along the normal at 4 steps/px in the **full-res gray image** (bilinear),
   **linearised** first through a 256-entry LUT `lin[v] = (v/255)^edgeGamma`
   (option `edgeGamma`, default 2.2, 1 = off), weight each step by the squared
   gradient, discard steps whose gradient has the wrong sign (must go black
   inside → white outside); the weighted mean is the edge point. Two passes;
   sample points stay ≈ 4 px (at most 20 % of the side) away from the corners. Why linearise:
   optics blur in linear light and the camera then gamma-encodes, so gradients
   of the encoded values peak on the ink side; that biases edges ≈ 0.5 px inward
   and corners ≈ 0.7 px at blur σ 0.8–1.2 px (measured on `renderBoard`, which
   models the same; linearised: ≤ 0.03 px). Fit a line per side (weighted total least squares);
   corners = intersections of adjacent lines. Reject if a corner moved > 3 px
   or the quad became non-convex.
5. **Decode**: homography (8 unknowns, h33 = 1) from the 8 × 8 cell grid to
   the refined corners; bilinear samples at each cell centre, with 0.25
   Laplacian sharpening over the cell grid (AprilTag). Per-tag threshold:
   midpoint of the means of the black border cells and the white ring cells
   (sampled just outside the square). Cells are sampled through the same
   `edgeGamma` linearisation; `margin` is reported in encoded DN. Reject
   unless ≥ 75 % of the white-ring samples are bright and ring − border
   contrast ≥ `minContrast`. Build the 36-bit code (§3 bit order),
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
   Known weakness: a single small, distant tag has only 2 residual degrees of
   freedom, so the ratio is noisy (20 mm tag at 60 cm, σ 0.3 px: the right
   branch 87 % of the time with a previous pose, 78 % without; a ratio of 10
   gives 99.4 %). The test case (40 mm at 30 cm) is at 100 %. A threshold
   scaled by residual degrees of freedom and noise is listed under Later.

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
2. **Keyframes** (worker): frames with ≥ 6 inlier tags, an RMS < 1 px of the
   frame's **own homography fit** (not `pose.rmsErrPx`: the pose was solved
   with the current, possibly wrong f, so its RMS mostly measures the focal
   error and would refuse the most tilted, most informative views) and board
   tilt ≥ 20°, each differing from the kept ones by ≥ 10° in viewing direction;
   keep up to 20 (drop the least tilted).
3. **Closed form** (RESEARCH.md §2.5): per keyframe, the homography H (DLT,
   §5.2) from board (x, z) mm to **centred, scaled pixels**
   ((u − cx)/L, (v − cy)/L), L = the frame's long side, gives two linear
   equations in w = (L/f)²; least squares over all keyframes gives w, and
   f = L/√w (reject w ≤ 0). (The equations are homogeneous in H, so its scale
   and the board origin don't matter.) Never free f in the per-frame pose LM
   (f and depth are coupled). A joint bundle over f and the keyframe poses is
   not needed in v0.1: in simulation the closed form's error is 0.22 % against
   the bundle's 0.19 % (RESEARCH.md §2.5).
4. **Uncertainty**: solve each keyframe on its own too (wᵢ, fᵢ); the standard
   deviation of the estimate is `std(fᵢ)/√N` as a % of f (N keyframes).
5. **Accept** when ≥ 3 keyframes, the deviation < 1 %, and f ∈ [0.7, 1.4] ×
   prior. Emit `intrinsics` with `source: 'estimated'`. Keep refining until the
   deviation < 0.3 % with at least 10 keyframes (with fewer, the spread has too
   few degrees of freedom and < 0.3 % happens by chance); once accepted, never
   move more than 2 % per update. `provided` intrinsics start accepted.
6. **Jumps**: if 5 consecutive keyframe-quality frames each give a closed-form f
   more than 10 % from the accepted one (e.g. a lens switch) and agree within
   5 % of their median, drop the keyframes and start again: the median becomes
   the reference for the [0.7, 1.4] window and those frames seed the new
   keyframe set.
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
Position and rotation each compute their cutoff fc = `minCutoffHz` + `beta` ·
|speed| from their own filtered speed, but **one α per step** is used for both,
from fc = max(fc_pos, fc_rot). With separate α's, orbiting the board (fast
rotation, slow translation) lets the position lag and the content slides
≈ 1 mm.
Defaults (to be tuned on device): position `minCutoffHz` 1.5, `beta` 0.1 Hz per
mm/s; rotation `minCutoffHz` 1.5, `beta` 20 Hz per rad/s; `dCutoffHz` 1. At
30 fps these give ≈ 0.47 mm / 0.09° output RMS for 1 mm / 0.2° input noise on a
static pose (TASKS.md P5).
**Jump gating**: a raw pose > `jumpMm` (20) or > `jumpDeg` (5°) from the
filtered one is ignored (the output holds) unless the jump persists for
`jumpFrames` (3) frames, then the filter resets to it. dt comes from frame
timestamps, not wall-clock.

**Loss** (`PoseFilter.update(null, t)`, `src/types.ts`): a frame without a pose
holds the last output until `lostAfterMs` (default 300 ms) has passed since the
last pose; then the output is null and the filter resets. The tracker emits a
`pose` event for every analysed frame: `pose` is that frame's raw estimate
(null if none), `smoothed` the filter output. Apps (and `MatarThree`) treat
`smoothed !== null` as tracking. `smoothing: false` → `smoothed` is the raw
pose, no hold.

## 6. Camera, frames and the worker (`src/camera/`, `src/worker/`, `src/tracker/`)

Sources for everything below: RESEARCH.md §1.

### 6.1 Opening the camera

Constraints: `{ audio: false, video: { facingMode: { ideal: 'environment' },
width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } }`.
Never ask for > 30 fps by default (Safari may lower the resolution to meet it;
high-fps formats are heavily cropped). The `<video>` is `playsinline muted
autoplay`, and `play()` is called in `start()`. A video the tracker creates
itself stays in the DOM (1 × 1 px, `opacity: 0`, `pointer-events: none`):
detached or `display: none` videos may stop delivering frames on some browsers
(a DEVICE-TESTS row checks this).

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
   Report `lens: 'pinned' | 'virtual' | 'unknown'` (`LensKind`) in stats and
   the chosen label. More
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

1. `frame = new VideoFrame(video, { timestamp })`.
2. Dispatch the **`grab` event** synchronously (`GrabEvent { frameId, video,
frame }`): `MatarThree` uploads `frame` into its texture ring here (§7.2).
3. `postMessage({ type: 'frame', …, displayWidth: video.videoWidth,
displayHeight: video.videoHeight, screenAngleDeg:
screen.orientation?.angle ?? 0, videoFrame: frame }, [frame])`. After the
   transfer the frame is unusable on the main thread.
4. Worker: `frame.allocationSize()` → `copyTo(buffer)` into a reused buffer;
   then `frame.close()`.
   - `NV12` / `I420` / `I420A` (and other planar YUV): the **Y plane is the
     gray image** (respect `layout[0].offset` and `stride`). WebKit camera
     frames are full-range NV12 (no conversion at all).
   - `RGBA` / `RGBX` / `BGRA` / `BGRX`: luma = (77 R + 150 G + 29 B) >> 8.
   - `format === null` (opaque, e.g. GPU-backed frames): `copyTo(buffer,
{ format: 'RGBA' })` where supported, else the tracker switches to the
     canvas path for this stream.
   - Size from the frame (`visibleRect`, `codedWidth`/`codedHeight`), **never
     from `getSettings()`** (it can report landscape for portrait frames).
   - Orientation: if `frame.rotation` (Chrome 138+) is non-zero, rotate by it.
     Otherwise, if the frame's size is the transpose of `displayWidth ×
displayHeight`, rotate by `screenAngleDeg` (the direction is confirmed by
     a DEVICE-TESTS row). The analysed image always has the orientation of
     what `<video>` shows.

Canvas `getImageData` is **never** used on the hot path when `VideoFrame` works
(Safari's fingerprinting protection can make it ~60× slower). The canvas path
(`drawImage(video)` → gray → `gray` message variant) exists for browsers
without `VideoFrame` and for opaque frames that can't be copied; there the
`grab` event has `frame: null`.

**Later (v0.2, measure first):** iOS 18+ can run `MediaStreamTrackProcessor` in
the worker on a transferred track clone (no main-thread work per frame), and
Chrome can transfer a main-thread processor's `readable`. Both need a way to
match worker frames to displayed frames (timestamps), so they aren't in v0.1.

Frame timing: `rVFC` metadata `mediaTime`/`presentedFrames` identify frames;
`timestampMs` is `performance.now()`-based (`metadata.expectedDisplayTime` or
`now`), used for filter dt.

### 6.3 Worker protocol

Messages are plain objects with a `type`; buffers are transferred. The
normative types are `MainToWorker`, `WorkerToMain` and `WorkerOptions` in
`src/types.ts`:

- main → worker: `init` (board, intrinsics or null → prior from the first
  frame, options), `board`, `intrinsics` (provided/prior), `frame` (frameId,
  timestampMs, display size and screen angle, and exactly one of a transferred
  `videoFrame` or a transferred `gray` buffer), `dispose`.
- worker → main: `ready`; `result` (frameId, timestampMs, analysed size,
  detections, the raw pose, **the intrinsics and `focalSource` the frame was
  solved with**, timings, the gray buffer back for reuse, and with `debug` the
  test video's `debugFrameIndex`); `intrinsics` (a new estimate); `error`
  (code, message); `fallback` (the frame was opaque and can't be copied:
  the tracker switches to the canvas path). Every `frame` gets exactly one
  reply (`result`, `fallback` or `error`), so the in-flight flag always
  clears. Results also carry `frame: FrameInfo` (path, format, coded size,
  applied rotation) and, with `debug`, a ≤ 160 px gray thumbnail.

The worker is spawned with
`new Worker(new URL('../worker/main.js', import.meta.url), { type: 'module' })`
so bundlers (Vite, webpack, Turbopack) emit it as a separate same-origin chunk,
the only thing the library ever loads (CLAUDE.md core idea 1). Integrators
may pass their own `Worker` (`createTracker({ worker })`), or `worker: false`
to run inline on the main thread (tests, debugging, environments without
module workers). The inline path loads the processing code with a dynamic
`import()`, so it costs nothing when unused. If the worker fails to start (the
constructor throws, or an `error` arrives before `ready`), the tracker emits a
`worker-failed` error event and falls back to inline. The worker and inline
paths call the same `processFrame()`.

**Bundler safety**: no browser globals (`window`, `document`, `navigator`,
`Worker`, `VideoFrame`, `screen`) at module top level anywhere in `src/`;
touch them only inside functions. Importing `matar` during server-side
rendering must not throw.

### 6.4 Tracker lifecycle

`idle → starting → running ⇄ paused → stopped`, plus `error`.

- `start()` asks for the camera (permission prompt), starts the video, the
  worker and the frame loop. Call it from a user gesture.
- `document.visibilitychange` hidden, or the track fires `mute` → `paused`
  (frame loop stops; tracks stay open). Visible / `unmute` → resume; if the
  track `ended` meanwhile (iOS does this), re-acquire the camera with the same
  device and settings.
- iOS Low Power Mode caps animation frames at 30 fps; nothing assumes more.
- Every state change fires a `state` event (`StateEvent { state, previous }`).
- Errors surface as `error` events (`TrackerErrorEvent`) with a stable `code`
  (`TrackerErrorCode`): `insecure-context`, `no-camera-api`,
  `permission-denied`, `no-camera`, `camera-in-use`, `overconstrained`,
  `worker-failed`, `unknown`. An error the tracker recovers from (worker →
  inline) doesn't change the state.

## 7. `matar/three` (`src/three/`)

Peer `three ≥ 0.173` (the first release with `VideoFrameTexture`). ≤ 8 KB. The only place that knows metres:
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

1. takes the newest pose event whose frame is in the texture ring;
2. sets `scene.background` to that frame's texture with the cover crop (§7.3);
3. copies the smoothed `boardFromCamera` (translation × `mmToM`) into
   `camera.matrix` and `decompose`s it into `position`/`quaternion`/`scale`
   (three recomputes `matrixWorld` from these on every render, so setting
   `matrixWorld` directly would be overwritten). `matrixAutoUpdate` stays
   `true`. The camera must have no parent or an identity-transform parent;
   `MatarThree` checks this and throws otherwise.
4. sets `camera.projectionMatrix` with `makePerspective(l, r, t, b, n, f,
camera.coordinateSystem, camera.reversedDepth)` from §2.6 with the crop
   intrinsics of §7.3, `n`/`f` = `camera.near`/`camera.far` (metres), and
   `projectionMatrixInverse` = its inverse. Calling
   `camera.updateProjectionMatrix()` overwrites this until the next `update()`.
5. returns `{ tracking: smoothed !== null, frameId }` so apps can hide content
   when lost.

### 7.2 Same-frame display (texture ring)

A ring of 3 `VideoFrameTexture`s (`colorSpace = SRGBColorSpace`,
`generateMipmaps = false`, linear filtering). A plain `Texture` with a video
image doesn't work (three sizes its storage from `image.width`, which is 0 for
a video), and a live `VideoTexture` re-uploads on its own frame callback, so
the frame shown would no longer be the frame analysed.

On the tracker's `grab` event for frame N (synchronous, before the transfer,
§6.2): `tex` = the oldest ring slot that isn't on screen (by a grab counter,
so frame-ID gaps and tracker restarts never overwrite the shown texture);
`tex.setFrame(e.frame ?? e.video); renderer.initTexture(tex)`, which uploads
now. Inside the frame callback the
`<video>` shows the same frame, so `e.video` is the fallback when there is no
`VideoFrame` (or, if a device test shows WebKit can't upload `VideoFrame`s to
WebGL, the only source). When pose N arrives, `update()` shows texture N with
pose N; a pose whose frame is no longer in the ring, or is older than the frame
on screen, is skipped and the last shown frame stays. With one frame in flight, 3 textures always cover "shown" and
"pending". Display latency = worker time + up to one frame, and video and
overlay always match. `background: 'none'` leaves the background to the app.
Accepted by a real-three test in Chromium (Playwright,
`playwright.three.config.ts`): render, read pixels back, and check the
background is frame N's content when pose N is applied, for both texture
sources. three logs (doesn't throw) failed `texImage2D` uploads, so a WebKit
failure would show as a black or stale background: DEVICE-TESTS checks
`?bg=frame` and `?bg=video`. Whether uploads honour `VideoFrame.rotation`
(Chrome 138+) is unverified; the `video` source avoids the question.

Other behaviour: the canvas size is `renderer.domElement.getBoundingClientRect()`
(the same rect taps use), falling back to the drawing-buffer size when the
canvas isn't laid out; `update()` returns `frameId: -1` before the first
pose; `dispose()` removes the listeners, disposes the textures and clears
`scene.background` if it is matar's; `raycaster()` returns a new object.

### 7.3 Canvas fit

The canvas (Wc × Hc, CSS pixels) usually has a different aspect from the frame
(w × h). matar uses "cover": scale s = max(Wc/w, Hc/h), crop offsets
ox = (Wc − s·w)/2, oy = (Hc − s·h)/2 (≤ 0). Effective intrinsics of the visible
crop, used with W = Wc, H = Hc in §2.6:

```
fx' = s·fx    fy' = s·fy
cx' = s(cx + 0.5) + ox − 0.5    cy' = s(cy + 0.5) + oy − 0.5
```

Background texture: `repeat = (Wc/(s·w), Hc/(s·h))`, `offset = ((1 −
repeat.x)/2, (1 − repeat.y)/2)`. Taps: `ndc.x = 2(clientX − rect.left)/rect.width
− 1`, `ndc.y = 1 − 2(clientY − rect.top)/rect.height`; `ar.pointerToNdc(event)`
and `ar.raycaster(event)` use exactly this, with the projection above, so a tap
on the projection of a board point gives a ray through it.

## 8. Public API (normative)

Types not spelled out here (options, events, the tracker interface, worker
messages) are defined in `src/types.ts`, which is part of this section.

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
  DetectorOptions,
  Detector,
  OneEuroParams,
  PoseFilterOptions,
  PoseFilter,
  FocalSource,
  FocalEstimate,
  FocalEstimator,
  TrackerState,
  TrackerErrorCode,
  LensKind,
  TrackerOptions,
  TrackerStats,
  Tracker,
  TrackerEventMap,
  PoseEvent,
  GrabEvent,
  IntrinsicsEvent,
  StateEvent,
  TrackerErrorEvent,
} from './types.js';

// tags (src/tags)
export function getFamily(name: string): TagFamily; // throws on unknown
export const DEFAULT_FAMILY: string; // §3
export function tagCells(family: string, id: number): Uint8Array; // squareCells², 1 = white

// boards (src/board)
export function createBoard(input: { family?: string; tags: readonly BoardTag[] }): Board;
// validates: family known, IDs unique and in range, sizeMm > 0, tags (with their
// white rings) don't overlap; errors name the tag IDs; returns a deep-frozen copy
export function boardTagCornersMm(tag: BoardTag): [Vec2, Vec2, Vec2, Vec2]; // board [x, z]
export function pickTagIds(family: string, count: number, seed: string): number[];
// deterministic seeded random subset, distinct (§3.1)
export function scaleBoard(board: Board, s: number): Board;
// positions and sizes × s: the print-scale correction (measured ruler / 100 mm)
export interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
} // page mm, y down
export function layoutBorderTags(opts: {
  areaMm: RectMm; // the ring fills this rectangle's border band (§3.1)
  originMm: Vec2; // page mm of the board origin
  sizeMm: number; // tag edge (black square)
  ids: readonly number[]; // used in order (clockwise from top-left); stops when they run out
  marginMm?: number; // area edge → outer edge of the white ring, default 8
  minGapMm?: number; // between white rings, default (and at least) one cell
  keepOutMm?: readonly RectMm[]; // tags touching these are dropped
  family?: string;
}): BoardTag[]; // board coordinates, rotationDeg 0
export function tagSvg(
  family: string,
  id: number,
  opts: { sizeMm: number; quietZone?: boolean /* white ring, default true */; label?: boolean },
): string; // an <svg> element string in mm units, black square sizeMm wide
export function boardSvg(
  board: Board,
  opts: {
    pageMm: Vec2; // page width, height
    originMm: Vec2;
    rulerMm?: number; // default 100, 0 = none
    cardOutline?: boolean; // ID-1 card, default true
    title?: string;
    keepOutMm?: readonly RectMm[]; // keep the print-check block off these (the object)
  },
): string; // one page; tiled boards call it per page with that page's originMm
// The print-check block (title, note, ruler, card) goes as close to the page's
// bottom-centre as fits: ≥ 5 mm inside the page, ≥ 3 mm clear of tags, the
// origin cross and keep-outs. Throws if it can't fit (use rulerMm: 0 /
// cardOutline: false or a larger page).

// tracking (src/tracker, src/camera)
export function createTracker(opts: TrackerOptions): Tracker; // sync; start() opens the camera
// (a second, internal `env` argument injects the browser for unit tests)
export function listCameras(): Promise<{ deviceId: string; label: string; rear: boolean }[]>;
// labels are empty until camera permission was granted once

// pure stages (also usable without the tracker)
export function createDetector(opts: DetectorOptions): Detector;
export function estimatePose(
  detections: readonly TagDetection[],
  board: Board,
  intrinsics: CameraIntrinsics,
  previous?: Mat4, // boardFromCamera of the previous frame, for the ambiguity rule (§5.2)
  options?: PoseOptions, // inlierPx 4, huberPx 1.5, ambiguityRatio 1.5, maxIterations 10,
  //                        dropMinPx 3, dropMedianFactor 3 (§5.2–5.4)
): BoardPose | null; // not re-entrant (module-level scratch buffers); one call at a time
export function createPoseFilter(opts?: PoseFilterOptions): PoseFilter; // §5.6
export function createFocalEstimator(
  initial: { intrinsics: CameraIntrinsics; source: 'prior' | 'provided' },
  options?: Partial<FocalEstimatorOptions>, // thresholds of §5.5 (FOCAL_DEFAULTS)
): FocalEstimator; // §5.5
export function focalPrior(width: number, height: number, fovPriorDeg?: number): CameraIntrinsics;
export function projectionFromIntrinsics(k: CameraIntrinsics, near: number, far: number): Mat4;
// WebGL projection, column-major; near/far in camera-space units (§2.6)

// 'matar/three'
export class MatarThree {
  constructor(opts: {
    tracker: Tracker;
    renderer: MatarThreeRenderer; // Pick<WebGLRenderer, 'domElement' | 'initTexture'>
    camera: PerspectiveCamera; // no parent, or an identity-transform parent
    scene: Scene;
    background?: 'synced' | 'none'; // default 'synced' (§7.2)
    textureSource?: 'frame' | 'video'; // upload the VideoFrame (default) or the <video>
  });
  update(): MatarThreeUpdate; // { tracking: smoothed !== null; frameId (−1 before the first pose) }
  pointerToNdc(e: { clientX: number; clientY: number }): Vector2;
  raycaster(e: { clientX: number; clientY: number }): Raycaster;
  dispose(): void;
}
export const mmToM: number; // 0.001
export type { MatarThreeOptions, MatarThreeRenderer, MatarThreeUpdate };

// 'matar/testing' (src/synth/index.ts)
export function renderBoard(opts: RenderBoardOptions): GrayImage; // §9.1
export interface RenderBoardOptions {
  /* §9.1 */
}
export interface SynthPatch {
  centerMm: Vec2;
  sizeMm: Vec2;
  rotationDeg: number;
  cells?: Uint8Array; // n × n, 1 = white: a tag-like square; else a solid rectangle
  albedo?: number; // 0 … 1 of the way from ink to paper, default 0 (ink)
}
export function randomPatches(rng: () => number, opts: RandomPatchesOptions): SynthPatch[];
// strokes, blocks and tag-like squares ≥ minHammingToFamily (5) bits from every code
export function intrinsicsFromFov(width: number, height: number, hfovDeg: number): CameraIntrinsics;
export function lookAtPose(eyeMm: Vec3, targetMm: Vec3, upHint?: Vec3): Mat4; // GL boardFromCamera
export function rollPose(boardFromCamera: Mat4, rollDeg: number): Mat4;
export function randomViewPose(rng: () => number, opts: RandomViewOptions): Mat4;
export function projectBoardPoint(k: CameraIntrinsics, boardFromCamera: Mat4, p: Vec3): Vec2 | null;
export function projectBoardCorners(
  board: Board,
  k: CameraIntrinsics,
  boardFromCamera: Mat4,
): Map<number, [Vec2, Vec2, Vec2, Vec2]>;
export function mulberry32(seed: number): () => number;
export function normalSampler(rng: () => number): () => number;
export function uniform(rng: () => number, lo: number, hi: number): number;
```

`src/synth` keeps its own projection maths, independent of `src/pose`: it is
the test oracle the pose code is checked against.

Changing this section is an API change: bump the minor version while < 1.0,
note it in the commit, and update SPEC.md §4 if the shape changes.

## 9. Testing

### 9.1 Synthetic renderer (`src/synth/`)

`renderBoard(opts: RenderBoardOptions): GrayImage` (normative list in
`src/synth/render.ts`). The output size is `intrinsics.width × height`.

| Option            | Default       | Meaning                                                            |
| ----------------- | ------------- | ------------------------------------------------------------------ |
| `board`           |               | tags to draw                                                       |
| `intrinsics`      |               | camera and output size                                             |
| `boardFromCamera` |               | GL, mm; an array of poses = motion blur (averaged in linear light) |
| `supersample`     | 8             | s × s stratified samples for pixels on an edge                     |
| `blurSigmaPx`     | 0             | Gaussian blur, linear light                                        |
| `noiseSigma`      | 0             | Gaussian noise after encoding, DN (seeded)                         |
| `seed`            | 1             | noise seed (`mulberry32`)                                          |
| `inkLevel`        | 30            | encoded ink level, DN                                              |
| `paperLevel`      | 210           | encoded paper level, DN                                            |
| `backgroundLevel` | 90            | beyond the page or above the horizon, DN                           |
| `gamma`           | 2.2           | encoding gamma, 1 = linear                                         |
| `pageMm`          | endless paper | paper extent `{ min, max }`, board [x, z] mm                       |
| `patches`         | none          | `SynthPatch[]` distractors drawn below the tags (`randomPatches`)  |

- For each pixel, rays through its sample positions (pixel centres at
  integers, §2.4) hit the board plane y = 0, and the albedo there is looked up
  analytically: tag cells via `tagCells`, white ring and paper elsewhere,
  patches, background beyond the page. Adaptive: a pixel whose 4 corners and
  centre see the same value gets that value (keeps 1280 × 720 renders fast).
- Linear light throughout: average samples, Gaussian blur, map to the ink …
  paper levels, gamma-encode, add noise, clamp, quantise to `Uint8`. Blurring
  after encoding would shift edges; real cameras blur before encoding too,
  which is why the detector linearises before its edge search (§4.1 step 4).
- `randomPatches` makes text-like strokes, dark blocks and tag-like squares;
  tag-like squares are redrawn until they are ≥ 5 bits from every code of the
  family in every rotation, so zero-detection tests can't flake.
- Ground truth: `projectBoardCorners` / `projectBoardPoint` with the same
  camera. Because the rendering is exact geometry, corner errors measured
  against it are the detector's own error. `src/synth` has its own projection
  maths on purpose (independent oracle).
- Pitfalls to test for explicitly (RESEARCH.md §2.9): H vs H⁻¹, the page y-down
  vs board z, corner order, rotation sense, the 0.5 px centre convention.

### 9.2 Test layers

| Layer     | Where                                        | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit      | next to the code, `*.test.ts`                | maths identities, family table checksums, SVG structure, protocol                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Synthetic | `tests/synthetic/*.test.ts`                  | detector and pose accuracy over seeded random poses (tolerances in TASKS.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Bench     | `tests/bench/*.bench.ts` (`vitest bench`)    | per-stage timing on 1280 × 720 synthetic frames                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| e2e       | `tests/e2e/*.spec.ts` (Playwright, Chromium) | demo page with a fake camera: Chromium's `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=<y4m>` fed by a Y4M rendered from `renderBoard` (`scripts/make-fake-video.ts`, output in `tests/out/`, gitignored). Each frame carries its index as 16 black/white 8 × 8 px blocks along the top-left edge (bit 15 first, white = 1); with `debug` the worker reads it into `debugFrameIndex`, so poses are compared with the right frame's ground truth. Asserts pose events near ground truth and **no network requests** beyond the page's own origin, and no request bodies at all |
| Device    | `docs/DEVICE-TESTS.md`                       | maintainer, real phones                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

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
