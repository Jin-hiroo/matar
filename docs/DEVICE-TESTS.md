# Device tests

Claude can't run a phone, so real-device results are recorded here by the
maintainer. A feature only counts as working on a device once a row exists.

## Setup

1. `pnpm dev` on the Mac. Vite serves the demo over HTTPS on the LAN
   (self-signed certificate via `@vitejs/plugin-basic-ssl`).
2. On the phone (same Wi-Fi), open the `https://<mac-ip>:5173/` URL that Vite
   prints, accept the certificate warning once, and allow the camera.
   - Android alternative: `adb reverse tcp:5173 tcp:5173` and open
     `https://localhost:5173/`.
   - A deployed demo (any static HTTPS host) avoids the certificate step.
     For Vercel, run `pnpm dlx vercel deploy --prod` from the repo root.
     `vercel.json` builds the demo with `pnpm demo:build` and serves
     `demo/dist`, and `.vercelignore` uploads only the files that build needs.
     The project's production domain is public; per-deployment URLs sit
     behind Vercel login. To run the demo e2e (fake camera, poses against
     ground truth, no off-origin requests) against a deployment:
     `MATAR_DEMO_URL=<url> pnpm exec playwright test --project demo`.
3. Print the demo's test board (**Print board** button) at **100 % scale**
   ("Actual size", never "Fit to page"). Measure the 100 mm ruler; note the result.

## Smoke test

Read the values off the demo's debug HUD.

1. Camera starts on the rear main lens (HUD `camera` label); no lens switch when
   moving close (≈ 15 cm).
2. Board found within 1 s at 30–50 cm; the cube sits on the printed square and
   the axes on the printed origin cross.
3. Hold the phone still for 5 s at 40 cm: note `jitter` (mm RMS).
4. Cover tags with a hand until only one is visible: tracking continues.
5. Tilt to ~60° from vertical: tracking continues; note `err` (px RMS).
6. Note `fps` and `worker` (ms/frame), and `f` (focal px, and whether it says
   `estimated` after a few seconds of moving).
7. Put a 3D-printed or measured object (e.g. a 50 mm cube) on the printed
   outline: note the visible overlay offset in mm (top and bottom edges).
8. Lock the phone, unlock: camera and tracking resume.
9. Rotate the phone portrait ↔ landscape: the video, the HUD's analysed frame
   size and the overlay stay upright and aligned.

## Platform checks

One-off checks of browser behaviour the design depends on (ARCHITECTURE.md §6.2,
§7.2). The demo's HUD (with `?debug`) shows the values; record yes/no and the
value per device in the Notes column of the results.

| Check               | What to look at                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VideoFrame format   | HUD `frame`: `format` (NV12 / I420 / RGBA / null), coded size, `rotation`                                                                                                                                                                                                                   |
| Orientation         | in portrait, is the VideoFrame transposed vs `videoWidth × videoHeight`? If so, does rotating by `screen.orientation.angle` give an upright image (HUD thumbnail)?                                                                                                                          |
| Lag: synced vs live | move the phone side to side in each **Mode** (`frame`, the default, and `live`) and press **Copy report** after each: paste both reports. Note whether the video lags behind reality, whether the cube slides off the paper, and whether it shakes when moving sideways or turning in place |
| VideoFrame → WebGL  | background shows the camera with `?bg=frame` (VideoFrame upload) and with `?bg=video` (video-element upload)                                                                                                                                                                                |
| Hidden video        | with the tracker-created 1 × 1 px video, frames keep arriving (fps ≥ 25)                                                                                                                                                                                                                    |
| Worker              | HUD `worker: module` (not `inline`), and no requests other than the page's own origin in Web Inspector / DevTools                                                                                                                                                                           |
| Lens labels         | every `videoinput` label (HUD list), and which one was pinned                                                                                                                                                                                                                               |
| Rotated frames      | Android, portrait: with `?bg=frame`, is the background upright and aligned with the overlay (does the WebGL upload honour `VideoFrame.rotation`)? Compare `?bg=video`                                                                                                                       |
| Render cost         | HUD `render ms` (`MatarThree.update()` + `renderer.render`) per frame; it should stay well under the frame interval                                                                                                                                                                         |

## Results

| Date       | Device                                         | OS / browser                         | Camera label                   | Found < 1 s? | fps                                           | worker ms                                         | err px                        | jitter mm | f (px, source)                                    | Overlay offset mm | Notes                                                                                                                                                                                                                                                                                   |
| ---------- | ---------------------------------------------- | ------------------------------------ | ------------------------------ | ------------ | --------------------------------------------- | ------------------------------------------------- | ----------------------------- | --------- | ------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-21 | Android phone (model hidden by the reduced UA) | Android (UA says 10; K) / Chrome 155 | camera 2, facing back          | -            | camera 29; analysed 20 (`frame`), 24 (`live`) | 25 / 37 (`frame`), 17 / 30 (`live`), median / p90 | 1.08 (`frame`), 0.58 (`live`) | -         | 948.8 (prior)                                     | -                 | **Lag check: `frame` felt better than `live`.** VideoFrame I420 720×1280 rot 0° (no rotation to honour), worker module, 16 / 16 tags. Moving side to side, 77 % (`frame`) and 69 % (`live`) of analysed frames had a pose. Smoke-test steps 1–9 not run yet. Reports below              |
| 2026-10-23 | Android phone (same)                           | Android (UA says 10; K) / Chrome 155 | camera 0, facing back (pinned) | -            | camera 30; analysed 29.9                      | 17.9 / 26.6 (slow), 21.9 / 28.8 (fast)            | 0.86 (slow), 0.96 (fast)      | -         | 1133.8 (estimated ±0.97 %), then 1131.8 (±0.29 %) | -                 | **First run with the lens rule working** (Chrome's `camera N` labels) and the first self-calibration on a phone: 59° long side, the demo's `fit` agrees (1118–1138 px). Moving vertically: 149 / 150 frames with a pose slowly, 129 / 150 fast (0 tags on the lost ones). Reports below |

### 2026-10-21, Android, Chrome 155: `frame` vs `live`

Moving the phone side to side, `frame` (synced) felt better than `live`, even
though its background was about 35 ms older. In `live` the background was
current, but the extrapolated pose was 33 ms (p90 67 ms) behind it. Worker
times differ between the runs (detect 25 vs 16 ms median). Whether the
synced texture upload or a different viewing distance caused that is
untested.

Follow-up: the picture got shaky when moving sideways or turning in place.
Likely cause: on frames without a pose, the content was drawn with the lagging
smoothed hold pose. Fixed in `MatarThree` (raw poses extrapolated to those
frames); retest. The report now also shows the analysed-frame spacing, the
runs without a pose, and the time in the `grab` event.

Second follow-up, vertical movement (`frame`): 123 / 135 frames with a pose,
3 runs without one (longest 8 frames), 0 tags found on them; err 2.14 / 6.23
px; `grab` 0.3 / 0.6 ms (so the synced upload is cheap); analysed frames 33 /
50 ms apart. Synthetic checks: all tags of the demo board vanished together
once motion blur exceeded about one cell (9 px at 42 cm), because the
detector's threshold was at the encoded midpoint. Fixed (linear-light
midpoint); retest. A 25 ms rolling shutter accounts for an err of 2–5 px at
these speeds but moves the cube only 1–3 px. The focal length was still the
68° prior.

