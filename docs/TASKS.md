# matar — Tasks (the "who/when")

Each task is completable and testable on its own. Tick the box in the same
commit that finishes it. A task is **done** when its code and tests are in,
`pnpm lint && pnpm typecheck && pnpm test` pass, its acceptance criteria are
met, and docs are updated if it changed an API (ARCHITECTURE.md §8).

Tolerances below are checked by tests over **seeded** random cases (≥ 200 per
test unless stated); tests print the seed on failure. "M-series" timings are
reported, not CI-gated (machines vary).

## Owned directories

| Workstream                             | Owns                                                                                                                     | Depends on                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **WS-0 Lead / integration**            | `src/types.ts`, `src/index.ts`, `src/tags/`, `package.json`, lockfile, configs, `docs/`, `NOTICE`, `THIRD_PARTY_NOTICES` | —                             |
| **WS-B Boards & print**                | `src/board/`                                                                                                             | tags                          |
| **WS-S Synthetic renderer**            | `src/synth/`, `scripts/make-fake-video.ts`                                                                               | tags                          |
| **WS-D Detector**                      | `src/detect/`, `tests/synthetic/detect*`, `tests/bench/detect*`                                                          | tags, synth (tests)           |
| **WS-P Pose & maths**                  | `src/math/`, `src/pose/`, `tests/synthetic/pose*`, `tests/bench/pose*`                                                   | types only                    |
| **WS-C Camera, worker, tracker, demo** | `src/camera/`, `src/worker/`, `src/tracker/`, `demo/`, `tests/e2e/`, `playwright.config.ts`                              | detect, pose (via interfaces) |
| **WS-3 three.js adapter**              | `src/three/`                                                                                                             | tracker (via interfaces)      |

Rules (CLAUDE.md): stay in your directories; code against `src/types.ts` and
stub what isn't there yet; don't edit `package.json`, the lockfile,
`src/types.ts` or `src/index.ts` from a parallel branch (each workstream
exports from its own `src/<dir>/index.ts`; the lead wires `src/index.ts`).
Shared code already on `main` (`src/tags/*`, `src/board/corners.ts`,
`src/synth/*`) is **imported, never copied**. Library code must not import
`src/synth` (it is test-only); tests may. `src/synth` keeps its own projection
maths on purpose, as the independent test oracle. Anything else you need from a
workstream that hasn't landed: code against `src/types.ts` and stub it.

## Order

1. **Batch 0 (lead)**: docs, scaffold, T1 tag family. → `main`.
2. **Batch 1 (parallel)**: WS-B, WS-P (P1–P5), WS-D (D1–D4); lead does WS-S.
3. **Batch 2 (parallel)**: WS-C, WS-3, P6 focal calibration, D5 performance.
4. **Batch 3 (lead)**: I1–I4 integration, e2e, size, v0.1.0.
5. **Device**: maintainer runs DEVICE-TESTS.md on one iPhone and one Android phone.

---

## WS-0 Lead / integration

- [x] **L0 Scaffold and docs**: repo, configs, CLAUDE.md, SPEC, ARCHITECTURE,
      TASKS, RESEARCH, DEVICE-TESTS, `src/types.ts`; docs reviewed.
- [x] **T1 tag36h11 family** (`src/tags/`): `tag36h11.ts` (table + bit
      positions from AprilTag `tag36h11.c` @ a29f685f, `/*! @license */`
      header), `getFamily`, `getFamilyDef`, `DEFAULT_FAMILY`, `tagCells`;
      `THIRD_PARTY_NOTICES`.
      _Accept_: 587 codes, first `0x0000000d7e00984b`; min Hamming distance over
      all rotations computed in a test = 11; `tagCells` for IDs 0, 1, 42, 586
      equal the official apriltag-imgs patterns (transcribed in the test);
      border cells all black.

## WS-B Boards & print (`src/board/`)

- [x] **B1 Board model**: `createBoard` (validation per ARCHITECTURE.md §3.1,
      frozen copy), `boardTagCornersMm` (already in `src/board/corners.ts`,
      used by `src/synth`; keep its signature), `scaleBoard`, `pickTagIds`.
      _Accept_: corner order/rotation test (θ = 0, 90, 180, 270, 30°: TL maps
      where §2.3 says; clockwise seen from +Y); overlap and duplicate-ID errors
      with clear messages; `pickTagIds` deterministic per seed, distinct, all
      IDs reachable, two seeds' 40-sets overlap ≈ 2.7 on average (±1, 1000 seed
      pairs).
