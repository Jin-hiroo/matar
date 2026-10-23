# matar — Spec (the "what")

## 1. Purpose

Put AR content on a **printed paper mat** in a phone's web browser, on iPhone
and Android alike, with nothing to install and a small, predictable download.

The mat ("board") carries square ID tags at known positions. The library:

1. opens the rear camera,
2. finds the tags in each video frame,
3. computes the camera's pose relative to the board,
4. hands that pose (and matching camera projection) to the renderer, so content
   drawn in board coordinates lines up with the paper.

Because the tags are printed by the consumer, the library never has to recognise
anything natural: no SLAM, no feature matching, no models to download.

## 2. Who uses it

- **Integrators** (app developers): describe a board as data, generate the
  printable tags, start a tracker, render with three.js (or anything else).
  ExhibitAR is the first integrator.
- **Viewers** (end users): open a web page on a phone, allow the camera, point it
  at the mat. One permission prompt, no other steps.
- **Printers** of the mat: get an SVG/PDF from the integrator's app. They need
  to print at 100 % scale (see §7).

## 3. Features (v0.1)

| ID  | Feature                               | Notes                                                                                                                                                                                                                                          |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **Tag family + board model**          | One built-in tag family: AprilTag **tag36h11** (ARCHITECTURE.md §3). A board is a list of `{ id, centerMm, sizeMm, rotationDeg }` on the paper plane. Boards may span several printed pages (tiling); the library only sees tag positions.     |
| F2  | **Board layout helper**               | A border ring of tags filling the edge band of a rectangle on the page (8 mm margin, 1-cell gaps, corners shared, evenly spaced); an inner ring around the object by a second call; rectangular keep-outs drop tags; seeded unique IDs.        |
| F3  | **Print output**                      | SVG of a single tag (to embed in the integrator's own artwork) and SVG of a whole test board with a 100 mm ruler and an ID-1 card outline for the print-scale check. Exact mm units. `scaleBoard()` applies a measured print-scale correction. |
| F4  | **Camera**                            | Start/stop the rear main camera at 1280×720, pin one lens where the platform allows it (iOS's default rear device switches lenses up close), list cameras for an app-side picker, handle permission errors, pause when hidden or muted.        |
| F5  | **Detection**                         | Find tags in each frame inside a Web Worker. Reports ID, four sub-pixel corners, bit errors.                                                                                                                                                   |
| F6  | **Pose**                              | Camera pose relative to the board from all visible tags in one fit. Works with one visible tag; rejects wrong/outlier tags; reports quality (reprojection error, tags used).                                                                   |
| F7  | **Intrinsics**                        | Browsers don't expose focal length. Start from a field-of-view prior, refine focal length automatically from the board, and let the integrator persist/restore it per device.                                                                  |
| F8  | **Smoothing**                         | Low-jitter pose with fast response to real motion (One Euro filter). Configurable.                                                                                                                                                             |
| F9  | **`matar/three`**                     | Video background, a `PerspectiveCamera` whose projection matches the real camera (cover crop included), and the pose applied to the camera. The overlay is drawn on the same video frame that was analysed (no "swimming").                    |
| F10 | **Debug data**                        | Every `pose` event carries detections, reprojection error, fps, per-stage timings, focal length and its source, and the camera label. Drawing them is up to the app; the demo HUD shows how.                                                   |
| F11 | **`matar/testing`**                   | Synthetic renderer: an image of a board seen from a known camera pose, with blur/noise. Used by our tests, exported for integrators' tests.                                                                                                    |
| F12 | **Demo app** (`demo/`, not published) | Print a test board, track it, show axes + a cube + the debug HUD. Used for device tests.                                                                                                                                                       |

## 4. Public API (shape; ARCHITECTURE.md §8 is normative)

```ts
import { createBoard, layoutBorderTags, pickTagIds, createTracker } from 'matar';
import { MatarThree } from 'matar/three';

const tags = layoutBorderTags({
  areaMm: { x: 0, y: 0, width: 210, height: 297 }, // A4 page
  originMm: [105, 148.5], // board origin at the page centre
  sizeMm: 32,
  ids: pickTagIds('tag36h11', 40, 'my-board'),
});
const board = createBoard({ tags });
const tracker = createTracker({ board, intrinsics: saved ?? undefined });
tracker.addEventListener('pose', (e) => {
  /* e.smoothed (boardFromCamera, mm), e.pose?.rmsErrPx, e.stats … */
});
tracker.addEventListener('intrinsics', (e) => save(e.intrinsics)); // persist per device
await tracker.start(); // asks for the camera; call from a user gesture

const ar = new MatarThree({ tracker, renderer, scene, camera }); // per-frame sync
```

The core never imports three.js. Everything returned is plain data (typed
arrays / numbers). Importing `matar` has no side effects and touches no
browser globals, so it is safe in server-side rendering.

## 5. Budgets (enforced or measured)

| Budget                                  | Target                                                                                                                                       | How checked           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Core bundle (`matar`, incl. worker)     | ≤ 50 KB min+gzip                                                                                                                             | `pnpm size`           |
| `matar/three` (excl. three.js)          | ≤ 8 KB min+gzip                                                                                                                              | `pnpm size`           |
| Runtime network requests by the library | **0** besides its own worker chunk (same origin)                                                                                             | e2e test asserts none |
| Upload                                  | **0 bytes**: frames never leave the device                                                                                                   | code review + e2e     |
| Processing rate                         | ≥ 30 fps at 1280×720 on iPhone 12 / Pixel 7-class                                                                                            | device tests          |
| Worker time per frame                   | median ≤ 12 ms on those devices                                                                                                              | debug HUD             |
| Synthetic accuracy (exact focal)        | corners ≤ 0.1 px RMS clean, ≤ 0.3 px with noise + blur; pose at 40 cm ≤ 0.5 mm, ≤ 0.1°; focal self-calibration ≤ 0.3 % (details in TASKS.md) | synthetic tests       |
| Overlay accuracy on device              | ≤ 2 mm at the board plane, ≤ 3 mm at 10 cm above it                                                                                          | device tests          |
| Jitter (static phone)                   | ≤ 0.5 mm RMS at the board plane after smoothing                                                                                              | device tests          |

## 6. Platforms

- iOS / iPadOS Safari 17+ (and browsers on iOS, which all use WebKit).
- Android Chrome (current stable) and Chromium-based Android browsers.
- Desktop Chrome/Safari/Firefox with a webcam: works, but not a target.
- In-app browsers (LINE, Instagram…): best effort; `getUserMedia` support varies,
  detect and tell the user to open the page in the browser.

See `docs/RESEARCH.md` for the sourced support details.

## 7. Known limitations (documented to users)

- **The board must be in view.** No world tracking: if every tag leaves the frame,
  the pose is lost until one is seen again.
- **Print scale is not observable.** A mat printed at 97 % looks exactly like a
  100 % mat seen from 3 % further away, so the overlay is drawn 3 % off in scale.
  Integrators must tell users to print at 100 % and should put a scale check (a
  ruler of known length) on the mat.
- Glare on glossy paper, very low light and strong motion blur stop detection.
- Lens distortion is assumed corrected by the phone (true for main cameras);
  ultra-wide lenses are not supported. The principal point is assumed at the
  image centre (an offset of 20 px moves content 10 cm above the mat by ≈ 1.3 mm).
- iPhone Pro main lenses can't focus closer than ≈ 15 cm; keep the phone
  ≳ 20 cm from the mat.
- Tiled (multi-page) mats must be aligned to ≲ 1 mm; misalignment shows up as
  overlay error.

## 8. Non-goals (v0.1)

SLAM / world tracking · natural-image or object recognition · WebXR · more than
one board at a time · ultra-wide/fisheye lenses · recording or uploading video ·
React components (integrators wrap the API themselves).
