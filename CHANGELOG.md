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
- The detector's adaptive threshold is halfway between the local extrema in linear
  light (`edgeGamma`), not in encoded gray values. Under motion blur longer than about
  one tag cell, the blurred black borders used to fall above the threshold and whole
  frames lost every tag (moving the phone on the second Android test). With 9 px
  cells and 12–14 px of blur, 31 of 32 tags are found (was 16; in a full 720 × 1280
  demo-board frame at 12 px, 15 of 16, was 0). Same speed. In dark, low-contrast tiles
  (within 24 DN of white) it keeps the encoded midpoint, so noisy dim frames do as
  before.
- The detector's `'auto'` decimation switches to ×2 from 5 px cells (was 8 px);
  ×2 still finds 99.6 % of tags at 3–4 px/cell.
- `'auto'` decimation skips its full-resolution search every 8th frame while the
  previous frame found every ID looked for: there is no small tag left to find, and
  that frame was the slowest in eight (benchmark close-up p99 4.9 → 3.5 ms).
- The tracker grabs a frame that came while the worker was busy once the result is
  back, if the video still shows that frame (`VideoFrame.timestamp` matches the
  frame callback's `mediaTime`; `videoframe` path). Camera frames presented 16.7 ms
  apart on a 60 Hz screen were dropped whenever the worker took longer than that,
  the likely cause of 26.8 analysed fps from a 29.9 fps camera on the second
  Android test. Still one frame in flight.
- Pose consensus (`estimatePose`): a second, relaxed pass when the strict one
  (every corner within `inlierPx`) leaves tags out. A tag agrees with a tag pair
  there when its shift (the mean of its corner errors) is within `inlierPx` and
  every corner within 3 × `inlierPx`; its set is used if larger and either the
  strict set has under half the tags or the relaxed set's tags don't lie along
  one line.
  Motion blur longer than a tag cell stretches every tag along the motion while
  it barely shifts, so blurred frames split into small consensus sets. At 16 px
  of blur (9 px cells) 5 of 11–13 tags were kept and the camera was 26–58 mm and
  3–8° off; now all are kept and it is within 3.1 mm and 0.4°. The relaxed test
  alone kept a misprinted tag when the tags in view lay along one line (up to
  765 mm off); the two passes are as safe there as the strict test.
- `MatarThree` (`pose: 'raw'`): a raw pose more than 20 mm or 5° from the last
  raw poses extrapolated to its time is drawn like a frame without a pose and
  adds nothing to the velocity; the third in a row restarts the motion there (the
  filter's jump gate, which raw mode bypassed). A frame where blur left 1–3
  badly placed tags no longer throws the content off for a frame. A bad first or
  second pose doesn't set the velocity that judges the next ones, and a new
  orientation or a tracker stop, pause or restart starts a new motion.
- Demo HUD: per-stage worker timings and the delay since the frame; refreshed 5×
  a second instead of every frame.

### Fixed

- Android: the lens rule (use the lowest-numbered back camera) works with current
  Chrome's labels, `camera N, facing back`. It only matched the older `camera2 N, …`,
  so on Chrome 155 the tracker kept whichever back camera `facingMode` opened (on the
  test phone `camera 2`, which the demo's `fit` line puts at an 83–87° long side,
  against the 68° prior) and reported `lens: 'unknown'`. Infrared back cameras
  (`…, infrared`) are skipped.
- `tracker.stop()` during `start()`: `start()` no longer hangs when stopped while
  waiting for the worker's `ready`, and no longer starts a worker or reports a camera
  error when stopped while `video.play()` was pending.
- `tracker.setBoard()` with a frame in flight: that frame's result, solved for the
  old board, is no longer published as a pose.
- `tracker.stop()` from a `grab` listener no longer throws; the grabbed frame is
  closed instead of sent.
- `tracker.start()` from a `'stopped'` state listener restarts cleanly (the event now
  fires after the teardown), and `stop()` from a `worker-failed` listener no longer
  starts the inline fallback anyway.
- A camera reacquire (a track that ended in the background) still pending across
  `stop()` and `start()` no longer replaces the new camera and leaks its stream.
- Focal self-calibration up close: a keyframe's homography fit now qualifies under
  1 px **or** under 1 mm on the paper (new `FocalEstimatorOptions.maxFitRmsMm`; the
  mm from the corners' image scale, their spread in the image over that on the
  board). Up close a pixel is less paper: on a phone at 291 mm and 47–54° tilt the
  fits were 1.1–1.5 px and no frame qualified, so a fresh start there kept the 68°
  prior. In the synthetic tests with σ 1–1.4 px at 230–300 mm, 0 of 150 runs
  calibrated before and 150 of 150 now (f error median 0.13–0.2 %, max 2.2 %).
- Focal self-calibration from one angle: a prior more than 10 % off is replaced by the
  median of 5 consecutive good frames that agree within 5 %. This is the jump rule,
  which only ran after acceptance; it now runs in every state (inside [0.7, 1.4] ×
  the reference until accepted), so a lens switch back right after a jump is
  followed too. Accepting still needs 3 viewing directions 10° apart, which needs
  the phone moved round the board; held at one angle, a phone stayed on its prior
  20 % short (err 3.4 px against 0.64 px with the right focal length).

### Added

- `MatarThree` `background: 'live'`: the newest camera frame with the pose
  extrapolated to it, for the lowest latency (demo: `?bg=live`).
- Demo: after Start, **Mode** switches between `frame` and `live` without a reload,
  and **Copy report** copies the last 5 s of timings (fps, per-stage worker times,
  how old the background and the pose are at render, spacing of the analysed frames,
  runs of frames without a pose, time in the `grab` event, where the camera was:
  height above the paper and tilt, how fast the board moved in the image and the
  camera's reported exposure (so the motion blur in px), tags found and used, the
  corner error by distance from the image centre, and the focal length that fits
  tilted frames best, and the camera list) for device-test notes. `?fov=` sets the
  long-side field of view the tracker starts from; `?exposure=` (ms) tries a manual
  exposure time on the camera, the ISO scaled to keep the brightness or set with
  `?iso=` (an experiment against motion blur; the library itself leaves exposure
  alone). The demo saves the focal length the tracker measures in `localStorage`
  under the camera's label and starts the next time from it on that camera
  (`TrackerOptions.intrinsics`, `camera.deviceId` looked up by label), so the
  calibration isn't redone on every load; `?fresh` forgets it. The report shows the
  URL options, where the focal length came from, (`calib`) how many frames pass
  each keyframe rule of the self-calibration (in the window and since Start), the
  time to the first estimate, and the `err` in mm on the paper.
- Demo hosting on Vercel: `vercel.json` (build `pnpm demo:build`, serve `demo/dist`,
  immutable hashed assets) and `.vercelignore` (upload only what the build reads).
  `MATAR_DEMO_URL=<url>` points the demo e2e at a deployed copy.

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
