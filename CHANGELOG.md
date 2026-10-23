# Changelog

All notable changes to matar. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/) (while < 1.0, a minor bump may change the API).

## [Unreleased]

First device test (Android): tracking worked but felt laggy: the cube trailed the
paper and the video lagged behind the camera.

### Changed

- `MatarThree` drives the camera with each frame's own pose by default (`pose: 'raw'`);
  the smoothed pose only bridges frames without one. Content no longer trails the
  paper by the filter's lag. `pose: 'smoothed'` restores the old behaviour.
- `MatarThree` (`pose: 'raw'`): a frame without a pose gets the last two raw poses
  extrapolated to its timestamp instead of the smoothed hold pose, which lags. Content
  no longer jumps for a frame when detection drops out while turning or moving the phone
  (second Android test). With `background: 'live'` those frames no longer feed the
  hold pose into the velocity. A loss or a tracker restart clears the velocity.
- The detector's `'auto'` decimation switches to ×2 from 5 px cells (was 8 px);
  ×2 still finds 99.6 % of tags at 3–4 px/cell.
- `MatarThree` (`pose: 'raw'`): a raw pose more than 20 mm or 5° from the last
  raw poses extrapolated to its time is drawn like a frame without a pose and
  adds nothing to the velocity; the third in a row restarts the motion there (the
  filter's jump gate, which raw mode bypassed). A frame where blur left 1–3
  badly placed tags no longer throws the content off for a frame. A bad first or
  second pose doesn't set the velocity that judges the next ones, and a new
  orientation or a tracker stop, pause or restart starts a new motion.
- Demo HUD: per-stage worker timings and the delay since the frame; refreshed 5×
  a second instead of every frame.

### Added

- `MatarThree` `background: 'live'`: the newest camera frame with the pose
  extrapolated to it, for the lowest latency (demo: `?bg=live`).
- Demo: after Start, **Mode** switches between `frame` and `live` without a reload,
  and **Copy report** copies the last 5 s of timings (fps, per-stage worker times,
  how old the background and the pose are at render) for device-test notes.

## [0.1.0] - 2026-10-20

First version: the whole pipeline works end to end in desktop Chromium with a synthetic
camera. Not yet tested on real phones (docs/DEVICE-TESTS.md).

### Added

- **Tags and boards**: AprilTag tag36h11 (587 IDs); `createBoard`, `layoutBorderTags`
  (border ring, rectangular keep-outs), `pickTagIds` (seeded ID sets), `scaleBoard`
  (print-scale correction), `tagSvg` / `boardSvg` (exact mm, 100 mm ruler, ID-1 card
  outline).
- **Detection** (`createDetector`): adaptive threshold, border following, quad fitting,
  gamma-aware sub-pixel edge refinement, decoding against the board's IDs with up to 2
  corrected bits. Synthetic: 0.01 px corner RMS clean, 0.05 px with noise; 100 % correct
  IDs; 0 false positives in 10 000 clutter frames; 3.8 ms per noisy 1280 × 720 frame on
  an M2 (2.4 ms with the default `'auto'` decimation).
- **Pose** (`estimatePose`): homography + IPPE + Huber LM over all visible tags, tag-pair
  consensus against wrong tags, planar-ambiguity handling for single tags;
  `createPoseFilter` (One Euro, jump gating, loss hold); `createFocalEstimator` (focal
  length from the board, ≤ 0.3 % after 20 views); `projectionFromIntrinsics`.
- **Tracker** (`createTracker`, `listCameras`): rear-camera opening with lens pinning
  (iOS "Back Camera", Android lowest `camera2 N`), a module worker with an inline
  fallback, one frame in flight, `VideoFrame` → gray for YUV and RGB formats with a canvas
  fallback, pause/resume on visibility and mute, re-acquisition after `ended`; `pose`,
  `grab`, `intrinsics`, `state` and `error` events.
- **`matar/three`** (`MatarThree`): camera pose and projection with the cover crop, the
  analysed frame as the background (texture ring), tap rays.
- **`matar/testing`**: `renderBoard` (synthetic camera images with blur, noise, motion
  blur and distractors), camera helpers.
- **Demo** (`pnpm dev`) with a debug HUD; Playwright e2e with a fake camera; bundler smoke
  tests (Next.js 16 Turbopack/webpack, Vite 8); size budgets (core + worker 34 KB
  min+gzip).
