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
Small shared helpers you need from another workstream's directory: write a
local copy in yours and note it for de-duplication after merge.

## Order

1. **Batch 0 (lead)**: docs, scaffold, T1 tag family. → `main`.
2. **Batch 1 (parallel)**: WS-B, WS-P (P1–P5), WS-D (D1–D4); lead does WS-S.
3. **Batch 2 (parallel)**: WS-C, WS-3, P6 focal calibration, D5 performance.
4. **Batch 3 (lead)**: I1–I4 integration, e2e, size, v0.1.0.
5. **Device**: maintainer runs DEVICE-TESTS.md on one iPhone and one Android phone.

---

## WS-0 Lead / integration

- [ ] **L0 Scaffold and docs**: repo, configs, CLAUDE.md, SPEC, ARCHITECTURE,
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

- [ ] **B1 Board model**: `createBoard` (validation per ARCHITECTURE.md §3.1,
      frozen copy), `boardTagCornersMm` (already in `src/board/corners.ts`,
      used by `src/synth`; keep its signature), `scaleBoard`, `pickTagIds`.
      _Accept_: corner order/rotation test (θ = 0, 90, 180, 270, 30°: TL maps
      where §2.3 says; clockwise seen from +Y); overlap and duplicate-ID errors
      with clear messages; `pickTagIds` deterministic per seed, distinct, all
      IDs reachable, two seeds' 40-sets overlap ≈ 2.7 on average (±1, 1000 seed
      pairs).
- [ ] **B2 Layout**: `layoutBorderTags` (ring inside `areaMm`, ≥ 8 mm from its
      edge, one extra white cell between tags, keep-out polygons respected,
      IDs used in order). _Accept_: A4 with a 100 × 80 mm keep-out at the centre
      gives 12–14 × 32 mm tags with no overlap and none in the keep-out; inner
      ring of 20 mm tags around a footprint works by a second call;
      deterministic; property test over random areas/keep-outs: no overlaps,
      none outside the area, none in keep-outs.