- [x] **B2 Layout**: `layoutBorderTags` per ARCHITECTURE.md §3.1 (border band
      of `areaMm`, margin to the white ring, ≥ 1-cell gap, corners shared, max
      count per edge evenly spaced, clockwise from top-left, rectangular
      keep-outs drop tags). _Accept_: A4 (210 × 297) with 32 mm tags gives
      exactly **16** tags; a 100 × 80 mm keep-out at the centre changes nothing;
      one over the top-left corner drops the tags it touches; an inner ring of
      20 mm tags around a footprint (second call) doesn't overlap the outer
      ring (A3 with 120 × 90 mm: 26 + 18 tags; A4 with 50 × 100 mm: 16 + 12;
      120 × 90 mm doesn't fit inside the A4 ring); too small an area throws; deterministic; property test
      over random areas/sizes/keep-outs: no overlaps, none outside the area or
      inside the margin, none in keep-outs, `createBoard` accepts the result.
- [x] **B3 SVG**: `tagSvg`, `boardSvg` (page in mm, tags, origin cross, 100 mm
      ruler, ID-1 card outline 85.60 × 53.98 mm, "Print at 100 % (Actual
      size)" text, optional title). _Accept_: parsing the SVG back gives the
      exact cells of `tagCells` (round trip) and exact tag positions (1e-6 mm);
      `shape-rendering="crispEdges"`; cells merged into few paths (file size
      for one tag < 2 KB); width/height attributes in `mm`; ruler exactly
      `rulerMm`.

## WS-S Synthetic renderer (`src/synth/`)

- [x] **S1 renderBoard** (ARCHITECTURE.md §9.1), `projectBoardCorners`,
      `lookAtPose`, `mulberry32`. _Accept_: a fronto-parallel tag with
      integer-aligned cells reproduces `tagCells` exactly; edge positions
      measured from coverage match projected positions within 0.02 px mean
      (bias < 0.005 px, 16 × 16 samples) on tilted views; same seed → identical bytes; 1280 × 720 clean render ≤ 1.5 s on
      M-series.
- [x] **S2 Fake camera video**: `scripts/make-fake-video.ts` (`pnpm fake-video`)
      renders a periodic camera path into a Y4M (`C420jpeg`) for Chromium's
      fake capture plus a JSON ground truth (pose per frame); output in
      `tests/out/` (gitignored). Default 640 × 480, 90 frames, ≈ 30 s. Each
      frame carries its index (16 blocks of 8 × 8 px, top-left, ARCHITECTURE.md
      §9.2); the script warns if a tag comes near that strip.

## WS-D Detector (`src/detect/`)

- [x] **D1 Threshold + candidates**: decimation, tile threshold, border
      following, Douglas–Peucker, quad filters (ARCHITECTURE.md §4.1 steps 1–3).
      _Accept_: on synthetic boards (or local test images until S1 lands) every
      tag's quad is found for ≥ 3 px/cell, tilt ≤ 60°; no crash on all-black,
      all-white, 1 × 1, odd sizes; buffers reused across calls (no allocation
      after warm-up, checked by a test hook).
- [x] **D2 Edge refinement** (step 4, with the `edgeGamma` linearisation).
      _Accept_ (`edgeGamma` = the render's `gamma`, 2.2): clean renders (blur
      0.8 px, no noise, ≥ 5 px/cell, tilt ≤ 50°) corner RMS ≤ 0.1 px, max
      ≤ 0.25 px; noise 3 DN + blur 1.2 px: RMS ≤ 0.3 px. Ground truth from
      `projectBoardCorners`. Also report the RMS with `edgeGamma: 1` (expected
      ≈ 0.7 px) to show the linearisation matters.
- [x] **D3 Decode + order** (steps 5–7) incl. `src/detect/decode.ts` matcher.
      _Accept_: all four in-plane rotations give the right ID and corner order
      (TL, TR, BR, BL); up to 2 flipped data cells decode to the right ID, 3
      don't decode at all; tags whose shortest projected cell edge is ≥ 3 px,
      tilt ≤ 60°, blur 0.8 px, noise 2 DN: ≥ 99 % detected, **100 % correct
      IDs**.
- [x] **D4 False positives**: 1000 clutter frames (`randomPatches` distractors,
      tags with IDs not on the board, random tag-like squares) → **0** detections of board IDs
      in CI; `pnpm test:long` runs 10 000. Tune `minContrast` and border checks
      only with these tests.
- [x] **D5 Performance** (batch 2). Measured at D4 (M2, Node 24, 1280 × 720, 15
      tags, median): decimate 1 clean 7.1 ms, with clutter + 2 DN noise 20 ms
      (noise on flat paper exceeds `minContrast` 10, ≈ 240 specks per frame);
      decimate 2: 3.0 / 3.9 ms. Candidates: `'auto'` decimation, a higher
      default `minContrast`, a despeckle step. `decimate: 'auto'` (§4.1 step 1, then the
      default); `tests/bench/detect.bench.ts` (vitest 5: `bench` is a test
      fixture, see `tests/bench/pose.bench.ts`; `pnpm bench`); report the
      median for 1280 × 720 with 15 tags on M-series (target ≤ 4 ms). Optimise
      only measured hot spots; if far over, propose ROI tracking or WASM SIMD in
      the report instead of doing it.

## WS-P Pose & maths (`src/math/`, `src/pose/`)

- [x] **P1 Maths + frames**: small linear algebra (3×3/4×4 ops, Jacobi SVD for
      3×3 and small symmetric eigen, Cholesky ≤ 9×9, homography DLT with
      Hartley normalisation), `src/pose/frames.ts` (CV ↔ GL, inversions),
      `projectionFromIntrinsics(k, near, far)` (§2.6, near/far in camera-space
      units), `focalPrior` (§5.5 step 1). _Accept_: identities to 1e-12;
      projection matrix matches pinhole `u, v` to 1e-9 px; DLT exact on exact
      data, stable for nearly degenerate (collinear-ish) inputs (no NaN).
- [x] **P2 IPPE + LM**: §5.2–5.3. _Accept_: exact correspondences recover the
      pose to 1e-6 mm / 1e-6°; 12-tag A4 board at 40 cm, tilt 20–50°, corner
      noise σ = 0.15 px: camera position RMS ≤ 0.5 mm, rotation ≤ 0.1°, overlay
      error of a point 100 mm above the board centre (difference of its
      projections under true and estimated pose, in mm at its depth)
      ≤ 0.3 mm RMS.
- [x] **P3 Ambiguity**: single 40 mm tag at 30 cm, tilt ≥ 20°, σ = 0.15 px,
      previous pose = truth perturbed by 2°: correct branch ≥ 99 %; overlay
      error on the board ≤ 1 mm.
- [x] **P4 Outliers**: §5.4. _Accept_: one board tag displaced 20 mm in the
      board data and one fake detection with random corners → both in
      `rejectedTagIds`, pose still meets P2; deterministic; ≤ 1 ms for 15 tags
      on M-series.
- [x] **P5 Filter**: §5.6 `createPoseFilter` (`PoseFilter` in `src/types.ts`):
      One Euro with one shared α per step, jump gating, loss hold. _Accept_
      (defaults, 30 fps): static pose with Gaussian noise of 1 mm / 0.2° RMS
      as 3D magnitudes (σ/√3 per axis) → output 3D RMS ≤ 0.55 mm / 0.10°
      (simulated ≈ 0.45 mm / 0.09°); orbiting the board at 30°/s at 400 mm (rotation fast,
      position slow) → content at the board origin slides ≤ 0.3 mm; 100 mm/s
      constant motion → steady lag ≤ 20 ms; a 30 mm one-frame spike is ignored;
      a persisting jump is taken after 3 frames; `update(null)` holds the last
      output until `lostAfterMs`, then returns null and resets.
- [x] **P6 Focal self-calibration** (batch 2): §5.5 `createFocalEstimator`
      (closed form + per-keyframe spread, no bundle). _Accept_: 20 views tilt
      20–60°, σ = 0.3 px: f within 0.3 %; 3 views: within 1 %; fronto-parallel
      only views → no estimate; accept/limit/jump rules unit-tested; prior from
      `fovPriorDeg` correct for portrait and landscape.

## WS-C Camera, worker, tracker, demo

- [x] **C1 Camera**: constraints, lens selection as a pure function of
      (platform, devices, capabilities) → decision (§6.1), `listCameras`, error
      mapping to codes (§6.4). _Accept_: unit tests for iOS virtual/pinned,
      Android `camera2 N`, deviceId override, unknown platforms.
- [x] **C2 Frame path**: rVFC loop, one frame in flight, the `grab` event
      before the transfer, `VideoFrame` → gray for planar YUV and RGB formats
      with stride/offset, `format === null` handling, rotation (`frame.rotation`
      or transposed vs `displayWidth × displayHeight` → `screenAngleDeg`);
      canvas fallback (§6.2). _Accept_: pure conversion functions tested on synthetic
      buffers of each format and rotation; backpressure test (never > 1 in
      flight).
- [x] **C3 Worker + tracker**: protocol (`MainToWorker`/`WorkerToMain`, §6.3),
      lifecycle (§6.4), inline mode via dynamic `import()`, fallback to inline
      when the worker fails, events (`TrackerEventMap`), pose filter + loss
      hold (`createPoseFilter` from WS-P; stub until merged), the auto-created
      video kept in the DOM. `processFrame` takes injected detect/pose/focal
      functions until I1. No browser globals at module top level.
      _Accept_: unit tests with a fake worker and fake processor; visibility/
      mute pause and resume; restart after `ended`; worker failure → inline +
      `worker-failed` event; importing the module in Node doesn't throw.
- [x] **C4 Demo app** (`demo/`, Vite + basic-ssl): Print board, Start, axes +
      a 50 mm cube on the board, debug HUD with the DEVICE-TESTS fields (camera
      label + all labels, lens, fps, worker ms, err px, jitter mm, f + source,
      worker mode, VideoFrame format / coded size / rotation, a thumbnail of
      the analysed gray frame), `?inline`, `?debug`, `?bg=frame|video`
      (DEVICE-TESTS.md platform checks). _Accept_: `pnpm dev` serves it over HTTPS and
      `pnpm demo:build` builds.
- [x] **C5 e2e harness**: `playwright.config.ts` (Chromium, fake camera from
      S2's Y4M), `tests/e2e/demo.spec.ts`. _Accept_: demo starts with the fake
      camera and emits pose events; no requests outside the page origin; no
      request bodies.

## WS-3 three.js adapter (`src/three/`)

- [x] **T3-1 Camera sync**: `MatarThree.update()`: pose → `camera.matrix` →
      `decompose` (mm → m), `makePerspective` with the crop intrinsics and
      `coordinateSystem`/`reversedDepth` (§7.1, §7.3); throws if the camera
      has a non-identity parent. _Accept_: a board point projects to the same
      canvas pixel through three's camera as through the pinhole model + crop
      (1e-6 px) for portrait/landscape canvases and frames.
- [x] **T3-2 Texture ring** (§7.2): 3 `VideoFrameTexture`s uploaded on the
      `grab` event; `synced` and `none` backgrounds. _Accept_: with a fake
      renderer, pose N always shows texture N; a real-three Playwright test
      (Chromium, WebGL) reads pixels back and finds frame N's content behind
      pose N.
- [x] **T3-3 Taps**: `pointerToNdc`, `raycaster`. _Accept_: tapping the
      projection of a board point gives a ray through it (1e-6 mm).

## Batch 3: integration (lead)

- [x] **I1 Wire the worker**: `processFrame` = detect → pose → focal; tracker
      uses the real worker; `src/index.ts` exports per §8.
- [x] **I2 e2e accuracy**: with S2's path and `?debug`, each pose is compared
      with the ground truth of its `debugFrameIndex`: within 2 mm / 0.5° after
      the first second (end-to-end through Chromium's capture pipeline).
      Measured: every late frame has a pose; worst 0.47–0.54 mm / 0.07°; f
      converges to 474.7 px (truth 474.4).
- [x] **I3 Size + bundlers**: `.size-limit.json`; `pnpm size` passes (core +
      worker ≤ 35 KB then, 50 KB since 2026-10-23; three ≤ 8 KB min+gzip). Smoke apps installing the
      `pnpm pack` tarball build with Vite, webpack 5 and Next.js (Turbopack):
      the worker chunk is emitted, and in Chromium with the fake camera
      `ready` arrives and pose events follow; `import 'matar'` in Node (SSR)
      doesn't throw.
      Measured (min+gzip): whole core entry + worker 33.8 KB; worker chunk
      21.5 KB; matar/three 1.4 KB. With code splitting (esbuild), a typical
      import (`createTracker` + board helpers) is 9.9 KB on the main thread
      plus the worker; the 20.8 KB detect+pose chunk loads only for inline mode.
      `pnpm smoke` (tests/smoke + scripts/smoke-bundlers.ts): Next.js 16.3
      Turbopack build and dev, Next webpack build, Vite 8: each 30/30 poses
      from the module worker, no foreign requests; the Next server component
      imports matar during prerendering (SSR safe).
- [x] **I4 Release v0.1.0**: README usage, CHANGELOG, `pnpm pack` tarball for
      integrators; tag `v0.1.0`.

## Device (maintainer)

- [ ] **DV1** DEVICE-TESTS smoke test on one iPhone (Safari) and one Android
      phone (Chrome); rows recorded. Results feed back into RESEARCH.md
      (camera labels, fps, EIS crop, timings) and the filter defaults.

## Later (not v0.1)

ROI tracking · WASM SIMD stages · a degrees-of-freedom-aware ambiguity
threshold for single small tags (§5.2) · worker-side `MediaStreamTrackProcessor` ·
principal point and k1 in the focal bundle · per-tile offset estimation for
tiled boards · gravity to break the planar ambiguity · more families.