Retest after the linear-light threshold (same phone): the
maintainer reports it "working great". No report was pasted, so there are no
numbers for this run.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.9, analysed 26.8, with a pose 123/135
interval 33 / 50 ms between analysed frames
no pose  12 frames in 3 runs (longest 8), tags found on them 0 / 0
grab     0.3 / 0.6 ms on the main thread before the transfer (bg frame: the texture upload)
worker   20.0 / 27.3 ms
stages   gray 0.4 / 0.7  detect 18.7 / 26.0  pose 0.6 / 1.0  focal 0.1 / 0.1 ms
bg age   34 / 52 ms at render
pose age 34 / 52 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.8 ms
tags     16 / 16, err 2.14 / 6.23 px
focal    948.8 px (prior)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 28.9, analysed 20.1, with a pose 78/101
worker   25.4 / 37.2 ms
stages   gray 0.4 / 0.7  detect 24.8 / 35.8  pose 0.6 / 1.0  focal 0.0 / 0.1 ms
bg age   36 / 68 ms at render
pose age 36 / 68 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.7 ms
tags     16 / 16, err 1.08 / 2.00 px
focal    948.8 px (prior)
```

```text
matar demo report (last 5 s)
mode     bg live, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.0, analysed 23.7, with a pose 82/119
worker   16.6 / 30.3 ms
stages   gray 0.3 / 0.5  detect 15.8 / 29.4  pose 0.4 / 0.8  focal 0.0 / 0.1 ms
bg age   1 / 18 ms at render
pose age 21 / 53 ms at render
pose lag 33 / 67 ms behind the background (0 with bg frame)
render   0.5 / 1.0 ms
tags     16 / 16, err 0.58 / 1.45 px
focal    948.8 px (prior)
```

### 2026-10-21, Android, Chrome 155: the Vercel deployment

Same phone, the demo deployed on Vercel (the maintainer's test project),
which also had that day's tracker and detector changes (late grab, no ×1
search every 8th frame once all IDs are found). The maintainer reports it working but less
accurate than the local run before. In the report:

- 29.9 analysed fps from a 29.8 fps camera, against 26.8 from 29.9 before: the
  late grab works on this phone (ARCHITECTURE.md §6.2).
- Only 10 / 15 of the 16 tags were found, against 16 / 16 before, and err was
  5.93 / 7.60 px, against 2.14 / 6.23. There were 43 frames without a pose in
  4 runs (longest 18), all with 0 tags.

Hosting can't explain this: the same files run on the phone, and the
fake-camera e2e against the deployment is as accurate as locally. The
day's changes only alter when frames are grabbed (not their pixels) and skip a
×1 search only when all 16 tags were found, so they shouldn't lose tags.
Fewer tags and a high err suggest a different view: board partly out of frame
or closer to the image edges, or faster motion. That can't be checked, since the
report didn't record where the camera was. It now does (`view`: height above
the paper and tilt). Retest: the same spot and distance with `pnpm dev` and
with the deployment, holding still for 5 s, a report from each.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.8, analysed 29.9, with a pose 107/150
interval 33 / 50 ms between analysed frames
no pose  43 frames in 4 runs (longest 18), tags found on them 0 / 0
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   16.5 / 27.2 ms
stages   gray 0.3 / 0.6  detect 15.5 / 26.0  pose 0.4 / 0.8  focal 0.0 / 0.1 ms
bg age   18 / 51 ms at render
pose age 18 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     10 / 15, err 5.93 / 7.60 px
focal    948.8 px (prior)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-21, Android, Chrome 155: local and Vercel at the same spot

Same phone, held still over the board, one report from `pnpm dev` and one
from the deployment. Both found 16 / 16 tags with err 0.39 / 0.41 px (local)
and 0.37 / 0.40 px (Vercel), at 505 and 517 mm above the paper and 5° / 1° from
straight down. Worker and detect times match too. Hosting doesn't change
accuracy; the earlier worse run was its conditions. The maintainer suspects the
environment it was scanned in.

What the earlier run's conditions could have been, from synthetic frames of
the demo board (720 × 1280, 9 px cells at 420 mm). Noise up to 8 DN, dim
(paper at 32 DN), washed-out (ink at 120 DN), lighting gradients and soft
shadows cost no accuracy. A hard shadow edge or a glare spot across tags loses
a few of them. Motion blur is what breaks tracking: corners are fine up to
about 4 px of blur, off by 0.3–0.7 px at 8 px, and at 16 px every tag looks
stretched by ≈ (blur − cell) / 2 per side along the motion. At 18–20 px almost
none are found. Blur is the image speed times the exposure time, and dim rooms
make the camera expose longer, so the environment changes how much a given
movement blurs.

Changes after this run:

- the pose consensus tolerates the stretch when the strict test keeps fewer
  than half the tags (ARCHITECTURE.md §5.4); at 16 px of blur it used to keep
  5 of 11–13 tags and put the camera 26–58 mm and 3–8° off, now all and within
  3.1 mm;
- `MatarThree` (raw pose) draws a pose more than 20 mm or 5° from the
  extrapolated motion like a frame without one (§7.2);
- the report gained `motion` (image speed of the board; with the exposure
  time, the blur in px), `exposure` (what the browser reports, and what it
  could set), tags found and used, and `err by r` (corner error in the centre,
  middle and edge thirds of the image; growing towards the edge with one sign
  points to lens distortion, which matar doesn't model).

Retest: in the environment where it was worse, use it as before (moving),
then hold still with the board near the image edges. Copy a report after
each. Also hold still and measure the camera's height above the paper with a
ruler: if `view` says 505 mm and the ruler 470 mm, the 68° focal prior is 7 %
off (it has never self-calibrated on this phone).

Local (`pnpm dev`):

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.5, analysed 29.6, with a pose 148/148
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.4 / 0.8 ms on the main thread before the transfer (bg frame: the texture upload)
worker   16.6 / 23.7 ms
stages   gray 0.4 / 0.8  detect 15.1 / 21.9  pose 0.8 / 1.2  focal 0.0 / 0.1 ms
bg age   20 / 51 ms at render
pose age 20 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.8 ms
tags     16 / 16, err 0.39 / 0.41 px
view     505 / 506 mm above the paper, tilt 5 / 5° from straight down
focal    948.8 px (prior)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Vercel:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.4, analysed 29.2, with a pose 146/146
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.4 / 0.8 ms on the main thread before the transfer (bg frame: the texture upload)
worker   16.3 / 23.8 ms
stages   gray 0.4 / 0.8  detect 14.7 / 21.5  pose 0.8 / 1.2  focal 0.0 / 0.0 ms
bg age   19 / 52 ms at render
pose age 19 / 52 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.8 ms
tags     16 / 16, err 0.37 / 0.40 px
view     517 / 517 mm above the paper, tilt 1 / 1° from straight down
focal    948.8 px (prior)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-23, Android, Chrome 155: tilted, still and moving (Vercel)

The maintainer found accuracy much worse than at the "working great" point,
before the Vercel deployment and the changes after it. Held still, 16 / 16
tags were found, but the corner error was 6.06 px (centre 5.45, middle 6.74),
against 0.4 px in the still reports above. The view differs: 366 mm above the
paper at 27° tilt, where those were 505–517 mm at 1–5°.

A wrong focal length explains this without any code change. The focal is
still the 68° prior (948.8 px); self-calibration has never accepted on this
phone. Looking straight down a wrong focal leaves no corner error (the height
comes out wrong instead); tilted, it does. Synthetic, the demo board 366 mm
up, poses fitted with the prior:

| true f / prior | 0.8  | 0.9  | 1.0  | 1.1  | 1.2  | 1.3  |
| -------------- | ---- | ---- | ---- | ---- | ---- | ---- |
| 3° tilt, px    | 0.09 | 0.04 | 0.00 | 0.04 | 0.07 | 0.11 |
| 27° tilt, px   | 3.04 | 1.65 | 0.00 | 1.83 | 3.80 | 5.88 |
| 50° tilt, px   | 2.69 | 1.49 | 0.00 | 1.80 | 3.88 | 6.23 |

6 px at 27° fits a focal ≈ 1.3 × the prior (≈ 1230 px, a 55° long side) or
≈ 0.7 × (≈ 680 px, an 86° long side). The `?fov=` runs below show it is
0.7 ×. Then `view` reads ≈ 35 % high. The consensus, the only accuracy
change since that point, isn't involved at rest: it judges tags by
homographies, which fit for any focal length, and all 15–16 tags were kept.

Moving sideways at 50° tilt: 370 / 779 px/s in the image with a 30 ms
exposure, so 11 / 23 px of blur (≈ 1–2 tag cells at this distance); 13 of
15 tags found, 8 of 9 used. The camera allows a manual exposure of
0–150 ms.

Changes after this run: the report gained a `fit` line (the focal length that
fits tilted frames best, and the error with it and with the focal in use), and
the demo takes `?fov=` (the long-side field of view to start from).

Retest: hold still at 25–40° tilt for 5 s, copy the report, and read `fit`.
Then reload with the `?fov=` it suggests and do the same: `err` should drop
below 1 px and the cube should sit on its square when tilted.

Hold still:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.8, analysed 29.8, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.4 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   14.6 / 20.9 ms
stages   gray 0.4 / 0.6  detect 13.2 / 19.0  pose 0.9 / 1.3  focal 0.1 / 0.1 ms
bg age   19 / 40 ms at render
pose age 19 / 40 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 15 / 15 used, err 6.06 / 6.32 px
err by r centre 5.45 px (4619 corners), middle 6.74 (4305), edge - (0)
view     366 / 368 mm above the paper, tilt 27 / 27° from straight down
motion   board centre 15 / 53 px/s in the image (≈ 0 / 2 px of blur at 30.0 ms)
exposure 30.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 48–3200
focal    948.8 px (prior)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Moving horizontally:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.7, analysed 29.6, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   19.0 / 28.3 ms
stages   gray 0.3 / 0.6  detect 18.2 / 27.2  pose 0.5 / 0.8  focal 0.1 / 0.1 ms
bg age   20 / 51 ms at render
pose age 20 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     13 / 15 found, 8 / 9 used, err 4.94 / 9.84 px
err by r centre 5.23 px (4151 corners), middle 11.28 (637), edge - (0)
view     317 / 344 mm above the paper, tilt 50 / 51° from straight down
motion   board centre 370 / 779 px/s in the image (≈ 11 / 23 px of blur at 30.0 ms)
exposure 30.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 48–3200
focal    948.8 px (prior)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-23, Android, Chrome 155: `?fov=` runs (Vercel)

The maintainer reloaded with five `?fov=` values, held still at 17–24° tilt,
and found all of them wobbly. Every `fit` line points to a wider view than any
value tried: f ≈ 680–720 px, an 83–87° long side, ≈ 0.72–0.76 × the 68° prior.
In the 55 and 45 runs the fit stopped at its lower search bound
(0.6 × the f in use: 738 and 927 px), so those two numbers are bounds, not
fits. Fixed (the search now spans a 30–120° long side whatever the f in use);
the e2e test starts from `?fov=40`, which the old search couldn't leave.

| `?fov=` | f in use px | tilt ° | up mm | used | err px | fit px (range) | err with fit px |
| ------- | ----------- | ------ | ----- | ---- | ------ | -------------- | --------------- |
| 45      | 1545.1      | 20     | 610   | 10   | 6.88   | 927 (bound)    | 2.85            |
| 55      | 1229.4      | 24     | 454   | 12   | 8.08   | 738 (bound)    | 1.45            |
| 60      | 1108.5      | 23     | 451   | 10   | 5.55   | 680 (667–686)  | 1.37            |
| 65      | 1004.6      | 17     | 428   | 13   | 2.86   | 723 (692–770)  | 1.40            |
| 75      | 834.1       | 19     | 337   | 8    | 2.85   | 698 (652–759)  | 2.06            |

The error falls as the f in use nears ≈ 700 px, as the table above predicts,
but stays at 1.4 px with the best fit, not the 0.4 px of the straight-down
runs. Lens distortion (not modelled), rolling shutter or hand shake could
leave that; these reports can't tell which (`err by r` is with the f in use,
so the focal error dominates it). Self-calibration didn't accept in any run.
Two of its rules may be why (untested): keyframes need a homography fit under
1 px, and 0.72 × is near the edge of its [0.7, 1.4] × window.

Retest: `?fov=85`, the same hold-still at 20–30° tilt.

### 2026-10-23, Android, Chrome 155: f ≈ 722 px (Vercel)

Reloaded with the focal from the `?fov=65` run's `fit` (722.3 px in use,
≈ `?fov=83`). Held still, 661 mm up at 22° tilt: 16 / 16 tags used, err
0.64 / 0.71 px (6.06 px with the prior at 27°), about what the straight-down
runs gave. `fit` 699 px (695–709), err 0.63 px with it. All corners were in
the centre ring this far up, where lens distortion is smallest, so this
doesn't tell whether the 1.4 px left closer up in the `?fov=` runs was
distortion. Shaking: 123 / 145 frames with
a pose, 22 without in 10 runs (longest 6) with 0 tags found on them; err
0.98 / 1.13 px; 103 / 269 px/s (≈ 2 / 5 px of blur at 20 ms) on the frames
with a pose. The maintainer called it stable.

The label `camera 2, facing back` shows the lens rule never ran: current
Chromium labels cameras `camera N, facing back`, the rule matched only the
older `camera2 N, …`. Fixed; the tracker now reopens on the lowest-numbered
back camera, which may be another lens with another focal length. Retest
**without** `?fov=`: read `inputs` (new in the report), `camera` and `fit`.

Still:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.8, analysed 29.4, with a pose 148/148
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.7 ms on the main thread before the transfer (bg frame: the texture upload)
worker   23.7 / 30.4 ms
stages   gray 0.3 / 0.5  detect 22.5 / 29.2  pose 0.6 / 0.9  focal 0.1 / 0.1 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.7 ms
tags     16 / 16 found, 16 / 16 used, err 0.64 / 0.71 px
err by r centre 0.65 px (9472 corners), middle - (0), edge - (0)
view     661 / 666 mm above the paper, tilt 22 / 22° from straight down
motion   board centre 7 / 17 px/s in the image (≈ 0 / 0 px of blur at 20.0 ms)
exposure 20.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 48–3200
focal    722.3 px (prior)
fit      699 px best (695–709 over 12 tilted frames; long-side FOV 85.0°, ?fov=85.0), err 0.63 px with it, 0.65 px with the f in use
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Shaking:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 2, facing back (unknown), videoframe I420 720×1280 rot 0°, analysed 720×1280
fps      camera 29.5, analysed 28.9, with a pose 123/145
interval 33 / 50 ms between analysed frames
no pose  22 frames in 10 runs (longest 6), tags found on them 0 / 0
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   23.6 / 30.4 ms
stages   gray 0.3 / 0.6  detect 22.6 / 29.8  pose 0.5 / 0.7  focal 0.0 / 0.1 ms
bg age   35 / 52 ms at render
pose age 35 / 52 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 16 / 16 used, err 0.98 / 1.13 px
err by r centre 0.91 px (5391 corners), middle 0.91 (777), edge - (0)
view     648 / 662 mm above the paper, tilt 26 / 32° from straight down
motion   board centre 103 / 269 px/s in the image (≈ 2 / 5 px of blur at 20.0 ms)
exposure 20.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 48–3200
focal    722.3 px (prior)
fit      686 px best (635–763 over 12 tilted frames; long-side FOV 86.0°, ?fov=86.0), err 0.99 px with it, 1.05 px with the f in use
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-23, Android, Chrome 155: camera 0 pinned, self-calibrated (Vercel)

No `?fov=`. With the label fix the tracker reopened on `camera 0, facing back`
(`pinned`); `inputs` lists two back cameras (0 and 2) and two front ones.
Self-calibration accepted for the first time on a phone: 1133.8 px (±0.97 %),
then 1131.8 px (±0.29 %), a 59° long side, against the 68° prior (948.8 px,
1.19 ×). The demo's `fit` agrees: 1138 and 1118 px. Camera 2, which Chrome's
`facingMode` opened before, fits ≈ 699 px (85°).

Moving slowly over a vertical sphere (tilt 25 / 56°, 509 mm up): 149 / 150
frames with a pose, err 0.86 / 1.08 px. Moving vertically fast (648 mm up,
tilt 42°): 129 / 150, 21 frames without a pose in 9 runs (longest 5, ≈ 170
ms), no tag found on any of them; 289 / 753 px/s on the frames with a pose,
3 / 8 px of blur at the 10 ms auto exposure. A tag cell (4 mm) is ≈ 7 px at
648 mm with this focal (≈ 5 px across the tilt), so the lost frames are
likely blurred past what the detector survives (≈ 1.5 cells in the synthetic
tests). Unconfirmed: the report has no speed for frames without a pose.

Retest: the same fast vertical motion with `?exposure=4` (new: a manual 4 ms
exposure, ISO raised to keep the brightness; 2.5 × less blur), then compare
`no pose`. Under mains lighting a short exposure can show moving bands.

Two more runs (unlabelled), 705–715 mm up at 33–36° tilt: 148 / 150 and
149 / 149 frames with a pose, err 0.80 and 0.84 px, 235 / 471 and 247 / 538
px/s; focal 1143.6 and 1145.6 px (estimated ±0.46 %), `fit` 1156 and 1161 px.
Both still at the 10 ms auto exposure and without a `?exposure=` note, so the
manual exposure wasn't in effect (no parameter, or the browser never answered:
the note was only written once it did). The report now shows the URL options
on the `mode` line, and the note at every step.

Next run: `url -`, so no `?exposure=` again. A fresh load: the focal was the
prior (948.8 px) and err 1.81 / 2.25 px, against 0.80–0.84 px calibrated;
`fit` 1144 px, err 1.03 px with it. Every page load started calibrating
again. The demo now saves the measured focal length under the camera's
label in `localStorage` and starts the next load from it on that camera
(`TrackerOptions.intrinsics`); `?fresh` forgets it. Labels, because Chrome
gave the fake camera a new deviceId on every page load in the e2e test.

`?exposure=4` (typed in): accepted, `exposure 4.0 ms, none, ISO 624`. Held
still at 29° tilt: 150 / 150, err 1.53 px. **Moving fast: 150 / 150 frames
with a pose at 442 / 958 px/s** (≈ 2 / 4 px of blur), where the 10 ms auto
exposure lost 21 of 150 at 289 / 753 px/s. Both on the prior (948.8 px,
`nothing saved used`: self-calibration didn't accept in either), err 1.53 and
2.31 px against 0.56 and 0.78 px with the `fit` (1143, 1134 px). The report
now has a `calib` line: the frames in the window that pass each keyframe
rule (tags and tilt, homography fit < 1 px, separate directions).

After a reload with `?exposure=4`: `started from the one saved for camera 0,
facing back (1130.7 px)`, so the saved calibration works on the phone, and the
`fit` agrees (1128 and 1131 px). Closer and steeper than before: 291 mm up at
47–54° tilt. 150 / 150 (moving, 328 / 819 px/s) and 149 / 149 (still) frames
with a pose, err 1.40 and 1.16 px, against 0.56 px still at 613 mm and 29°
with the right f. The auto exposure the ISO was scaled from was darker this
time: ISO 2498 at 4 ms, against 624 before. A pixel covers more paper at a
steeper tilt and less when closer: by hand (distance h / cos tilt, the long
side of the pixel's footprint on the paper), the still runs come to ≈ 0.55 mm
on the paper here against ≈ 0.37 mm before, so this one is worse on the paper
too. Not separable from these runs: ISO (gain 4 ×), tilt, or the board
filling more of the image (edge corners −1.97 px radially, barrel-like). The
report now gives the `err` in mm on the paper as well (each corner's ray met
with the board plane).

`calib`: 133 and 149 frames had ≥ 6 tags at ≥ 20° tilt, but their homography
fits were 1.1–1.5 px, so 3 and 0 passed the < 1 px rule. Self-calibration
would not have started at this distance on a fresh load. The rule is in
pixels and a pixel is less paper up close, so it is stricter the closer the
camera.

Three runs in one room, saved calibration (1130.7 px; `fit` 1115–1134),
moving slowly (≈ 200 / 400 px/s), 149–150 of 149–150 frames with a pose:

| URL           | up mm | tilt ° | exposure                | err px | err mm on the paper | homography fit px |
| ------------- | ----- | ------ | ----------------------- | ------ | ------------------- | ----------------- |
| `?exposure=4` | 474   | 42     | 4 ms, ISO 624           | 0.86   | 0.68                | 0.8               |
| -             | 461   | 43     | 10 ms, ISO 250 (auto)   | 0.86   | 0.67                | 0.8               |
| `?exposure=4` | 670   | 49     | 10 ms, ISO 1249 (below) | 0.67   | 0.78                | 0.7               |

The first two, at the same spot: the same error, so ISO 624 (2.5 × the gain)
cost nothing there, and the blur was 1 / 2 px against 2 / 4 px. The third,
farther: the error fell by 22 % in pixels while the distance (height / cos
tilt) grew by 59 %, so it rose on the paper: part of the error is in the image
(px) and part on the paper (mm). None at 30 cm (the closest was 461 mm up), so
what made the 291 mm runs worse (ISO, tilt or distance) is still open.

The third's `exposure` line: `10.0 ms, none, ISO 1249 … ?exposure=4: asked
4.0 ms ISO 1249, accepted`. Chrome resolved `applyConstraints` and the ISO
took, but the settings report 10 ms: an image 2.5 × brighter than the auto
exposure and no sharper. A short exposure has to be read back after it is
applied.

All three fits were under 1 px, so every frame passed that rule; one viewing
direction ≥ 10° apart in each 5 s window (slow motion over a small range).
Since then a keyframe also qualifies under 1 mm on the paper (`focal.ts`), so
the 291 mm frames (≈ 0.5–0.75 mm by hand) would.

`?fresh&exposure=4` (the saved calibration forgotten), 467 mm up at 33° tilt,
nearly still (40 / 110 px/s): 150 / 150 frames with a pose, but **err 3.41 /
3.53 px (1.88 mm on the paper)** on the prior 948.8 px; `fit` 1138 px, err
0.64 px with it. Every frame passed the fit rule (0.6 px, 0.3 mm), all from
one viewing direction: self-calibration needs 3, ≥ 10° apart, which means
moving the phone round the board, and nothing tells the user to. Since then
the jump rule also runs on the prior (`focal.ts`): 5 consecutive good frames
more than 10 % from the prior that agree within 5 % replace it with their
median, so a phone held still at one angle like this one should leave the
prior within ≈ 0.2 s; accepting still needs the 3 directions. The `calib`
line now also counts the directions since Start, not only in the last 5 s.

With those rules, `?fresh&exposure=4` again, moving round the board (17
directions since Start; 398 mm up, tilt 36°, 306 / 609 px/s): **calibrated
from a fresh load**, 1130.9 px (estimated ±0.76 %); earlier calibrations on
this phone gave 1130.7–1145.6 px. 149 / 149 frames with a pose, err 0.81 px
(0.54 mm on the paper); `fit` 1144 px, err 0.80 px with it, 0.84 px with the
f in use. The report doesn't say how soon it left the prior, nor whether the
jump or the 3 directions did it; the `focal` line now also gives the time
from the first frame the calibration could use to the first estimate (0.3 s
on the fake camera in the e2e test).

Moving slowly:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 29.9, analysed 29.9, with a pose 149/150
interval 33 / 34 ms between analysed frames
no pose  1 frames in 1 runs (longest 1), tags found on them 0 / 0
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   17.9 / 26.6 ms
stages   gray 0.3 / 0.4  detect 16.9 / 25.4  pose 0.7 / 1.0  focal 0.0 / 0.1 ms
bg age   18 / 36 ms at render
pose age 18 / 36 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.86 / 1.08 px
err by r centre 0.85 px (6459 corners), middle 1.03 (2749), edge - (0)
view     509 / 521 mm above the paper, tilt 25 / 56° from straight down
motion   board centre 103 / 210 px/s in the image (≈ 1 / 2 px of blur at 10.0 ms)
exposure 10.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200
focal    1133.8 px (estimated ±0.97 %)
fit      1138 px best (1100–1200 over 12 tilted frames; long-side FOV 58.7°, ?fov=58.7), err 0.88 px with it, 0.90 px with the f in use
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Moving fast:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 30.0, analysed 29.8, with a pose 129/150
interval 33 / 50 ms between analysed frames
no pose  21 frames in 9 runs (longest 5), tags found on them 0 / 0
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   21.9 / 28.8 ms
stages   gray 0.3 / 0.4  detect 21.1 / 28.0  pose 0.5 / 0.7  focal 0.0 / 0.1 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 16 / 16 used, err 0.96 / 1.36 px
err by r centre 0.84 px (3171 corners), middle 1.14 (3368), edge 1.11 (197); edge corners +0.14 px radially (+ = further out than the fit)
view     648 / 737 mm above the paper, tilt 42 / 48° from straight down
motion   board centre 289 / 753 px/s in the image (≈ 3 / 8 px of blur at 10.0 ms)
exposure 10.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200
focal    1131.8 px (estimated ±0.29 %)
fit      1118 px best (1093–1131 over 12 tilted frames; long-side FOV 59.6°, ?fov=59.6), err 0.93 px with it, 0.95 px with the f in use
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Saved calibration, `?exposure=4`, moving and still at 291 mm:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 29.9, analysed 29.9, with a pose 150/150
interval 33 / 34 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   14.5 / 21.9 ms
stages   gray 0.4 / 0.5  detect 13.4 / 20.7  pose 0.6 / 0.9  focal 0.0 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.6 ms
tags     13 / 16 found, 11 / 15 used, err 1.40 / 1.89 px
err by r centre 1.27 px (3082 corners), middle 1.47 (2993), edge 2.22 (349); edge corners −0.52 px radially (+ = further out than the fit)
view     292 / 345 mm above the paper, tilt 54 / 56° from straight down
motion   board centre 328 / 819 px/s in the image (≈ 1 / 3 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 2498, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 2498, accepted
focal    1130.7 px (provided); started from the one saved for camera 0, facing back (1130.7 px)
fit      1128 px best (1112–1138 over 12 tilted frames; long-side FOV 59.1°, ?fov=59.1), err 1.33 px with it, 1.35 px with the f in use
calib    133 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 1.3 / 1.5 px), 3 of them under 1 px, from 2 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 29.9, analysed 29.8, with a pose 149/149
interval 33 / 34 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.0 / 23.6 ms
stages   gray 0.3 / 0.5  detect 13.6 / 22.4  pose 0.7 / 1.1  focal 0.1 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     15 / 16 found, 14 / 15 used, err 1.16 / 1.33 px
err by r centre 1.14 px (4032 corners), middle 1.18 (4303), edge 2.49 (121); edge corners −1.97 px radially (+ = further out than the fit)
view     291 / 293 mm above the paper, tilt 47 / 48° from straight down
motion   board centre 24 / 59 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 2498, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 2498, accepted
focal    1130.7 px (provided); started from the one saved for camera 0, facing back (1130.7 px)
fit      1131 px best (1129–1138 over 12 tilted frames; long-side FOV 59.0°, ?fov=59.0), err 1.15 px with it, 1.15 px with the f in use
calib    149 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 1.1 / 1.2 px), 0 of them under 1 px, from 0 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Same room, three runs (`?exposure=4` at 474 mm; no options at 461 mm;
`?exposure=4` at 670 mm, where the 4 ms didn't take):

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 29.8, analysed 29.8, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   19.7 / 28.5 ms
stages   gray 0.3 / 0.5  detect 18.7 / 27.4  pose 0.6 / 0.9  focal 0.1 / 0.1 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.7 ms
tags     16 / 16 found, 16 / 16 used, err 0.86 / 0.91 px (0.68 / 0.72 mm on the paper)
err by r centre 0.90 px (5884 corners), middle 0.78 (3637), edge 0.32 (11); edge corners −0.02 px radially (+ = further out than the fit)
view     474 / 520 mm above the paper, tilt 42 / 43° from straight down
motion   board centre 200 / 375 px/s in the image (≈ 1 / 2 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 624, accepted
focal    1130.7 px (provided); started from the one saved for camera 0, facing back (1130.7 px)
fit      1132 px best (1125–1143 over 12 tilted frames; long-side FOV 59.0°, ?fov=59.0), err 0.85 px with it, 0.86 px with the f in use
calib    149 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.9 px), 149 of them under 1 px, from 1 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url -
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 30.1, analysed 29.8, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   21.0 / 27.7 ms
stages   gray 0.3 / 0.5  detect 20.0 / 26.5  pose 0.6 / 0.8  focal 0.1 / 0.1 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.86 / 0.89 px (0.67 / 0.69 mm on the paper)
err by r centre 0.97 px (5591 corners), middle 0.66 (3918), edge 0.72 (87); edge corners −0.02 px radially (+ = further out than the fit)
view     461 / 496 mm above the paper, tilt 43 / 46° from straight down
motion   board centre 191 / 429 px/s in the image (≈ 2 / 4 px of blur at 10.0 ms)
exposure 10.0 ms, continuous, ISO 250, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200
focal    1130.7 px (provided); started from the one saved for camera 0, facing back (1130.7 px)
fit      1134 px best (1122–1137 over 12 tilted frames; long-side FOV 58.9°, ?fov=58.9), err 0.85 px with it, 0.85 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.9 px), 150 of them under 1 px, from 1 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 30.1, analysed 29.8, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.8 ms on the main thread before the transfer (bg frame: the texture upload)
worker   20.9 / 27.5 ms
stages   gray 0.3 / 0.5  detect 20.0 / 26.4  pose 0.6 / 0.9  focal 0.1 / 0.1 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.8 ms
tags     16 / 16 found, 16 / 16 used, err 0.67 / 0.71 px (0.78 / 0.83 mm on the paper)
err by r centre 0.71 px (6552 corners), middle 0.57 (3048), edge - (0)
view     670 / 689 mm above the paper, tilt 49 / 51° from straight down
motion   board centre 184 / 342 px/s in the image (≈ 2 / 3 px of blur at 10.0 ms)
exposure 10.0 ms, none, ISO 1249, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 1249, accepted
focal    1130.7 px (provided); started from the one saved for camera 0, facing back (1130.7 px)
fit      1115 px best (1112–1135 over 12 tilted frames; long-side FOV 59.7°, ?fov=59.7), err 0.65 px with it, 0.66 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.7 / 0.7 px), 150 of them under 1 px, from 1 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

`?fresh&exposure=4`, held at one angle, still on the prior:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?fresh&exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 30.1, analysed 29.9, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.7 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.2 / 20.8 ms
stages   gray 0.4 / 0.6  detect 13.7 / 19.1  pose 1.0 / 1.5  focal 0.1 / 0.2 ms
bg age   18 / 37 ms at render
pose age 18 / 37 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 3.41 / 3.53 px (1.88 / 1.96 mm on the paper)
err by r centre 3.59 px (5468 corners), middle 2.80 (4049), edge 5.18 (83); edge corners −5.13 px radially (+ = further out than the fit)
view     467 / 476 mm above the paper, tilt 33 / 35° from straight down
motion   board centre 40 / 110 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 624, accepted
focal    948.8 px (prior); nothing saved used
fit      1138 px best (1131–1149 over 12 tilted frames; long-side FOV 58.7°, ?fov=58.7), err 0.64 px with it, 3.38 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.6 / 0.6 px, 0.3 / 0.4 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

`?fresh&exposure=4` with the jump from the prior, moving round the board:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?fresh&exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 3, facing front | camera 0, facing back | camera 1, facing front
fps      camera 30.0, analysed 29.9, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.8 / 24.8 ms
stages   gray 0.3 / 0.4  detect 14.8 / 23.9  pose 0.5 / 0.8  focal 0.0 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     13 / 16 found, 13 / 16 used, err 0.81 / 0.94 px (0.54 / 0.64 mm on the paper)
err by r centre 0.67 px (3681 corners), middle 1.02 (2807), edge 0.95 (40); edge corners −0.15 px radially (+ = further out than the fit)
view     398 / 446 mm above the paper, tilt 36 / 41° from straight down
motion   board centre 306 / 609 px/s in the image (≈ 1 / 2 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4: asked 4.0 ms ISO 624, accepted
focal    1130.9 px (estimated ±0.76 %); measured one saved for camera 0, facing back
fit      1144 px best (1119–1151 over 12 tilted frames; long-side FOV 58.4°, ?fov=58.4), err 0.80 px with it, 0.84 px with the f in use
calib    115 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 1.0 px, 0.4 / 0.5 mm on the paper), 115 of them under 1 px or 1 mm, from 6 directions ≥ 10° apart (17 since Start; it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-24, Android, Chrome 155: `camera.maxExposureMs` in the library (Vercel)

`?exposure=4`, now passed to the library as `camera.maxExposureMs`: `exposure
4.0 ms, none, ISO 624 … (camera.maxExposureMs): set`, so the tracker
shortened the exposure itself and the read-back confirmed it. Shaking fast
(312 / 628 px/s, ≈ 1 / 3 px of blur): 149 / 149 frames with a pose.

The accuracy was the worst of any calibrated run: err 2.49 / 2.91 px (1.24
mm on the paper), against 0.81 px (0.54 mm) moving round the board at the
same speed (306 / 609 px/s) on 2026-10-23. Compared with that run:

- the homography fit, which doesn't depend on f, was 2.0 / 2.4 px (1.1 mm),
  against 0.6–0.8 px in every run at 400–670 mm: the corners didn't fit any
  view of a flat board;
- 11 / 13 of the 16 tags found were used (16 / 16 or 13 / 13 before);
- the focal length came out 1298.1 px (estimated ±0.14 %, 5 directions),
  where nine runs measured 1131–1146 px; the demo's `fit` gave 1391 px
  (1153–1825);
- it started from the 68° prior, not the saved 1130.9 px. The report didn't
  say why: the reason was overwritten when the new value was saved.
  1298.1 px is now the saved value for camera 0.

A simulation on the demo board's layout (507 mm up, 29–35° tilt, 5
directions, f = 1131 px) separates two suspects:

- **Curled paper:** a 2 px fit needs ≈ 7 mm of lift at the edges, which moves f
  by only +2–3 %.
- **Rolling shutter:** with a 30 ms readout at 600–1200 px/s, the one-frame f
  moves by ±10–20 % depending on the direction, but the fit stays under 0.8 px.

Neither explains both numbers alone. A rolling-shutter bias changes with the
direction, and this run's keyframes agreed within ±0.14 %, which speaks
against motion. Not ruled out: a change in the camera's image scale (a crop,
for example stabilisation), which would change f alike for every direction.

The report now adds:

- **`calib`:** the homography fit and the one-frame f, split by board speed;
- **`history`:** camera, focal-length and exposure changes, timed from the first
  frame;
- **exposure line:** zoom, focus distance and resize mode, where the browser
  reports them;
- **calibration note:** why a saved calibration wasn't used, kept after a new
  one is saved.

Retest, with the paper flat on a table: still, moving slowly, then shaking,
one report each.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 0, facing back | camera 3, facing front | camera 1, facing front
fps      camera 30.0, analysed 29.8, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.9 / 25.4 ms
stages   gray 0.4 / 0.5  detect 14.2 / 23.3  pose 1.1 / 1.6  focal 0.0 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 11 / 13 used, err 2.49 / 2.91 px (1.24 / 1.87 mm on the paper)
err by r centre 2.62 px (3484 corners), middle 2.41 (3285), edge 4.29 (11); edge corners +3.78 px radially (+ = further out than the fit)
view     507 / 662 mm above the paper, tilt 29 / 32° from straight down
motion   board centre 312 / 628 px/s in the image (≈ 1 / 3 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1298.1 px (estimated ±0.14 %); measured one saved for camera 0, facing back; first estimate 1.5 s after the first frame it could use
fit      1391 px best (1153–1825 over 12 tilted frames; long-side FOV 49.4°, ?fov=49.4), err 2.15 px with it, 2.46 px with the f in use
calib    121 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 2.0 / 2.4 px, 1.1 / 1.4 mm on the paper), 49 of them under 1 px or 1 mm, from 5 directions ≥ 10° apart (5 since Start; it needs 3)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

The retest, shaking fast with `?exposure=4` set again: 648 mm up at 34° tilt,
404 / 1126 px/s (≈ 2 / 5 px of blur). 146 / 149 frames had a pose; the 3 lost
were single frames with no tag found. All 16 tags were used, err 1.13 / 1.79
px (0.78 mm on the paper), homography fit 1.0 / 1.7 px. By board speed (frames
with ≥ 6 tags at ≥ 20° tilt):

| board speed  | frames | homography fit px | one-frame f px |
| ------------ | ------ | ----------------- | -------------- |
| < 100 px/s   | 23     | 0.9               | 1105           |
| 100–300 px/s | 36     | 0.9               | 1103           |
| ≥ 300 px/s   | 76     | 1.2               | 1112           |

Shaking cost 0.3 px of fit and moved f by under 1 %, so the rolling shutter
doesn't explain the 2.0 px fit and the 1298 px of the run before. That run's
paper wasn't recorded. The camera reported zoom 1 and resize none: no crop in
this run.

It self-calibrated from the prior to 1096.3 px (estimated ±0.34 %; `fit` 1113
px, 1066–1159), 2–3 % under the 1131–1146 px of earlier runs. The error was
1.05 px with it and 1.02 px with the `fit`'s value, so here the difference
cost little.

The `history` line:

- **0.2 s after the first frame:** the jump rule left the 68° prior (948.8 →
  1120.9 px). The fake camera in the e2e test takes 0.3 s.
- **1.3 s:** the exposure was set.
- **25.9 s:** the estimate was accepted (3 directions), once the phone was moved
  round the board.
- **40.6 s:** refined to 1096.3 px.

It also showed two faults:

- **The wrong source was reported.** From 0.2 s to 25.9 s it said
  `1120.9 px (prior)`: `stats.focal` reported the prior while the tracker used
  the estimate. The worker posted the estimate before the result of the frame
  that made it, and that result's earlier source overwrote it. Fixed: the
  worker now posts the result first (CHANGELOG).
- **The saved calibration wasn't used.** The saved 1298.1 px was skipped with
  `no camera of that name listed before Start`. Chrome lists camera names before
  `getUserMedia` only while camera permission is granted, and a one-time
  grant ends with the page. That is probably also why the run before started
  from the prior (its reason was overwritten). When no names are listed, the
  demo now opens the back camera briefly to get the permission prompt, then
  looks the saved camera up again.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 0, facing back | camera 3, facing front | camera 1, facing front
fps      camera 29.7, analysed 29.8, with a pose 146/149
interval 33 / 34 ms between analysed frames
no pose  3 frames in 3 runs (longest 1), tags found on them 0 / 0
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   18.8 / 25.9 ms
stages   gray 0.3 / 0.5  detect 17.7 / 24.7  pose 0.7 / 1.1  focal 0.1 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 16 / 16 used, err 1.13 / 1.79 px (0.78 / 1.17 mm on the paper)
err by r centre 1.16 px (4436 corners), middle 1.25 (3478), edge 1.70 (174); edge corners −1.02 px radially (+ = further out than the fit)
view     648 / 757 mm above the paper, tilt 34 / 39° from straight down
motion   board centre 404 / 1126 px/s in the image (≈ 2 / 5 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1096.3 px (estimated ±0.34 %); the one saved for camera 0, facing back not used: no camera of that name listed before Start; measured one saved for camera 0, facing back; first estimate 0.2 s after the first frame it could use
fit      1113 px best (1066–1159 over 12 tilted frames; long-side FOV 59.8°, ?fov=59.8), err 1.02 px with it, 1.05 px with the f in use
calib    138 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 1.0 / 1.7 px, 0.7 / 1.1 mm on the paper), 113 of them under 1 px or 1 mm, from 4 directions ≥ 10° apart (10 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.9 px, f 1105 (23), 100–300 0.9 px, f 1103 (36), ≥ 300 1.2 px, f 1112 (76)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 948.8 px (prior) · 0.2 s f 1120.9 px (prior) · 1.3 s exposure short 4.0 ms ISO 624 · 25.9 s f 1120.9 px (estimated ±0.46 %) · 25.9 s f 1106.0 px (estimated ±0.46 %) · 27.6 s f 1106.1 px (estimated ±0.33 %) · 28.1 s f 1104.8 px (estimated ±0.28 %) · 28.8 s f 1105.4 px (estimated ±0.27 %) · 32.0 s f 1102.5 px (estimated ±0.25 %) · 36.4 s f 1099.9 px (estimated ±0.27 %) · 37.3 s f 1097.5 px (estimated ±0.37 %) · 40.6 s f 1096.3 px (estimated ±0.34 %)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

After both fixes (deployed), `?exposure=4` again, the phone held still at
477 mm and 26° tilt. Chrome asked for camera permission, and the tracker
started from the saved calibration: `started from the one saved for camera 0,
facing back (1117.8 px, camera names listed after a permission prompt)`. The
saved value was 1117.8 px, not the 1096.3 px of the report before; the demo
saves every new estimate, so presumably that page kept refining after the
report was copied.

150 / 150 frames had a pose, all 16 tags were used, err 0.95 / 0.98 px (0.48
mm on the paper), homography fit 0.8 px. The `history` line has
`f 1117.8 px (provided)` from the first frame and nothing after it, as it
should for one viewing direction (accepting needs 3, and a jump needs > 10 %).

From this one direction the frames agreed on a different focal length: the
one-frame f was 1163 px over 150 frames, and the `fit` 1164 px (1160–1171),
err 0.78 px with it against 0.94 px with the 1117.8 px in use. Across runs on
camera 0 the estimates and `fit` values have ranged 1096–1164 px (±3 %; the
1298 px run aside), while within one view they agree to under 1 % and the
estimator reports ±0.3 %. Noise doesn't explain
that; something the pinhole model leaves out (a principal point away from the
image centre, or lens distortion) probably makes the best f depend on the view.
Here it cost 0.16 px.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 0, facing back | camera 3, facing front | camera 1, facing front
fps      camera 30.1, analysed 29.9, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.4 / 0.7 ms on the main thread before the transfer (bg frame: the texture upload)
worker   13.7 / 20.1 ms
stages   gray 0.3 / 0.5  detect 12.6 / 18.3  pose 0.7 / 1.2  focal 0.1 / 0.2 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.7 ms
tags     16 / 16 found, 16 / 16 used, err 0.95 / 0.98 px (0.48 / 0.50 mm on the paper)
err by r centre 0.83 px (6450 corners), middle 1.15 (3150), edge - (0)
view     477 / 478 mm above the paper, tilt 26 / 27° from straight down
motion   board centre 10 / 21 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1117.8 px (provided); started from the one saved for camera 0, facing back (1117.8 px, camera names listed after a permission prompt)
fit      1164 px best (1160–1171 over 12 tilted frames; long-side FOV 57.6°, ?fov=57.6), err 0.78 px with it, 0.94 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.8 px, 0.4 / 0.4 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (2 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1163 (150), 100–300 -, ≥ 300 -
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1117.8 px (provided) · 1.4 s exposure short 4.0 ms ISO 624
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```