- [ ] **B3 SVG**: `tagSvg`, `boardSvg` (page in mm, tags, origin cross, 100 mm
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
- [ ] **S2 Fake camera video**: `scripts/make-fake-video.ts` renders a camera
      path into a Y4M (`C420`) for Chromium's fake capture plus a JSON ground
      truth (pose per frame); output in `tests/out/` (gitignored).

## WS-D Detector (`src/detect/`)

- [ ] **D1 Threshold + candidates**: decimation, tile threshold, border
      following, Douglas–Peucker, quad filters (ARCHITECTURE.md §4.1 steps 1–3).
      _Accept_: on synthetic boards (or local test images until S1 lands) every
      tag's quad is found for ≥ 3 px/cell, tilt ≤ 60°; no crash on all-black,
      all-white, 1 × 1, odd sizes; buffers reused across calls (no allocation
      after warm-up, checked by a test hook).
- [ ] **D2 Edge refinement** (step 4). _Accept_: clean renders (blur 0.8 px, no
      noise, ≥ 5 px/cell, tilt ≤ 50°) corner RMS ≤ 0.1 px, max ≤ 0.25 px;
      noise 3 DN + blur 1.2 px: RMS ≤ 0.3 px. Ground truth from
      `projectBoardCorners`.
- [ ] **D3 Decode + order** (steps 5–7) incl. `src/detect/decode.ts` matcher.
      _Accept_: all four in-plane rotations give the right ID and corner order
      (TL, TR, BR, BL); up to 2 flipped data cells decode to the right ID, 3
      don't decode at all; tags ≥ 3 px/cell, tilt ≤ 60°: ≥ 99 % detected,
      **100 % correct IDs**.
- [ ] **D4 False positives**: 1000 clutter frames (distractors, tags with IDs
      not on the board, random tag-like squares) → **0** detections of board IDs
      in CI; `pnpm test:long` runs 10 000. Tune `minContrast` and border checks
      only with these tests.
- [ ] **D5 Performance** (batch 2): `tests/bench/detect.bench.ts`; report the
      median for 1280 × 720 with 15 tags on M-series (target ≤ 4 ms). Optimise
      only measured hot spots; if far over, propose ROI tracking or WASM SIMD in
      the report instead of doing it.

## WS-P Pose & maths (`src/math/`, `src/pose/`)

- [x] **P1 Maths + frames**: small linear algebra (3×3/4×4 ops, Jacobi SVD for
      3×3 and small symmetric eigen, Cholesky ≤ 9×9, homography DLT with
      Hartley normalisation), `src/pose/frames.ts` (CV ↔ GL, inversions),
      `projectionFromIntrinsics` (§2.6). _Accept_: identities to 1e-12;
      projection matrix matches pinhole `u, v` to 1e-9 px; DLT exact on exact
      data, stable for nearly degenerate (collinear-ish) inputs (no NaN).
- [ ] **P2 IPPE + LM**: §5.2–5.3. _Accept_: exact correspondences recover the
      pose to 1e-6 mm / 1e-6°; 12-tag A4 board at 40 cm, tilt 20–50°, corner
      noise σ = 0.15 px: camera position RMS ≤ 0.5 mm, rotation ≤ 0.1°, overlay
      error of a point 100 mm above the board centre (difference of its
      projections under true and estimated pose, in mm at its depth)
      ≤ 0.3 mm RMS.
- [ ] **P3 Ambiguity**: single 40 mm tag at 30 cm, tilt ≥ 20°, σ = 0.15 px,
      previous pose = truth perturbed by 2°: correct branch ≥ 99 %; overlay
      error on the board ≤ 1 mm.
- [ ] **P4 Outliers**: §5.4. _Accept_: one board tag displaced 20 mm in the
      board data and one fake detection with random corners → both in
      `rejectedTagIds`, pose still meets P2; deterministic; ≤ 1 ms for 15 tags
      on M-series.
- [ ] **P5 Filter**: §5.6 One Euro + jump gating + loss. _Accept_: static pose
      with σ = 1 mm / 0.2° noise → output RMS ≤ 0.3 mm / 0.06°; 100 mm/s
      constant motion → steady lag ≤ 20 ms; a 30 mm one-frame spike is ignored;
      a persisting jump is taken after 3 frames.
- [ ] **P6 Focal self-calibration** (batch 2): §5.5. _Accept_: 20 views tilt
      20–60°, σ = 0.3 px: f within 0.3 %; 3 views: within 1 %; fronto-parallel
      only views → no estimate; accept/limit/jump rules unit-tested; prior from
      `fovPriorDeg` correct for portrait and landscape.

## WS-C Camera, worker, tracker, demo

- [ ] **C1 Camera**: constraints, lens selection as a pure function of
      (platform, devices, capabilities) → decision (§6.1), `listCameras`, error
      mapping to codes (§6.4). _Accept_: unit tests for iOS virtual/pinned,
      Android `camera2 N`, deviceId override, unknown platforms.
- [ ] **C2 Frame path**: rVFC loop, one frame in flight, `VideoFrame` →
      gray for planar YUV and RGB formats with stride/offset, rotation; canvas
      fallback (§6.2). _Accept_: pure conversion functions tested on synthetic
      buffers of each format and rotation; backpressure test (never > 1 in
      flight).
- [ ] **C3 Worker + tracker**: protocol (§6.3), lifecycle (§6.4), inline mode,
      events (§8). `processFrame` takes injected detect/pose functions until I1.
      _Accept_: unit tests with a fake worker and fake processor; visibility/
      mute pause and resume; restart after `ended`.
- [ ] **C4 Demo app** (`demo/`, Vite + basic-ssl): Print board, Start, axes +
      a 50 mm cube on the board, debug HUD with the DEVICE-TESTS fields (camera
      label + all labels, lens, fps, worker ms, err px, jitter mm, f + source),
      `?inline`, `?debug`. _Accept_: `pnpm dev` serves it over HTTPS and
      `pnpm demo:build` builds.
- [ ] **C5 e2e harness**: `playwright.config.ts` (Chromium, fake camera from
      S2's Y4M), `tests/e2e/demo.spec.ts`. _Accept_: demo starts with the fake
      camera and emits pose events; no requests outside the page origin; no
      request bodies.

## WS-3 three.js adapter (`src/three/`)

- [ ] **T3-1 Camera sync**: `MatarThree.update()`, mm → m, projection with
      the cover crop (§7.1, §7.3). _Accept_: a board point projects to the same
      canvas pixel through three's camera as through the pinhole model + crop
      (1e-6 px) for portrait/landscape canvases and frames.
- [ ] **T3-2 Texture ring + background modes** (§7.2). _Accept_: with a fake
      renderer, result N always shows texture N; `live` and `none` modes.
- [ ] **T3-3 Taps**: `pointerToNdc`, `raycaster`. _Accept_: tapping the
      projection of a board point gives a ray through it (1e-6 mm).

## Batch 3: integration (lead)

- [ ] **I1 Wire the worker**: `processFrame` = detect → pose → focal; tracker
      uses the real worker; `src/index.ts` exports per §8.
- [ ] **I2 e2e accuracy**: with S2's path, poses within 2 mm / 0.5° of ground
      truth after the first second (end-to-end through Y4M compression).
- [ ] **I3 Size**: `.size-limit.json`; `pnpm size` passes (core + worker ≤ 35 KB,
      three ≤ 8 KB min+gzip).
- [ ] **I4 Release v0.1.0**: README usage, CHANGELOG, `pnpm pack` tarball for
      integrators; tag `v0.1.0`.

## Device (maintainer)

- [ ] **DV1** DEVICE-TESTS smoke test on one iPhone (Safari) and one Android
      phone (Chrome); rows recorded. Results feed back into RESEARCH.md
      (camera labels, fps, EIS crop, timings) and the filter defaults.

## Later (not v0.1)

ROI tracking · WASM SIMD stages · worker-side `MediaStreamTrackProcessor` ·
principal point and k1 in the focal bundle · per-tile offset estimation for
tiled boards · gravity to break the planar ambiguity · more families.
