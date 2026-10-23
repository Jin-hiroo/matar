# matar — Research notes

Sourced findings behind the design, as of **2026-10-19**. Check here before
re-researching. Confidence: **high** (spec/compat data/official), **medium**
(code-reading or a single good source), **low**. "Code-reading" means read from
current WebKit/Chromium source, not documented behaviour. **UNVERIFIED** items
need a device test (DEVICE-TESTS.md) before the design relies on them.

Context: iOS 27 / Safari 27 reportedly shipped 2026-09-14 (secondary source);
the Safari 27 beta notes list no getUserMedia features
([webkit.org](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/)).

## 1. Platform: camera, frames, intrinsics, storage, compute

### 1.1 Picking the rear camera

**iOS Safari.**

- `facingMode: 'environment'` opens a **virtual multi-lens device** (Triple on
  Pro iPhones, Dual Wide on two-lens models). WebKit ranks device types
  Triple > DualWide > UltraWide > Dual > WideAngle > Telephoto
  (code-reading, high: [AVVideoCaptureSource.mm](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/AVVideoCaptureSource.mm) `cameraCaptureDeviceTypes()`).
- On those virtual devices WebKit doubles the zoom factor, so `zoom: 1` is the
  wide lens and `zoom` can go down to 0.5 (ultra-wide) (code-reading, high,
  `cameraZoomScaleFactor`). Before iOS 16.4 the default was the ultra-wide view
  ([bug 253186](https://bugs.webkit.org/show_bug.cgi?id=253186)).
- The virtual device **still switches lenses by itself** at close range (macro:
  wide → ultra-wide with a crop). WebKit sets no switching behaviour; still open
  ([bug 262416](https://bugs.webkit.org/show_bug.cgi?id=262416), iOS 17;
  [forum 776460](https://developer.apple.com/forums/thread/776460), iOS 18.3).
  High confidence that switching happens. A 2023 suggestion to use the
  constraint `zoom: false` is **UNVERIFIED**. A lens switch silently changes the
  intrinsics, so it breaks registration.
- The plain wide lens is a separate device, English label "Back Camera"
  (others: "Back Dual Wide Camera", "Back Triple Camera", "Back Ultra Wide
  Camera", "Back Telephoto Camera"; exact 2025–26 strings **UNVERIFIED**).
  **Labels are localised**, so label matching is fragile. One AR vendor
  reported (2023) that after permission the 2nd `videoinput` was always the
  right rear camera (medium-low, [253186 c13](https://bugs.webkit.org/show_bug.cgi?id=253186)).
- Pinning the plain wide lens costs close focus: on Pro iPhones it can't focus
  closer than ≈ 15 cm (same bug). Users should stay ≳ 20 cm from the mat.

**Android Chrome.**

- Each Camera2 camera is listed separately, labelled `"camera N, facing back"`
  (N: the position in `getCameraIdList()`; `, infrared` appended for NIR
  sensors; not localised; code-reading, high:
  [VideoCaptureCamera2.java](https://chromium.googlesource.com/chromium/src/+/main/media/capture/video/android/java/src/org/chromium/media/VideoCaptureCamera2.java)
  `getName`, read 2026-10-23; Chrome 155 on Android reports `camera 2, facing
back`, DEVICE-TESTS.md). Older Chrome wrote `"camera2 N, facing back"`. The lowest-numbered back camera is usually the main one; some
  phones expose one logical multi-camera that may switch lenses (**UNVERIFIED**
  per OEM).
- `facingMode` can't pick a specific lens
  ([Twilio](https://www.twilio.com/en-us/blog/choosing-cameras-javascript-mediadevices-api-html)).

### 1.2 Getting frames to a worker

| Feature                        | Chrome / Android                                  | iOS Safari                                                              | Source                                                                                                     |
| ------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `MediaStreamTrackProcessor`    | 94; `Exposed=Window` only, track not transferable | 18; `Exposed=DedicatedWorker` **only**, `MediaStreamTrack` transferable | [BCD](https://github.com/mdn/browser-compat-data/blob/main/api/MediaStreamTrackProcessor.json), IDL (high) |
| `VideoFrame`, `copyTo()`       | 94                                                | 16.4; transferable; constructor accepts `HTMLVideoElement`              | BCD, IDL (high)                                                                                            |
| `copyTo({ format: 'RGBA' })`   | 127                                               | no                                                                      | BCD (high)                                                                                                 |
| `VideoFrame.rotation` / `flip` | 138                                               | no                                                                      | BCD (high)                                                                                                 |
| `requestVideoFrameCallback`    | 83                                                | 15.4 (optional `captureTime`; filled for camera? **UNVERIFIED**)        | BCD, IDL                                                                                                   |
| `OffscreenCanvas`              | 69                                                | 2D 16.4, WebGL 17, `willReadFrequently` 18                              | BCD (high)                                                                                                 |
| `ImageCapture.grabFrame`       | 59                                                | 26                                                                      | BCD (high)                                                                                                 |

- WebKit captures camera pixels as `420YpCbCr8BiPlanarFullRange` (NV12, full
  range): the **Y plane is already full-range luma**, so `VideoFrame.copyTo()`
  gives the gray image with no conversion (code-reading, high:
  [RealtimeVideoUtilities.h](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/platform/mediastream/cocoa/RealtimeVideoUtilities.h)).
  No GPU readback is involved; the copy is likely a plain memcpy (medium).
- Android camera frame format (I420 vs NV12) and `copyTo` speed: **UNVERIFIED**.
  Either way the Y plane comes first.
- Transferring `processor.readable` from the main thread to a worker works in
  Chrome but is non-standard
  ([Mozilla](https://blog.mozilla.org/webrtc/unbundling-mediastreamtrackprocessor-and-videotrackgenerator/)).
- **Avoid canvas readback.** Safari's fingerprinting protection made
  `drawImage` + `getImageData` on camera frames ≈ 600 ms vs 10 ms (fixed in
  trunk Nov 2023 / Jan 2024: [263129](https://bugs.webkit.org/show_bug.cgi?id=263129),
  [266181](https://bugs.webkit.org/show_bug.cgi?id=266181)), and Safari 26 turns
  Advanced Fingerprinting Protection on in normal browsing, targeting 2D canvas
  reads by "known fingerprinting scripts"
  ([Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
  Synchronous WebGL `readPixels` also stalls (PBO + `fenceSync` ≈ 3× faster,
  2022: [235002](https://bugs.webkit.org/show_bug.cgi?id=235002)).
- **Orientation**: width/height swap with how the phone is held, and
  `getSettings()` can report landscape while frames are portrait (iOS 26.6,
  [forum 844826](https://developer.apple.com/forums/thread/844826)). Read the
  size from each frame (`codedWidth`/`codedHeight`, `visibleRect`,
  `displayWidth`/`displayHeight`), and on Chrome 138+ also `rotation`.

### 1.3 Intrinsics

- **No web API exposes focal length or FOV** (`MediaTrackSettings`,
  capabilities, `ImageCapture`). The W3C `focalLength` proposal (2020) met
  objections and wasn't adopted ([w3 list](https://lists.w3.org/Archives/Public/public-webrtc-logs/2020Jan/0077.html)).
  WebXR raw camera access needs an ARCore session (out of scope). High.
- iPhone 12 Pro Max wide camera, from `videoFieldOfView`
  ([zenn](https://zenn.dev/yorifuji/scraps/bc52d2e4601de0), medium):
  1280×720 and 1920×1080 → **68.16° horizontal** (from a 4096×2304 sensor
  region); 4:3 formats 67.10°; 1080p120 37.6° (heavy crop: avoid high-fps
  formats). 16:9 is not a crop of 4:3. Newer 24 mm Pro main cameras probably
  ≈ 70–73° (**UNVERIFIED**).
- Android (arithmetic from vendor diagonal FOV, medium-low): Pixel 9 wide
  82° diag → ≈ 69.6° horizontal; Galaxy S25 85° / 24 mm → ≈ 72.5°.
- Android, measured (one phone, model hidden by the reduced UA; Chrome 155,
  720×1280; DEVICE-TESTS.md 2026-10-23): `camera 0` self-calibrated to
  1132–1134 px, a **59° long side**; `camera 2` (what `facingMode` opened)
  fits ≈ 699 px, 85°. The main camera at 59° fits an EIS crop of ≈ 16 %
  from ≈ 68° (**UNVERIFIED**: the phone's uncropped FOV is unknown).
- **Stabilisation**: Chromium enables video stabilisation (EIS) on Android
  whenever available (code-reading, high), so the effective FOV is narrower by
  an **UNVERIFIED** crop. WebKit sets no stabilisation mode (AVFoundation default
  off), so iOS frames are probably uncropped (code-reading, medium). Center Stage
  is front-camera only ([Apple](https://support.apple.com/en-us/111102)).
- ⇒ Prior ≈ **68° ± 6° horizontal (long side) for 16:9**, then self-calibrate.
  A coplanar multi-tag target fixes f given a centred principal point.

### 1.4 Constraints

- **Safari** (WebKit IDL, high:
  [MediaTrackConstraints.idl](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/Modules/mediastream/MediaTrackConstraints.idl)):
  width, height, aspectRatio, frameRate, facingMode, deviceId, whiteBalanceMode,
  **zoom** (works from 17.4, [STRICH](https://strich.io/blog/posts/whats-new-in-strich-111/)),
  **torch** (≈ 17.5; iOS 18 `getSettings` bug fixed Dec 2024,
  [280970](https://bugs.webkit.org/show_bug.cgi?id=280970)), backgroundBlur,
  powerEfficient (binned format). `focusDistance` capability is read-only (min =
  minimum focus distance). **No** focusMode/exposureMode/focusDistance
  constraints. Autofocus left at the AVFoundation default (continuous?
  **UNVERIFIED**).
- **Possible Safari fps trap** (code-reading, low-medium): WebKit keeps only the
  first format per resolution; on the 12 Pro Max those 720p/1080p formats top
  out at 30 fps, so 60 fps may be unattainable, and asking for it may lower the
  resolution instead.
- **Chrome Android**: continuous autofocus (`CONTINUOUS_PICTURE`) and EIS on by
  default (code-reading, high); zoom from Chrome 87; torch/focusMode/
  focusDistance/exposureMode via Image Capture extensions (versions
  **UNVERIFIED**).

### 1.5 iOS gotchas

- `<video playsinline muted autoplay>` + `play()`; camera-backed video
  autoplays while capturing. HTTPS required; iframes need the same secure origin
  all the way up; one capturing tab at a time
  ([webkit.org 7763](https://webkit.org/blog/7763/a-closer-look-into-webrtc/), high).
- Camera permission is per site (Ask/Allow/Deny). Home Screen apps re-prompt
  after hash navigation and cold starts
  ([215884](https://bugs.webkit.org/show_bug.cgi?id=215884), high). Grant lifetime
  in a normal tab: **UNVERIFIED**.
- Low Power Mode caps `requestAnimationFrame` at **30 fps** on purpose
  ([215745](https://bugs.webkit.org/show_bug.cgi?id=215745), high). Camera fps
  under Low Power Mode and thermal behaviour (frame-rate drop / track mute):
  **UNVERIFIED**.
- No documented memory limit; tabs can be killed without `webglcontextlost`
  ([300782](https://bugs.webkit.org/show_bug.cgi?id=300782)); unrecoverable
  context loss reported on iOS 18 ([289601](https://bugs.webkit.org/show_bug.cgi?id=289601), medium).
- In-app browsers: WKWebView has getUserMedia since iOS 14.3; Instagram,
  Facebook, Messenger, Snapchat, LINE work on iOS
  ([Zappar](https://www.zappar.com/blog/zappar-webar-now-supported-social-media-apps-and-third-party-browsers-with-iOS-14-3/),
  [8th Wall](https://8thwall.com/docs/getting-started/requirements),
  [zenn](https://zenn.dev/uezo/articles/aa9cbb539111e4)). Android in-app
  browsers often need an "open in browser" link-out. `MediaStreamTrackProcessor`
  in third-party WKWebViews: **UNVERIFIED**. The Camera app's QR banner opens the
  default browser (medium).

### 1.6 Device motion (not used in v0.1)

`DeviceMotionEvent.requestPermission()` (iOS 13+) needs HTTPS and a user
gesture, and fails if a worker round trip is awaited first
([269706](https://bugs.webkit.org/show_bug.cgi?id=269706), high). ≈ 60 Hz; check
`event.interval`. No documented alignment of sensor and camera timestamps, so
only useful for short rotation prediction between frames (medium).

### 1.7 Offline caching (integrator concern; informs SPEC "predictable data")

- **Safari 17+** ([webkit.org 14403](https://webkit.org/blog/14403/updates-to-storage-policy/), high):
  per-origin quota up to 60 % of disk in browser apps, 15 % in other apps
  (in-app browsers); Home Screen apps same as Safari; eviction deletes whole
  origins, least recently used first; `persist()` exists, granted by heuristics
  (e.g. opened as a Home Screen web app).
- **7-day rule**: in a Safari tab, all script-writable storage **including
  service worker registrations and the Cache API** is deleted after 7 days of
  Safari use without interaction with the site; Home Screen apps keep their own
  counter, reset on use ([webkit.org 10218](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), high).
  Whether `persist()` exempts a site: **UNVERIFIED**.
- Safari 26: any site added to the Home Screen opens as a web app by default,
  no manifest needed ([Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- **Chrome**: up to 60 % of disk per origin, 80 % total; LRU eviction;
  `persist()` granted silently from engagement/installation/bookmark/
  notification permission ([web.dev](https://web.dev/articles/storage-for-the-web), high).
- Most reliable "download once": versioned, immutable URLs pre-cached in the
  Cache API **and** served with long-lived `immutable` HTTP cache headers (the
  HTTP cache is outside WebKit's script-storage policy), plus `persist()`, plus
  an Add-to-Home-Screen prompt on iOS. Expect a Safari tab to lose the cache
  after 7 days without a visit.

### 1.8 Compute

- **WASM SIMD**: Safari 16.4+, Chrome 91+. Relaxed SIMD not in Safari ≤ 26.5
  ([caniuse](https://caniuse.com/wf-wasm-simd-relaxed), high).
- **WASM threads** need `SharedArrayBuffer` → COOP + COEP `require-corp`; Safari
  has no COEP `credentialless` (BCD, high). Too much burden on embedding pages:
  not used (core idea 2).
- **WebGPU**: iOS 26 (also in workers); Chrome Android 121+ on Android 12+ with
  Qualcomm/ARM GPUs ([Chrome blog](https://developer.chrome.com/blog/new-in-webgpu-121));
  compatibility mode for older GPUs in Chrome 146 (medium). Readback latency
  and Safari stalls make it a poor fit for 30 fps tag detection.
- Estimate (**UNVERIFIED**): single-threaded TS/WASM-SIMD tag detection fits well
  inside 33 ms for 720p gray on 2022+ phones. v0.1 is plain TypeScript; WASM
  SIMD only if device numbers miss the budget.

### 1.9 Device tests these findings ask for

60 fps availability on iPhone · Android frame format and `copyTo` speed ·
Android EIS crop size · effect of `zoom: false` on iOS · iOS autofocus default
and Low Power Mode camera fps · whether `persist()` beats the 7-day rule ·
`MediaStreamTrackProcessor` in in-app WKWebViews · which device the camera
picker chooses and whether it lens-switches at 15 cm · whether WebGL uploads
from `<video>` honour `VideoFrame.rotation` on Chrome 138+.

## 2. Tag families, detection, pose

Numbers marked "own analysis" come from scripts run during the research
(minimum Hamming distances computed from the source tables over all four
rotations, matching OpenCV's built-in values; Monte-Carlo pose simulations with
f = 1004.6 px (1280 px, 65° HFOV), an A4 mat with 12 × 30 mm tags, 2000 trials).
They weren't committed; re-derive before relying on a digit.

### 2.1 Tag family

False positives per random quad ≈ 4·N·Σ_{i≤t} C(n, i) / 2ⁿ for N codes in use,
n bits, t corrected bits.

| Family                         | Bits | Min Hamming | Codes    | Cells across (total / black square)      | FP / random quad, N = 40     |
| ------------------------------ | ---- | ----------- | -------- | ---------------------------------------- | ---------------------------- |
| AprilTag tag16h5               | 16   | 5           | 30       | 8 / 6                                    | t=0: 1.8e-3, unusable        |
| AprilTag tag25h9               | 25   | 9           | 35       | 9 / 7                                    | t=1: 1.1e-4; t=2: 1.4e-3     |
| **AprilTag tag36h11**          | 36   | **11**      | 587      | **10 / 8**                               | t=1: 8.6e-8; **t=2: 1.6e-6** |
| AprilTag tagStandard41h12      | 41   | 12          | 2115     | 9 / **5** (data ring outside the border) | t=2: 6.3e-8                  |
| ArUco 4X4_50 / 4X4_100         | 16   | 4 / 3       | 50 / 100 | 6 + quiet zone                           | t=0: 2.4e-3, reject          |
| ArUco 5X5_100                  | 25   | 7           | 100      | 7 + quiet zone                           | t=1: 1.2e-4                  |
| ArUco 6X6_50 / ARUCO_MIP_36h12 | 36   | 13 / 12     | 50 / 250 | 8 + quiet zone                           | ≈ 36h11 at same t            |

- Measured on tag-free real images: tag36h11, t = 2, all 587 codes: 6 false
  detections in 13.6 M quads = 4.4e-7 per quad, below the 5.7e-6 theory
  ([Wang & Olson 2016](https://april.eecs.umich.edu/media/pdfs/wang2016iros.pdf));
  tagStandard41h12: 0 FPs at t ≤ 1, 4 at t = 2 in 6.09 M quads
  ([Krogius 2019](https://april.eecs.umich.edu/media/pdfs/krogius2019iros.pdf),
  Table I). AprilTag's complexity rule keeps real FPs below the random-bit theory
  ([Olson 2011](https://april.eecs.umich.edu/media/pdfs/olson2011tags.pdf)).
- Busy table estimate (~100 clutter quads/frame at 30 fps, a guess): 36h11 with
  40 codes at t = 2 ≈ one random FP per ~3.5 min before any board-consistency
  check; t = 1 ≈ one per hour. The pose consensus (§2.4) removes them. 4×4
  dictionaries would give several per second.
- **Size**: f = 1004.6 px gives 1.67 px/mm face-on, 1.18 at 45° tilt, 0.84 at
  60°, at 60 cm. ≈ 3 px/cell is the decoding floor, 4–5 px/cell the target with
  motion blur (engineering estimate, **UNVERIFIED** on phones). A **32 mm black
  square** (4 mm cells; 40 mm with the white ring) gives 6.7 / 4.7 / 3.3 px per
  cell face-on / 45° / 60° at 60 cm.
- **Choice: tag36h11** (medium-high): its black square is 80 % of the tag
  width (41h12: 56 %), so longer edges for line fits; 41h12 recall drops at high
  decimation (Krogius); supported everywhere (AprilTag 3, OpenCV
  `DICT_APRILTAG_36h11`, ROS, Unity), so other detectors can cross-check ours.
  ArUco 6X6_50 would be an equal geometric alternative.

### 2.2 Licences

- **AprilTag 3 library and code tables: BSD-2-Clause**, "Copyright (C)
  2013-2016, The Regents of The University of Michigan", plus a "views and
  conclusions" paragraph; every `tag*.c` carries it
  ([LICENSE.md](https://github.com/AprilRobotics/apriltag/blob/master/LICENSE.md)). High.
- **Table source**: [`tag36h11.c` @ a29f685f](https://github.com/AprilRobotics/apriltag/blob/a29f685ff40564e951f3ea276e518e7d541cdd05/tag36h11.c)
  (last changed 2021-03-08; repo HEAD `b7c0ebe9`, 2026-08-07):
  `codedata[587]` starting `0x0000000d7e00984bUL`, bit positions in
  `bit_x[]`/`bit_y[]`, `nbits=36`, `h=11`, `width_at_border=8`,
  `total_width=10`, `reversed_border=false`.
- Copying into Apache-2.0 code is fine: keep the BSD-2 notice in the file
  header and in `THIRD_PARTY_NOTICES` (BSD-2 clause 2 covers bundled builds,
  so the header is a `/*! @license */` comment that minifiers keep).
- Reference images: [apriltag-imgs](https://github.com/AprilRobotics/apriltag-imgs),
  BSD-2. [apriltag-generation](https://github.com/AprilRobotics/apriltag-generation):
  no top-level LICENSE, files carry the same UMich BSD-2 header.
- **OpenCV ≥ 4.5 aruco/objdetect: Apache-2.0** (4.x; the old 3.4 contrib copy
  was BSD-3). Its `DICT_APRILTAG_*` tables come from AprilTag (credit UMich too).
  IPPE port [`ippe.cpp`](https://github.com/opencv/opencv/blob/4.x/modules/calib3d/src/ippe.cpp)
  is BSD-3 by Toby Collins.
- **Original ArUco (Univ. of Córdoba): GPLv3** "for personal, research and
  educational purposes", commercial on request
  ([UCO](https://uco.es/investiga/grupos/ava/portfolio/aruco)); SourceForge's
  "BSD" applies to old versions. **Never copy.**
- js-aruco / js-aruco2: MIT, but LICENSE.txt also bundles old ArUco BSD,
  old OpenCV BSD and AForge.NET LGPLv3; js-aruco's `svd.js` says it's from
  "Numerical Recipes in C" (restrictive licence): **don't copy it**. js-aruco2's
  ARTag/ARToolKitPlus/Chilitags tables have mixed licences. AR.js is MIT but
  its tracking is ARToolKit (LGPLv3 + static-linking exception).
- Generating our own table (Olson 2011 lexicode, rotations checked, low-
  complexity patterns rejected) is possible but loses interoperability; not
  worth it given the trivial BSD-2 notice. Whether code tables are
  copyrightable at all: **UNVERIFIED** (legal question; complying sidesteps it).

### 2.3 Detector

- **ArUco-style** (OpenCV defaults,
  [aruco_detector.hpp](https://github.com/opencv/opencv/blob/4.x/modules/objdetect/include/opencv2/objdetect/aruco_detector.hpp)):
  adaptive threshold windows 3/13/23, C = 7; contours → polygon approximation
  ε = 0.03 × perimeter; min perimeter 3 % of the image; unwarp at 4 px/cell,
  0.13-cell margin ignored; **corner refinement off by default**. OpenCV itself
  calls ArUco corner accuracy "not too high, even after applying subpixel
  refinement" ([ChArUco tutorial](https://github.com/opencv/opencv/blob/4.x/doc/tutorials/objdetect/charuco_detection/charuco_detection.markdown)).
  Simple: js-aruco's whole `cv.js` is ~750 lines.
- **AprilTag 3** ([apriltag.c](https://github.com/AprilRobotics/apriltag/blob/master/apriltag.c)):
  `quad_decimate = 2` (point sampling); threshold (max + min)/2 over 4 × 4 px
  tiles with a 3 × 3 tile neighbourhood, contrast < 5 ignored; union-find →
  gradient clusters → line-fit quads (heavy: `apriltag_quad_thresh.c` is 63 KB);
  `refine_edges`: on the full-res image search ±(decimate + 1) px along each
  edge normal at 4 steps/px, weight gradient², drop wrong-sign gradients, fit
  lines, intersect; decoding with bilinear cell sampling, 0.25 Laplacian
  sharpening, ≤ 2 corrected bits. Faster and better recall than AprilTag 2 and
  ArUco 3 (Krogius 2019, Figs. 7–8).
- **Pixel convention trap**: AprilTag puts pixel centres at +0.5 (refine_edges
  subtracts 0.5 before sampling); OpenCV (and matar) at integers. Mixing gives a
  0.5 px bias (≈ 0.2 mm). Decimated → full in the integer convention:
  `full = (p + 0.5)·d − 0.5`.
- Timings: AprilTag 2 ≈ 0.254 µs/px single-thread Xeon (≈ 78 ms at 640×480),
  0.072 µs/px with decimation 2 (Wang 2016); ArUco 3 > 1000 fps at 4K on desktop
  (Romero-Ramirez 2018). **No published phone timings** for js-aruco,
  js-aruco2 or [apriltag-js-standalone](https://github.com/arenaxr/apriltag-js-standalone):
  benchmark early.
- Speed tricks: decimate × 2 only when the predicted smallest cell is ≥ 4 px at
  full res; ROIs from a constant-velocity prediction (bbox + max(20 px, 0.5 ×
  tag size)) at full res; full-frame search every 8th frame, or when < 6 tags
  tracked, or RMS > 1.5 px.

### 2.4 Pose

- Normalised DLT homography (Hartley 1997): centroid shift, mean distance √2.
- Initial pose: Zhang decomposition ([r1 r2 t] = λK⁻¹H, λ = 1/‖K⁻¹h1‖,
  SVD snap to a rotation, t_z > 0), or **IPPE** (Collins & Bartoli, IJCV 109,
  2014), which returns **both** solutions of the planar ambiguity.
- Planar ambiguity (Schweighofer & Pinz, PAMI 28(12) 2006; high): under weak
  perspective the plane normal is ambiguous up to a reflection about the line of
  sight; IPPE error ratio e2/e1 ≈ 1 signals it. A whole mat spanning 35–60 % of
  the frame resolves it; close-ups of 1–2 tags don't → use the previous pose
  (optionally gravity).
- LM: 6 DoF, analytic Jacobians, Huber δ = 1.5 px, ≤ 10 iterations, stop at
  step < 1e-6.
- Outliers: drop IDs not on the board and duplicates; RANSAC over **tag pairs**
  (8 points → homography; inliers = tags with all 4 corners within 4 px; ≤ 780
  pairs for 40 tags); after the solve drop tags with RMS > max(3 px, 3 × median),
  re-solve.

### 2.5 Unknown focal length

- Principal point at the origin, w = 1/f², ω = diag(w, w, 1); each view's
  normalised H gives two linear equations
  `w(h11 h12 + h21 h22) + h31 h32 = 0` and
  `w(h11² + h21² − h12² − h22²) + (h31² − h32²) = 0`;
  stack all views: w = −Σaᵢbᵢ / Σaᵢ², f = 1/√w (reject w ≤ 0).
- With square pixels and known principal point **only fronto-parallel views
  are degenerate**; information grows with sin²(tilt) (own derivation, high).
  Estimating fx, fy separately adds the tilt-about-an-image-axis degeneracy
  (Sturm & Maybank, CVPR 1999; attribution **UNVERIFIED**).
- Accuracy (own simulation, σ = 0.3 px, 48 corners): tilt 25–50°: 0.2 % (1
  view), 0.1 % (3), 0.07 % (10), 0.04 % (30); tilt 10–25°: 0.7 / 0.3 / 0.15 /
  0.09 %. σ = 0.5 px: ≈ 1.7× worse. Closed form ≈ joint bundle (0.22 vs 0.19 %).
  Uncorrected k1 = 0.03 biases −0.4 %, k1 = 0.06 → −0.7 %. Don't free f in the
  per-frame LM (f and depth are coupled). Decision (v0.1): closed form only, with
  the spread of per-keyframe estimates as its uncertainty; a windowed bundle
  with shared f would gain little (0.19 vs 0.22 %).
- **Sensitivity** (own simulation, pose refit with wrong f, 30–45 cm, tilt
  20–40°): f off by 1 % → ≤ 0.15 mm at a point 10 cm above the mat; 3 % →
  ≤ 0.4 mm; 10 % → 1.2–1.4 mm (3–9 mm at 20 cm height). The pose absorbs f
  error as depth. **The principal point matters more**: 20 px off → 1.3 mm at
  10 cm height (2 mm at 15 cm); 40 px → 2.5–4 mm. Phone principal-point offsets:
  **UNVERIFIED**.
- Distortion: iOS geometric distortion correction defaults on where supported
  ([Apple](https://developer.apple.com/documentation/avfoundation/avcapturedevice/isgeometricdistortioncorrectionenabled));
  Android `DISTORTION_CORRECTION_MODE` on by default where supported, key
  optional ([Android](https://developer.android.com/reference/android/hardware/camera2/CaptureRequest#DISTORTION_CORRECTION_MODE)).
  Whether WebKit/Chrome capture paths enable them: **UNVERIFIED**. Ignoring
  k1 = 0.03 (≈ 8 px at the frame edge) costs ≤ 0.5 mm at 10 cm height; k1 = 0.1
  → 1.6 mm. Acceptable for main cameras.

### 2.6 Print scale

- A uniform scale error is **unobservable** from images of the mat, with known
  or unknown f (high). Error ≈ (1 − s) × distance from the anchor: s = 0.97 →
  2.3 mm at 10 cm above the centre, 3.5–3.8 mm at 10–12 cm lateral; s = 0.99 →
  0.8–1.3 mm. The printed outline shrinks too, so the footprint visibly mismatches.
- Mitigations: 100 mm ruler + an ID-1 card outline (85.60 × 53.98 mm) +
  "print at 100 % / Actual size"; let users enter the measured ruler length →
  s, scale the board model by s. PDF `/PrintScaling /None`: browser support
  **UNVERIFIED**.

### 2.7 Jitter, lag, filtering

- Own simulation (12 tags, 40 cm, 35° tilt): corner noise σ = 0.3 px →
  rotation 0.04° RMS, camera position 0.27 mm, overlay 0.03 mm on the mat,
  0.07 mm at 10 cm height, 0.16 mm at 25 cm; σ = 1 px → 0.13°, 0.24 mm at 10 cm;
  6 tags ≈ 2×. **iid corner noise is negligible**; visible jitter will come from
  tag-set changes, blur, rolling shutter, dropouts.
- **Lag is the real enemy**: 27 ms at 100 mm/s ≈ 2.7 mm. Render frame-locked
  (the processed frame as background with its own pose) and keep the filter
  nearly transparent in motion.
- One Euro (Casiez, CHI 2012, [page](https://gery.casiez.net/1euro/)):
  α = 1/(1 + 1/(2π fc Te)), fc = fcmin + β|ẋ̂|, derivative filtered at
  dcutoff; rotation q̂ ← q̂ · exp(α · log(q̂⁻¹ q)). Starting values (derived,
  **UNVERIFIED**): position fcmin 1.5 Hz, β 0.1 Hz per mm/s; rotation fcmin
  1.5 Hz, β 20 Hz per rad/s; dcutoff 1 Hz. Jump gating: ignore jumps > 20 mm or
  > 5° unless they persist 3 frames. A constant-velocity Kalman filter is
  > similar with more tuning; its prediction is useful for ROIs.

### 2.8 Board layout guidance

- A4: 16 tags of 32 mm (black square) in a border ring with the layout rule of
  ARCHITECTURE.md §3.1 (8 mm margin, 1-cell gap between white rings, corners
  shared: 6 per long edge, 4 per short), leaving ≈ 114 × 201 mm free inside the
  ring (footprints ≲ 10 cm). A3 for ≈ 25 cm objects.
- At 20 cm the camera sees only ≈ 255 × 143 mm: add an inner ring of 4–6 × 20 mm
  tags around the footprint so ≥ 4 stay in view.
- Quiet zone ≥ 1 white cell beyond the tag's own white ring; ≥ 8–10 mm from
  the paper edge; matte paper.
- Tiled mats: disjoint IDs per tile, ≥ 6 tags per tile; tile misalignment
  becomes overlay error directly (per-tile offset estimation would fix it,
  complexity **UNVERIFIED**).
- ChArUco: not worth it (glare-prone checkerboard; its precision gain is
  invisible next to f, principal point and print-scale errors).

### 2.9 Synthetic rendering

- 8 × 8 stratified supersampling, inverse-homography lookup into the analytic
  cell grid (not a bitmap); Gaussian blur σ 0.5–1.5 px **in linear light**,
  then gamma 2.2; Poisson-Gaussian noise 2–5 DN; black 20–40, white 180–230.
  Motion blur = average of 8–16 sub-frames; optional rolling shutter, shadows,
  JPEG/H.264.
- Pitfalls: one sample per pixel aliases (±0.5 px); blurring in gamma space
  shifts edges (≈ 0.1–0.3 px, **UNVERIFIED**); H vs H⁻¹; the y flip between mat
  and image; corner order and rotation conventions.
- Suggested tolerances: clean, blur 0.8 px, ≥ 5 px/cell: corner RMS ≤ 0.1 px,
  max ≤ 0.25; noise 3 DN + blur 1.2: ≤ 0.3 px; pose at 40 cm: ≤ 0.1°,
  ≤ 0.5 mm, 10 cm-high point ≤ 0.3 mm; ≥ 3 px/cell: 100 % correct IDs; 10 k
  clutter frames: 0 FPs; f from 20 views: ≤ 0.3 %.

### 2.10 Reading list

AprilTag: [repo](https://github.com/AprilRobotics/apriltag), Olson 2011, Wang &
Olson 2016, Krogius 2019 (links above) · OpenCV
[aruco](https://github.com/opencv/opencv/tree/4.x/modules/objdetect/src/aruco),
[ippe.cpp](https://github.com/opencv/opencv/blob/4.x/modules/calib3d/src/ippe.cpp) ·
Garrido-Jurado et al., Pattern Recognition 47(6) 2014 / 51 2016; Romero-Ramirez
et al., IVC 76 2018 · Collins & Bartoli IJCV 2014 · Schweighofer & Pinz PAMI
2006 · Zhang PAMI 2000 · Hartley 1997 · JS:
[js-aruco](https://github.com/jcmellado/js-aruco),
[js-aruco2](https://github.com/damianofalcioni/js-aruco2),
[apriltag-js-standalone](https://github.com/arenaxr/apriltag-js-standalone),
[AR.js](https://github.com/AR-js-org/AR.js) · [One Euro](https://gery.casiez.net/1euro/).

### 2.11 Still unverified

JS/WASM timings on phones · distortion-corrected frames in Safari/Chrome ·
typical phone k1 and principal-point offsets · `zoom: false` vs iOS lens
switching · PDF `PrintScaling` in browsers · clutter quads per frame ·
pixels-per-cell thresholds · One Euro parameters.
