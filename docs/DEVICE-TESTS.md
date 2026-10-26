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

Without `?exposure=` (automatic exposure, 10 ms), moving at 717 mm and 29°
tilt, 330 / 763 px/s: 114 / 150 frames had a pose. The 36 without one had no
tag found (3–8 px of blur); 4 ms kept every frame of a faster shake above.

The homography fit was 2.0 / 2.2 px, the same as the 1298 px run, and 2.0 px in
every speed band, under 100 px/s too. The sheet was flat on a hard table (the
maintainer). err 2.07 px (1.72 mm on the paper), 2.06 px with the best focal
length, so the focal length isn't it. The calibration took no frame (0 of 108
under 1 px or 1 mm) and kept the saved 1117.8 px.

What it isn't:

- **distance:** 0.7 px at 670 mm on 2026-10-23;
- **motion:** the same 2.0 px under 100 px/s;
- **lens distortion:** on the demo board rendered at this geometry (720 × 1280,
  f 1118 px), with the board in the middle third of the image, even k1 = −0.3
  (11 % at the image corner) leaves only 0.49 px (0.41 px without);
- **decimation:** `'auto'` picks ×1 there, and forcing ×2 changes the fit by under
  0.1 px (blur σ 0.8–2.5 px);
- **the frame path:** an independent read-only review (Codex) of the
  VideoFrame-to-gray conversion (all formats, visible rect, strides) and the
  refinement after decimation found no defect.

Still possible:

- **a bent sheet:** 1.9 px needs about 10 mm of lift at the edges, which a flat
  table rules out;
- **edges placed off by the camera's processing:** blur with a tone curve unlike
  the detector's gamma 2.2 makes every tag look bigger or smaller than printed.
  Rendered with linear encoding and σ 1.5 px of blur, all 16 tags came out
  1.0–1.1 px too big, a 1.08 px fit (0.14 px with gamma 2.2). Sharpening or
  focus may add to that; how much is not known;
- **random corner error.**

The report now has a `corners` line: the detected corners of the window's
stillest frame. `scripts/refit-corners.ts` refits them. Each cause leaves its
own mark on the synthetic frames:

- **lens:** a radial term takes most of the error out;
- **bent sheet:** each half of the board fits alone, 0.6 px against 1.9 px;
- **edge placement:** taking each tag's expansion out leaves 0.25 px of the
  1.08 px;
- **random corner error:** nothing helps.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url -
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 0, facing back | camera 3, facing front | camera 1, facing front
fps      camera 30.1, analysed 29.9, with a pose 114/150
interval 33 / 50 ms between analysed frames
no pose  36 frames in 9 runs (longest 7), tags found on them 0 / 0
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   19.9 / 26.3 ms
stages   gray 0.3 / 0.4  detect 18.7 / 25.4  pose 0.7 / 1.2  focal 0.0 / 0.1 ms
bg age   19 / 35 ms at render
pose age 19 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 16 / 16 used, err 2.07 / 2.27 px (1.72 / 1.83 mm on the paper)
err by r centre 2.01 px (5140 corners), middle 2.22 (1240), edge - (0)
view     717 / 722 mm above the paper, tilt 29 / 30° from straight down
motion   board centre 330 / 763 px/s in the image (≈ 3 / 8 px of blur at 10.0 ms)
exposure 10.0 ms, continuous, ISO 250, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200
focal    1117.8 px (provided); started from the one saved for camera 0, facing back (1117.8 px, camera names listed after a permission prompt)
fit      1077 px best (1056–1153 over 12 tilted frames; long-side FOV 61.5°, ?fov=61.5), err 2.06 px with it, 2.08 px with the f in use
calib    108 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 2.0 / 2.2 px, 1.5 / 1.7 mm on the paper), 0 of them under 1 px or 1 mm, from 0 directions ≥ 10° apart (3 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 2.0 px, f 1084 (21), 100–300 2.0 px, f 1067 (28), ≥ 300 2.0 px, f 1068 (55)
history  0.0 s camera camera 0, facing back · 0.0 s f 1117.8 px (provided)
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Shaking at the same spot with `?exposure=4` (576 mm, 31° tilt, 766 / 1571 px/s):
144 / 149 frames had a pose; the 5 lost were single frames with no tag found.
err 1.29 / 2.06 px (0.93 mm on the paper). This time the session wasn't in the 2
px state: the homography fit was 0.9 px under 100 px/s, 1.0 px at 100–300 px/s
and 1.4 px above. The focal length was refined from the saved 1117.8 px in two
2 % steps to 1163.0 px (estimated ±0.56 %, now saved). `fit` gives 1129 px
(1006–1253), and the one-frame f by speed 1128–1147 px.

The `corners` frame (10 tags, outer corners moving 38 px/s) refitted with
`scripts/refit-corners.ts`:

- **homography fit:** 0.79 px;
- **radial term:** 0.78 px (no lens effect);
- **halves alone:** 0.72 / 0.49 px (fewer tags each, no fold);
- **tag size:** every tag smaller than printed, median −0.37 px (−0.88 to
  −0.05); without that, 0.65 px.

So even a good frame has edges placed towards the black.

On the demo board rendered at this geometry, a tone curve steeper than the
detector's gamma 2.2 has the same sign. Encoded with gamma 3.5 and blurred
σ 1.5 px:

| detector `edgeGamma` | tags vs printed | homography fit |
| -------------------- | --------------- | -------------- |
| 2.2 (default)        | −0.72 px        | 0.76 px        |
| 3.0                  | −0.22 px        | 0.25 px        |
| 3.5 (matched)        | +0.03 px        | 0.09 px        |

The demo now shows this as an `edges` line (each frame's median tag size against
the board's spacing, over the window) and takes `?edgeGamma=`. The fake camera
in the e2e test, rendered with gamma 2.2, gives +0.01 px.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 2, facing back | camera 0, facing back | camera 3, facing front | camera 1, facing front
fps      camera 30.1, analysed 29.8, with a pose 144/149
interval 33 / 34 ms between analysed frames
no pose  5 frames in 5 runs (longest 1), tags found on them 0 / 0
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   19.2 / 28.7 ms
stages   gray 0.3 / 0.4  detect 18.3 / 27.1  pose 0.5 / 1.0  focal 0.0 / 0.1 ms
bg age   19 / 35 ms at render
pose age 19 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     14 / 16 found, 14 / 16 used, err 1.29 / 2.06 px (0.93 / 1.26 mm on the paper)
err by r centre 1.45 px (4525 corners), middle 1.45 (2591), edge - (0)
view     576 / 594 mm above the paper, tilt 31 / 34° from straight down
motion   board centre 766 / 1571 px/s in the image (≈ 3 / 6 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1163.0 px (estimated ±0.56 %); started from the one saved for camera 0, facing back (1117.8 px, camera names listed after a permission prompt); measured one saved for camera 0, facing back; first estimate 2.5 s after the first frame it could use
fit      1129 px best (1006–1253 over 12 tilted frames; long-side FOV 59.1°, ?fov=59.1), err 1.25 px with it, 1.37 px with the f in use
calib    132 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 1.2 / 2.0 px, 0.8 / 1.3 mm on the paper), 83 of them under 1 px or 1 mm, from 2 directions ≥ 10° apart (4 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.9 px, f 1147 (11), 100–300 1.0 px, f 1136 (16), ≥ 300 1.4 px, f 1128 (103)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1117.8 px (provided) · 1.4 s exposure short 4.0 ms ISO 624 · 2.6 s f 1140.2 px (estimated ±0.79 %) · 3.0 s f 1163.0 px (estimated ±0.56 %)
corners  -3.9 s, outer corners 38 px/s, tilt 35°, 720×1280 fx 1163.0 fy 1163.0 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 436.4,645.7 491.0,645.5 488.6,693.3 432.7,692.9 · 115: 523.4,719.6 582.2,719.1 582.4,770.9 522.7,770.8 · 170: 610.4,391.2 661.0,386.4 663.5,424.1 612.1,427.9 · 252: 453.7,401.1 501.1,398.2 499.5,435.0 451.1,437.4 · 287: 620.1,718.4 681.2,718.1 684.0,770.7 620.9,771.7 · 415: 450.0,456.1 498.9,454.4 497.1,493.2 447.3,493.7 · 449: 446.0,515.3 496.3,513.6 494.4,554.2 442.9,556.2 · 484: 530.6,396.2 579.5,392.7 579.6,429.1 530.6,433.0 · 518: 441.1,577.0 493.9,576.5 491.9,621.1 438.0,621.3 · 580: 431.1,718.5 487.7,719.8 485.1,770.6 427.5,771.6
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Four runs at the same spot with `?exposure=4` (500–520 mm, 26–31° tilt, all 16
tags used, 146–150 / 150 frames with a pose): the detector's default
`edgeGamma` while shaking, `?edgeGamma=3.5` still, `?edgeGamma=3` still and
`?edgeGamma=3.5` shaking. The homography fit was 0.4–0.7 px in each, so none was
in the 2 px state.

A higher `edgeGamma` turned the tags from smaller than printed to bigger:

| `edgeGamma`   | run                      | `edges` (10–90 %)         | fit by speed (< 100 / 100–300 / ≥ 300 px/s) |
| ------------- | ------------------------ | ------------------------- | ------------------------------------------- |
| 2.2 (default) | shaking, 396 / 1191 px/s | −0.54 px (−0.99 to −0.31) | 0.5 / 0.6 / 0.9 px                          |
| 3.0           | still                    | +0.42 px (+0.40 to +0.44) | 0.5 / - / - px                              |
| 3.5           | still                    | +0.36 px (+0.33 to +0.38) | 0.4 / 0.5 / 0.5 px                          |
| 3.5           | shaking, 253 / 852 px/s  | +0.26 px (+0.20 to +0.36) | 0.4 / 0.4 / 0.4 px                          |

- **Both overshoot.** The sign changes between 2.2 and 3.0, at about 2.6 if
  the change is linear.
- **3.0 and 3.5 read alike.** A plain tone curve doesn't predict that: on the
  rendered board above they are 0.25 px apart. Sharpening in the camera might
  explain it; that isn't tested.
- **Motion:** with the default, the tags shrink more as the board moves faster
  and the fit grows with speed. With 3.5, neither happens.

The `corners` frames, refitted:

| run          | homography fit | radial term | tag size, median           | fit without it |
| ------------ | -------------- | ----------- | -------------------------- | -------------- |
| 2.2, shaking | 0.51 px        | 0.45 px     | −0.29 px (16 / 16 smaller) | 0.34 px        |
| 3.0, still   | 0.50 px        | 0.50 px     | +0.43 px (16 / 16 bigger)  | 0.29 px        |
| 3.5, still   | 0.41 px        | 0.41 px     | +0.32 px (15 / 16 bigger)  | 0.26 px        |
| 3.5, shaking | 0.40 px        | 0.39 px     | +0.25 px (16 / 16 bigger)  | 0.30 px        |

So edge placement is a small part of the fit: matching it exactly would leave
0.26–0.34 px. It barely moves the focal length either: growing or shrinking
every tag by 0.6 px moves these frames' one-frame f by 0.3 % (16 tags), and
report 5's frame by 1 % (10 tags).

**The focal length depends on where the paper recedes in the image:**

- **today:** the four `corners` frames give a one-frame f of 1068–1092 px, and
  the `fit` lines 1058–1075 px. The still runs' 12-frame fits were narrow:
  1067–1075 and 1071–1077 px;
- **before:** 1115–1144 px in the nine runs of 2026-10-23, and 1131 px for
  report 5's `corners` frame, at similar distances and tilts;
- **direction:** in all four of today's frames the top of the image was nearer,
  so the paper receded towards the bottom. In report 5's frame it receded
  towards the top. The 2026-10-23 runs have no `corners` line.

Moving the lens centre down from the image centre raises the one-frame f of
today's frames and lowers report 5's. At 18 px below, they agree at about
1100 px (1095–1104 px; the shaking 3.5 frame gives 1130 px). On the demo board
rendered at this geometry with the lens centre 18 px below the image centre and
f = 1100 px, the paper receding towards the top gives 1131 px, towards the
bottom 1067 px.

Two directions can't prove an offset. With the paper on a table they also can't
separate a fixed offset from one that follows the phone's attitude (gravity
shifting a stabilised lens, for example): the image edge the paper recedes
towards is where the world's up points.

The report now has a `centre` line. Since Start, it gives the one-frame f by the
image edge the paper recedes towards, and the lens centre that brings opposite
edges together. Checked on:

- **rendered frames from all four sides:** it recovers an offset of (−12, +18)
  px within 1 px, with 1 px of corner noise;
- **the fake camera in the e2e test** (paper receding towards the top): 475 px,
  against 474.4 px.

Retest with auto-rotate off, so the page stays portrait: `?exposure=4&edgeGamma=2.6`
from one spot, about 30° from straight down. Hold still about 3 s each with the
phone upright, turned a quarter left, a quarter right and upside down, then copy
one report.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 29.9, analysed 29.9, with a pose 146/150
interval 33 / 34 ms between analysed frames
no pose  4 frames in 2 runs (longest 2), tags found on them 0 / 0
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.1 / 21.5 ms
stages   gray 0.3 / 0.5  detect 13.8 / 19.9  pose 0.9 / 1.2  focal 0.1 / 0.2 ms
bg age   18 / 36 ms at render
pose age 18 / 36 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.77 / 1.47 px (0.45 / 0.78 mm on the paper)
err by r centre 1.04 px (4509 corners), middle 0.92 (4094), edge 0.87 (1); edge corners −0.86 px radially (+ = further out than the fit)
edges    tags −0.54 px bigger than printed vs the fit (10–90 %: −0.99 to −0.31 over 146 frames; − = smaller, edges placed towards the black), 100 % of tags smaller; edgeGamma default (?edgeGamma=)
view     505 / 512 mm above the paper, tilt 26 / 31° from straight down
motion   board centre 396 / 1191 px/s in the image (≈ 2 / 5 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 1875, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1062.9 px (estimated ±0.94 %); started from the one saved for camera 0, facing back (1042.0 px); measured one saved for camera 0, facing back; first estimate 10.0 s after the first frame it could use
fit      1058 px best (701–1136 over 12 tilted frames; long-side FOV 62.3°, ?fov=62.3), err 1.00 px with it, 1.13 px with the f in use
calib    143 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.7 / 1.3 px, 0.4 / 0.8 mm on the paper), 136 of them under 1 px or 1 mm, from 3 directions ≥ 10° apart (4 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1069 (20), 100–300 0.6 px, f 1052 (36), ≥ 300 0.9 px, f 1049 (87)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1042.0 px (provided) · 1.5 s exposure short 4.0 ms ISO 1875 · 11.3 s f 1062.9 px (estimated ±0.94 %)
corners  -0.0 s, outer corners 37 px/s, tilt 27°, 720×1280 fx 1062.9 fy 1062.9 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 129.6,825.8 185.7,825.0 189.0,869.1 134.2,869.8 · 115: 223.8,890.2 277.8,889.2 278.7,929.8 226.2,931.1 · 170: 305.3,504.7 369.8,503.3 368.6,562.3 306.7,563.2 · 252: 96.5,505.6 161.6,505.4 165.6,564.6 102.2,564.6 · 259: 403.7,674.2 462.8,673.3 459.5,724.5 402.3,724.7 · 287: 310.4,888.4 363.5,887.2 363.4,928.0 310.8,928.9 · 319: 406.3,591.8 467.9,591.4 464.2,646.0 404.9,646.8 · 389: 396.4,886.3 449.4,885.3 447.2,925.7 395.1,927.1 · 415: 105.3,594.9 168.0,594.3 172.0,649.3 111.1,650.4 · 442: 400.9,750.7 458.0,749.2 455.0,796.3 399.8,797.4 · 449: 114.0,677.5 174.0,677.0 178.3,728.3 119.2,728.7 · 478: 409.7,503.3 472.9,503.0 469.1,562.0 407.5,562.3 · 484: 201.4,504.7 265.7,504.4 267.8,563.3 204.8,563.9 · 518: 122.0,754.7 180.1,753.6 183.9,800.8 127.0,802.6 · 523: 398.7,820.9 453.9,819.6 450.7,863.1 397.1,864.5 · 580: 136.5,892.2 190.7,891.1 193.9,931.8 141.1,933.4
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=3.5
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.0, analysed 29.9, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.4 / 0.6 ms on the main thread before the transfer (bg frame: the texture upload)
worker   21.6 / 27.6 ms
stages   gray 0.3 / 0.5  detect 20.4 / 26.3  pose 0.7 / 1.0  focal 0.1 / 0.2 ms
bg age   34 / 51 ms at render
pose age 34 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.8 ms
tags     16 / 16 found, 16 / 16 used, err 0.50 / 0.53 px (0.32 / 0.33 mm on the paper)
err by r centre 0.48 px (7330 corners), middle 0.57 (2270), edge - (0)
edges    tags +0.36 px bigger than printed vs the fit (10–90 %: +0.33 to +0.38 over 150 frames; − = smaller, edges placed towards the black), 0 % of tags smaller; edgeGamma 3.5 (?edgeGamma=)
view     500 / 501 mm above the paper, tilt 29 / 29° from straight down
motion   board centre 8 / 39 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1042.0 px (provided); started from the one saved for camera 0, facing back (1042.0 px)
fit      1069 px best (1067–1075 over 12 tilted frames; long-side FOV 61.8°, ?fov=61.8), err 0.45 px with it, 0.50 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.4 / 0.5 px, 0.3 / 0.3 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (2 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.4 px, f 1070 (140), 100–300 0.5 px, f 1068 (4), ≥ 300 0.5 px, f 1068 (6)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1042.0 px (provided) · 1.4 s exposure short 4.0 ms ISO 624
corners  -2.0 s, outer corners 1 px/s, tilt 29°, 720×1280 fx 1042.0 fy 1042.0 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 198.6,812.4 252.0,812.7 254.8,853.7 202.6,853.9 · 115: 286.4,873.4 338.3,873.6 338.8,912.4 288.5,912.3 · 170: 367.4,516.5 429.1,516.5 428.2,572.5 367.6,572.5 · 252: 169.4,516.7 231.4,516.5 234.9,572.9 174.7,573.4 · 259: 459.8,676.5 517.2,676.4 513.6,724.5 457.2,724.6 · 287: 368.2,873.7 420.1,873.8 418.7,912.5 368.4,912.4 · 319: 462.9,599.4 523.0,599.4 518.8,651.6 460.6,651.9 · 389: 450.6,873.8 502.4,874.0 499.0,912.5 448.5,912.6 · 415: 177.3,599.5 236.9,599.5 240.3,651.7 182.4,651.6 · 442: 456.3,747.5 512.0,747.3 508.1,791.9 454.1,792.1 · 449: 184.9,676.5 242.1,676.5 245.5,724.5 189.7,724.4 · 478: 466.7,515.9 529.0,516.5 524.7,572.8 464.1,572.5 · 484: 268.1,516.6 330.5,516.5 331.6,572.4 271.0,572.6 · 518: 192.0,746.7 247.4,747.1 250.5,791.6 196.6,791.5 · 523: 453.1,812.9 506.8,812.9 503.6,854.4 451.2,854.3 · 580: 204.6,873.4 256.3,873.3 259.0,912.2 208.6,912.2
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=3
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.0, analysed 29.8, with a pose 150/150
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   22.2 / 29.7 ms
stages   gray 0.3 / 0.4  detect 21.1 / 28.3  pose 0.7 / 1.0  focal 0.1 / 0.1 ms
bg age   34 / 42 ms at render
pose age 34 / 42 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.58 / 0.60 px (0.38 / 0.39 mm on the paper)
err by r centre 0.57 px (8498 corners), middle 0.65 (1102), edge - (0)
edges    tags +0.42 px bigger than printed vs the fit (10–90 %: +0.40 to +0.44 over 150 frames; − = smaller, edges placed towards the black), 0 % of tags smaller; edgeGamma 3 (?edgeGamma=)
view     511 / 515 mm above the paper, tilt 31 / 31° from straight down
motion   board centre 9 / 20 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 1875, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1042.0 px (provided); started from the one saved for camera 0, facing back (1042.0 px)
fit      1074 px best (1071–1077 over 12 tilted frames; long-side FOV 61.6°, ?fov=61.6), err 0.52 px with it, 0.59 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.5 / 0.5 px, 0.3 / 0.3 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (3 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1073 (150), 100–300 -, ≥ 300 -
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1042.0 px (provided) · 1.5 s exposure short 4.0 ms ISO 1875
corners  -2.1 s, outer corners 3 px/s, tilt 31°, 720×1280 fx 1042.0 fy 1042.0 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 183.3,774.2 234.7,776.0 238.4,816.5 188.0,814.6 · 115: 269.0,836.2 319.1,838.1 320.6,875.9 271.7,874.1 · 170: 340.7,489.0 402.4,490.5 401.6,545.9 342.0,544.3 · 252: 149.9,486.5 209.6,486.8 214.2,542.5 156.3,541.3 · 259: 434.0,648.5 490.8,649.7 488.0,697.6 432.5,695.8 · 287: 348.2,839.2 398.5,841.0 398.4,878.9 349.3,877.0 · 319: 435.9,572.4 495.1,574.1 492.2,625.3 435.0,624.3 · 389: 428.3,841.9 479.3,843.8 477.1,881.8 427.4,880.0 · 415: 159.0,566.4 216.4,568.3 220.5,618.8 164.9,617.9 · 442: 431.9,718.0 486.8,719.6 484.0,763.5 430.9,762.0 · 449: 167.6,641.3 222.8,643.1 227.0,690.1 173.2,688.3 · 478: 438.2,490.6 499.8,491.9 496.8,547.6 436.7,546.8 · 484: 244.8,487.7 305.2,488.3 307.4,543.6 248.3,543.1 · 518: 175.6,710.2 228.9,712.0 232.9,755.4 180.9,753.9 · 523: 430.3,782.5 483.0,784.0 480.7,824.7 428.9,823.0 · 580: 190.3,833.7 240.0,835.2 243.2,872.9 194.7,871.5
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=3.5
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.1, analysed 29.9, with a pose 150/150
interval 33 / 33 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   18.0 / 24.7 ms
stages   gray 0.3 / 0.5  detect 16.4 / 23.7  pose 0.8 / 1.0  focal 0.1 / 0.2 ms
bg age   18 / 34 ms at render
pose age 18 / 34 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.61 / 0.85 px (0.37 / 0.53 mm on the paper)
err by r centre 0.61 px (6795 corners), middle 0.74 (2617), edge - (0)
edges    tags +0.26 px bigger than printed vs the fit (10–90 %: +0.20 to +0.36 over 150 frames; − = smaller, edges placed towards the black), 7 % of tags smaller; edgeGamma 3.5 (?edgeGamma=)
view     519 / 578 mm above the paper, tilt 27 / 31° from straight down
motion   board centre 253 / 852 px/s in the image (≈ 1 / 3 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1042.0 px (estimated ±0.98 %); started from the one saved for camera 0, facing back (1162.8 px, camera names listed after a permission prompt); measured one saved for camera 0, facing back; first estimate 4.6 s after the first frame it could use
fit      1075 px best (987–1101 over 12 tilted frames; long-side FOV 61.6°, ?fov=61.6), err 0.47 px with it, 0.56 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.4 / 0.5 px, 0.3 / 0.3 mm on the paper), 150 of them under 1 px or 1 mm, from 3 directions ≥ 10° apart (5 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.4 px, f 1087 (27), 100–300 0.4 px, f 1045 (63), ≥ 300 0.4 px, f 1074 (60)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1162.8 px (provided) · 1.3 s exposure short 4.0 ms ISO 624 · 66.5 s f 1139.6 px (estimated ±0.84 %) · 70.0 s f 1023.2 px (estimated ±0.10 %) · 75.0 s f 1042.0 px (estimated ±0.98 %)
corners  -0.3 s, outer corners 55 px/s, tilt 28°, 720×1280 fx 1042.0 fy 1042.0 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 175.2,753.2 234.0,748.6 236.2,797.2 178.5,802.4 · 115: 270.2,817.3 325.8,812.2 325.4,857.1 271.3,862.7 · 170: 365.9,397.2 429.2,396.1 427.0,459.2 364.3,461.8 · 252: 152.3,403.7 220.7,402.0 223.2,466.9 156.5,469.8 · 259: 456.9,574.8 514.3,571.4 510.3,626.0 453.7,629.6 · 287: 357.9,809.1 411.8,804.0 409.4,848.9 356.8,854.0 · 319: 461.7,487.9 521.6,485.3 516.7,543.7 458.2,546.9 · 389: 443.0,801.3 495.5,796.0 491.7,840.5 440.3,845.5 · 415: 158.6,501.1 224.2,498.6 226.6,559.0 162.3,562.3 · 442: 452.1,655.8 508.1,651.5 503.6,702.3 449.0,707.0 · 449: 164.4,591.6 227.6,587.7 229.7,644.3 167.9,648.2 · 478: 466.7,395.0 529.0,393.6 523.6,455.8 463.3,457.9 · 484: 260.7,400.8 327.2,398.8 326.6,463.1 262.0,465.4 · 518: 169.9,675.4 231.2,671.0 233.0,723.4 173.5,728.1 · 523: 447.2,731.1 501.6,726.4 497.5,773.7 444.7,778.4 · 580: 180.3,825.8 237.1,820.2 238.9,865.9 183.3,871.6
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

The retest, with `?exposure=4&edgeGamma=2.6`: one report at the end, after
turning the phone in its own plane at one spot. The report's own window (the
last 5 s) was nearly straight down: 839 mm above the paper, 5–13° tilt.

- **`edges`:** tags +0.14 px bigger than printed (10–90 %: +0.07 to +0.17), 14 %
  of them smaller. 2.6 is near the zero: −0.54 px at 2.2, +0.26 to +0.42 px at
  3.0–3.5. The earlier runs were at 500 mm and about 30°, though, and this one
  is a single run.
- **The `corners` frame** (839 mm, 5°) refits to 0.44 px. A radial term gives
  0.43 px, the halves 0.38–0.45 px, and matching the tag sizes 0.41 px. Nothing
  stands out, so it is plain corner noise at this distance.
- **`centre`:** bottom 1160 px (83 frames), left 1134 px (172), right 1147 px
  (118), top none. Left and right agree at 1141 px with the lens centre 2 px
  left of the image centre. The hold that should have counted for the top was
  probably under 20° tilt.
- **The library's estimate:** 1191.6 px (±0.21 %), above every edge's median.

This doesn't support a fixed lens-centre offset as the cause of the spread
between sessions. The paper receded towards the bottom of the image here, as in
the four runs above (their `corners` frames have the bigger tags at the top),
yet the bottom gave 1160 px here and 1058–1092 px there. A fixed offset moves
one direction's focal length the same way every time: 18 px below the image
centre would put the bottom 2–4 % under left and right (at 20–40° tilt), where
it reads 1.7 % over. The estimates for camera 0 on this phone since 2026-10-23
range over 1023–1298 px, while still holds within a session agree to about
±0.5 %.

Two things in the software add to the spread of the estimates:

- **The jump rule takes one view's focal length.** It needs 5 quality frames
  in a row, each more than 10 % from the focal length in use and within 5 % of
  each other, and jumps to their median (`src/pose/focal.ts`, `tryJump`). In a
  still hold consecutive frames agree to about ±0.4 % (the 12-frame `fit` ranges
  above), so the five frames are one view, and the result is that view's focal
  length. Views differ by several percent, and the first one more than 10 % off
  wins. This time that was most likely 1191.6 px from 1062.9 px: its ±0.21 % fits
  five consecutive frames, not views from several directions. This morning
  1162.8 → 1023.2 px went the same way. The demo starts each session from the
  value saved by the last one, so a one-view value carries over.
- **Chrome asks for video stabilisation whenever the camera offers it**
  (`VideoCaptureCamera2.java` in Chromium's current main; not checked against
  Chrome 155), and for `EDGE_MODE_FAST` sharpening. Stabilisation crops the
  picture and moves the crop with the phone's motion. That would move the lens
  centre between holds and sessions. Whether this phone offers stabilisation is
  unknown, and the web has no constraint to turn it off. The sharpening could be
  why `edgeGamma` 3.0 and 3.5 read alike.

The one-frame focal lengths don't depend on the estimator, and they still
disagree: 1058–1092 px this morning and 1160 px now, both for the bottom.

Next, a test that doesn't move the phone. Rest it at 30–45° from straight
down, leaning on something firm, with all 16 tags in view, and touch only the
screen. Open `?exposure=4&edgeGamma=2.6`, tap Start, wait 5 s and copy a report.
Copy a second one 10 s later. Then reload twice, copying one report after each
reload. Comparing the `corners` lines between the reports separates three
cases:

- **the picture changes size between page loads:** the camera's projection
  changes when it opens;
- **it shifts with the phone untouched:** the crop or the lens centre moves;
- **neither:** the camera is stable between loads, and the spread comes from how
  the phone is held.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=2.6
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.0, analysed 29.9, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   16.7 / 23.2 ms
stages   gray 0.3 / 0.5  detect 15.6 / 21.7  pose 0.8 / 1.0  focal 0.0 / 0.0 ms
bg age   19 / 51 ms at render
pose age 19 / 51 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.4 / 0.8 ms
tags     16 / 16 found, 16 / 16 used, err 0.43 / 0.48 px (0.31 / 0.34 mm on the paper)
err by r centre 0.43 px (8759 corners), middle 0.38 (761), edge - (0)
edges    tags +0.14 px bigger than printed vs the fit (10–90 %: +0.07 to +0.17 over 149 frames; − = smaller, edges placed towards the black), 14 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     839 / 842 mm above the paper, tilt 5 / 13° from straight down
motion   board centre 45 / 253 px/s in the image (≈ 0 / 1 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1191.6 px (estimated ±0.21 %); started from the one saved for camera 0, facing back (1062.9 px, camera names listed after a permission prompt); measured one saved for camera 0, facing back; first estimate 15.0 s after the first frame it could use
fit      1196 px best (1170–1229 over 6 tilted frames; long-side FOV 56.3°, ?fov=56.3), err 0.42 px with it, 0.42 px with the f in use
calib    0 frames with ≥ 6 tags at ≥ 20° tilt (homography fit - px, - mm on the paper), 0 of them under 1 px or 1 mm, from 0 directions ≥ 10° apart (4 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s -, 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top - (0), bottom 1160 (83), left 1134 (172), right 1147 (118); lens centre x −2, y not fitted (needs top and bottom) px from the image centre (+ = right, down): f 1141 px, the sides' f ±0.1 % (±0.6 % with the image centre)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1062.9 px (provided) · 1.4 s exposure short 4.0 ms ISO 624 · 49.2 s f 1191.6 px (estimated ±0.21 %)
corners  -1.4 s, outer corners 9 px/s, tilt 5°, 720×1280 fx 1191.6 fy 1191.6 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 477.3,578.2 432.7,576.8 432.9,531.9 478.3,533.6 · 115: 407.2,509.7 361.4,508.0 363.1,464.1 407.4,465.2 · 170: 326.0,847.7 280.2,846.2 281.4,800.2 327.4,801.2 · 252: 472.9,850.5 426.9,849.5 428.1,804.1 473.6,804.6 · 259: 257.0,707.6 211.2,706.9 212.0,661.2 258.0,662.3 · 287: 334.3,507.6 290.4,506.2 290.8,461.4 336.3,463.5 · 319: 254.3,776.3 208.9,775.9 210.0,729.2 256.5,731.0 · 389: 263.1,505.0 218.0,504.3 219.9,460.0 264.9,460.8 · 415: 474.0,781.6 427.9,780.8 429.5,735.4 474.7,735.8 · 442: 259.1,639.8 213.3,638.0 214.8,593.0 259.8,594.8 · 449: 475.2,712.9 429.9,712.2 430.8,666.5 476.1,668.5 · 478: 252.6,846.2 206.2,844.4 207.6,798.1 253.9,799.8 · 484: 399.4,848.9 353.5,848.2 354.8,801.5 400.0,803.4 · 518: 476.7,645.0 431.5,644.3 431.7,599.2 477.5,600.0 · 523: 260.5,571.8 215.2,570.8 217.1,526.1 262.7,527.0 · 580: 478.4,511.4 433.4,510.5 434.1,466.1 478.5,467.5
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

Propped phone, first two reports (`?exposure=4&edgeGamma=2.6`, saved 1191.6 px):
736 and 742 mm above the paper at 10–11° tilt. That is too flat for the `fit`,
`calib` and `centre` lines, but enough to compare the corners.

- **Between the two `corners` frames:** the picture is 0.73 % smaller, turned
  0.88° and shifted by (−8.6, +12.0) px. A scale, rotation and shift leave
  0.45 px, the frames' own noise (homography fits 0.46 and 0.51 px). The
  reported height changes with the scale (736 → 742 mm). Whether the page was
  reloaded between them, and whether the phone moved, isn't recorded.
- **`edges`:** −0.14 and −0.15 px, against +0.14 px in the run above. So
  `edgeGamma` 2.6 lands within ±0.15 px of zero.
- **Refits:** a radial term (k1 ≈ 0.10, about 25 px at the image corner) takes
  0.46 → 0.42 px and 0.51 → 0.47 px; nothing else stands out.

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=2.6
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.0, analysed 29.9, with a pose 150/150
interval 33 / 34 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.5 ms on the main thread before the transfer (bg frame: the texture upload)
worker   18.9 / 24.5 ms
stages   gray 0.3 / 0.4  detect 17.8 / 23.0  pose 0.8 / 1.0  focal 0.0 / 0.1 ms
bg age   18 / 35 ms at render
pose age 18 / 35 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.6 ms
tags     16 / 16 found, 16 / 16 used, err 0.57 / 0.61 px (0.36 / 0.38 mm on the paper)
err by r centre 0.58 px (7697 corners), middle 0.54 (1899), edge - (0)
edges    tags −0.14 px bigger than printed vs the fit (10–90 %: −0.20 to −0.08 over 150 frames; − = smaller, edges placed towards the black), 86 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     736 / 740 mm above the paper, tilt 11 / 11° from straight down
motion   board centre 8 / 15 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1191.6 px (provided); started from the one saved for camera 0, facing back (1191.6 px)
fit      - (hold still at ≥ 15° tilt with ≥ 6 tags in view)
calib    0 frames with ≥ 6 tags at ≥ 20° tilt (homography fit - px, - mm on the paper), 0 of them under 1 px or 1 mm, from 0 directions ≥ 10° apart (0 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s -, 100–300 -, ≥ 300 -
centre   - (hold still at ≥ 20° tilt with ≥ 6 tags in view)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1191.6 px (provided) · 1.4 s exposure short 4.0 ms ISO 624
corners  -3.3 s, outer corners 3 px/s, tilt 11°, 720×1280 fx 1191.6 fy 1191.6 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 178.9,680.6 229.2,680.3 230.4,728.3 180.2,729.8 · 115: 261.2,752.9 312.0,752.9 312.4,800.1 262.9,800.6 · 170: 339.2,365.5 391.0,365.5 391.0,419.5 339.4,419.6 · 252: 167.6,366.6 220.7,366.6 222.9,420.2 169.8,420.6 · 259: 422.9,525.5 473.6,525.5 473.4,576.1 422.8,577.1 · 287: 341.6,752.1 391.1,751.5 391.0,799.6 341.8,799.7 · 319: 423.0,446.6 474.6,446.6 474.5,498.7 422.9,498.9 · 389: 421.8,751.7 471.2,751.4 469.7,798.3 420.5,798.8 · 415: 170.6,447.9 223.2,447.5 223.8,500.3 172.3,500.7 · 442: 422.3,603.0 472.9,602.9 472.2,652.4 421.6,653.6 · 449: 173.1,527.3 225.1,526.6 226.4,578.4 174.9,578.5 · 478: 423.2,365.5 476.3,365.5 475.1,419.5 423.1,419.5 · 484: 253.2,365.9 305.8,365.5 307.2,419.6 254.7,419.7 · 518: 176.0,604.5 226.9,604.4 228.7,654.6 177.4,654.7 · 523: 421.6,678.1 472.6,677.9 470.8,726.7 421.6,727.5 · 580: 181.1,753.2 231.4,753.2 232.8,801.0 183.1,801.2
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=2.6
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 1, facing front | camera 0, facing back | camera 3, facing front | camera 2, facing back
fps      camera 30.0, analysed 29.8, with a pose 149/149
interval 33 / 50 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.6 ms on the main thread before the transfer (bg frame: the texture upload)
worker   19.3 / 25.2 ms
stages   gray 0.3 / 0.5  detect 18.2 / 23.6  pose 0.8 / 1.0  focal 0.0 / 0.1 ms
bg age   19 / 36 ms at render
pose age 19 / 36 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.7 ms
tags     16 / 16 found, 16 / 16 used, err 0.57 / 0.61 px (0.36 / 0.38 mm on the paper)
err by r centre 0.58 px (7771 corners), middle 0.56 (1765), edge - (0)
edges    tags −0.15 px bigger than printed vs the fit (10–90 %: −0.20 to −0.11 over 149 frames; − = smaller, edges placed towards the black), 90 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     742 / 744 mm above the paper, tilt 10 / 10° from straight down
motion   board centre 9 / 29 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1191.6 px (provided); started from the one saved for camera 0, facing back (1191.6 px)
fit      - (hold still at ≥ 15° tilt with ≥ 6 tags in view)
calib    0 frames with ≥ 6 tags at ≥ 20° tilt (homography fit - px, - mm on the paper), 0 of them under 1 px or 1 mm, from 0 directions ≥ 10° apart (0 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s -, 100–300 -, ≥ 300 -
centre   - (hold still at ≥ 20° tilt with ≥ 6 tags in view)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1191.6 px (provided) · 1.4 s exposure short 4.0 ms ISO 624
corners  -2.9 s, outer corners 2 px/s, tilt 10°, 720×1280 fx 1191.6 fy 1191.6 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 172.3,693.3 222.6,692.7 224.8,741.1 175.0,742.5 · 115: 255.8,764.5 305.4,764.2 307.0,810.6 257.8,812.5 · 170: 326.3,379.4 378.1,379.3 379.8,432.2 328.3,432.5 · 252: 157.4,382.4 210.3,381.3 212.1,434.8 160.1,436.3 · 259: 412.8,536.9 463.5,535.1 463.5,585.7 413.0,587.6 · 287: 335.1,763.4 384.4,761.3 385.5,809.1 336.9,809.9 · 319: 411.5,458.2 462.8,457.3 463.5,509.1 411.9,509.8 · 389: 414.3,760.7 463.4,760.1 464.1,807.1 415.7,807.7 · 415: 161.2,463.4 213.1,461.5 215.2,514.4 163.6,514.8 · 442: 413.7,613.4 463.5,612.0 463.5,662.2 414.6,662.6 · 449: 165.1,541.9 216.8,540.1 218.3,591.5 167.2,592.7 · 478: 410.5,378.3 462.4,377.3 462.4,430.3 410.6,431.3 · 484: 242.0,380.7 294.1,380.4 296.5,433.3 243.8,433.8 · 518: 168.9,618.2 219.1,617.8 221.5,667.2 171.1,668.9 · 523: 414.3,688.5 464.3,686.2 464.1,735.6 414.5,736.4 · 580: 176.0,766.9 225.8,765.1 228.0,813.2 178.3,813.9
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

### 2026-10-25, Android, Chrome 155: propped at 50°, untouched across reloads (Vercel)

The propped-phone test from the 2026-10-24 section, steeper:
`?exposure=4&edgeGamma=2.6`, the phone propped 310 mm above the paper at 50°
tilt, the paper receding towards the top of the image, all 16 tags in view.
Reports A and B 10 s apart on one page load, then C and D after one reload
each.

- **The camera keeps its picture.** Against A, with a scale, rotation and shift
  fitted to the 64 corners:
  - B, the same page 10 s later: 0.06 % bigger, moved (−1.0, +0.5) px, 0.17 px
    left;
  - C, after a reload: 0.16 % smaller, (−1.4, +0.3) px, 0.19 px left;
  - D, after another: 0.19 % smaller, (−1.2, +0.2) px, 0.18 px left (C to D:
    0.03 %, 0.2 px, 0.08 px left).

  So with the phone still, neither stabilisation nor reopening the camera
  moves the picture, and the 0.73 % and 15 px between the two 10–11° reports
  came from the phone moving. Whether stabilisation warps frames while the
  phone moves isn't tested.

- **The one-frame f repeats:** `centre` top 1127, 1130, 1128 and 1128 px;
  `fit` 1130, 1130, 1127 and 1127 px. At one view the camera's projection is
  the same each time it opens, so the spread seen for one direction before
  (1058–1092 and 1160 px for the bottom) comes from the views, not from
  reopening.
- **No lens distortion shows.** One radial term (k1 −0.002 to −0.009) leaves
  the homography fit at 0.52–0.55 px, with the board over most of the lower
  half of the image. The `err by r` line's +0.8 to +1.2 px radially at the
  edge is measured against the pose, so it probably comes from the f in use:
  the homography doesn't depend on f. The k1 ≈ 0.10 at 740 mm and 10° came
  from a small board near the centre.
- **What's left repeats.** Taking out each tag's expansion leaves 0.44–0.46 px
  after the homography, and the same tags show the same shifts in every report
  (tag 115: (−0.1, −0.4) px in A and D), while the corners move only
  0.08–0.19 px between reports. So the 0.5 px floor is in the scene (the print,
  the sheet, or how the detector sees each tag), not noise.
- **`edges`:** +0.23 to +0.27 px (15 of 16 tags bigger in the refit). With
  −0.15 px at 740 mm and +0.14 px at 840 mm, the offset moves by about
  ±0.25 px with the conditions, so no single `edgeGamma` zeroes it.
- **The focal length in use is 2 % off this view.** A started from a saved
  1034.1 px (saved by a run after the 10–11° reports, not recorded here) and
  jumped to 1152.3 px 12 s after the first frame it could use. The still
  view's one-frame f, 1127–1131 px, is under 10 % from 1034.1, so the 5 jump
  frames weren't from the still hold; probably the phone being set down after
  Start (not recorded). C and D started from 1152.3 and kept it: one direction
  gives no estimate, and 2 % is under the jump threshold. `err` is 0.91–0.98 px
  with 1152.3 and 0.56–0.59 px with the `fit` value.
- **The exposure was refused once:** in C, `?exposure=4` came back "refused or
  not applied" (10 ms, automatic), as on 2026-10-23; A, B and D got 4 ms. The
  corners don't change with it (C to D: 0.08 px).

Next: keep the propped set-up and the page open, and turn the phone in its own
plane so that the paper recedes towards the top, right, bottom and left of the
image in turn (auto-rotate off, so the page and the 720×1280 frames stay
portrait). Hold each still for 5 s and copy a report. Top against bottom, and
left against right, give the lens centre; top and bottom together against left
and right would show pixels that aren't square.

Report A in full; B, C and D without the lines that match A apart from timings:

```text
matar demo report (last 5 s)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=2.6
device   Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36
screen   412×892 css px, dpr 2.625, portrait-primary
camera   camera 0, facing back (pinned), videoframe I420 720×1280 rot 0°, analysed 720×1280
inputs   camera 0, facing back | camera 2, facing back | camera 3, facing front | camera 1, facing front
fps      camera 30.0, analysed 30.0, with a pose 150/150
interval 33 / 34 ms between analysed frames
no pose  0 frames in 0 runs (longest 0), tags found on them -
grab     0.3 / 0.4 ms on the main thread before the transfer (bg frame: the texture upload)
worker   15.8 / 21.5 ms
stages   gray 0.3 / 0.4  detect 14.4 / 19.7  pose 0.8 / 1.1  focal 0.1 / 0.1 ms
bg age   18 / 34 ms at render
pose age 18 / 34 ms at render
pose lag 0 / 0 ms behind the background (0 with bg frame)
render   0.3 / 0.5 ms
tags     16 / 16 found, 16 / 16 used, err 0.91 / 0.91 px (0.42 / 0.42 mm on the paper)
err by r centre 0.93 px (4896 corners), middle 0.85 (4200), edge 1.11 (300); edge corners +0.83 px radially (+ = further out than the fit)
edges    tags +0.26 px bigger than printed vs the fit (10–90 %: +0.21 to +0.27 over 150 frames; − = smaller, edges placed towards the black), 6 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     310 / 310 mm above the paper, tilt 50 / 50° from straight down
motion   board centre 2 / 3 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
exposure 4.0 ms, none, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1152.3 px (estimated ±0.45 %); started from the one saved for camera 0, facing back (1034.1 px); measured one saved for camera 0, facing back; first estimate 12.0 s after the first frame it could use
fit      1130 px best (1130–1130 over 12 tilted frames; long-side FOV 59.1°, ?fov=59.1), err 0.58 px with it, 0.91 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.5 / 0.5 px, 0.2 / 0.2 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1131 (150), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1127 (1450), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1034.1 px (provided) · 1.4 s exposure short 4.0 ms ISO 624 · 12.0 s f 1152.3 px (estimated ±0.45 %)
corners  -2.2 s, outer corners 1 px/s, tilt 50°, 720×1280 fx 1152.3 fy 1152.3 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 90.6,842.1 182.7,839.5 170.6,917.1 73.0,918.7 · 115: 224.7,958.1 327.2,957.1 324.2,1052.1 214.8,1052.8 · 170: 379.1,521.9 446.4,520.1 450.6,560.6 379.6,562.3 · 252: 164.5,526.5 231.2,525.2 225.5,565.6 155.2,567.2 · 259: 506.8,652.1 585.1,650.3 597.7,704.2 514.9,706.8 · 287: 388.3,957.3 491.1,954.6 500.6,1049.8 390.2,1051.5 · 319: 496.0,580.5 568.5,579.1 579.3,625.5 503.2,627.7 · 389: 552.5,954.8 655.2,952.6 677.1,1047.1 566.6,1049.0 · 415: 150.2,588.7 221.9,586.9 214.8,633.7 139.5,635.2 · 442: 519.3,736.0 604.6,734.1 619.4,798.0 529.0,799.7 · 449: 133.6,659.9 211.0,658.4 202.6,712.3 121.0,714.0 · 478: 486.7,519.5 554.2,516.5 563.4,557.5 492.6,559.7 · 484: 271.5,525.0 338.6,522.4 337.5,562.6 267.1,564.9 · 518: 114.2,743.7 198.3,740.8 188.2,804.7 99.0,807.4 · 523: 534.3,834.7 627.6,833.0 645.6,909.9 546.2,912.2 · 580: 63.0,961.0 164.2,959.7 149.8,1054.5 41.2,1054.7
(median / 90th percentile; ages count from each frame’s expected display time, so < 0 = not on screen yet)
```

```text
B (same page, 10 s later)
tags     16 / 16 found, 16 / 16 used, err 0.91 / 0.92 px (0.42 / 0.42 mm on the paper)
err by r centre 0.93 px (5032 corners), middle 0.87 (4200), edge 1.15 (300); edge corners +0.92 px radially (+ = further out than the fit)
edges    tags +0.27 px bigger than printed vs the fit (10–90 %: +0.24 to +0.28 over 150 frames; − = smaller, edges placed towards the black), 6 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
fit      1130 px best (1130–1130 over 12 tilted frames; long-side FOV 59.0°, ?fov=59.0), err 0.59 px with it, 0.91 px with the f in use
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1130 (2059), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -3.4 s, outer corners 0 px/s, tilt 50°, 720×1280 fx 1152.3 fy 1152.3 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 89.4,842.3 181.5,840.2 169.3,917.7 71.7,918.9 · 115: 223.4,958.5 325.8,957.8 323.0,1052.9 213.4,1053.7 · 170: 377.9,522.1 445.6,520.3 449.9,560.9 379.3,562.6 · 252: 163.7,526.8 230.6,525.3 224.7,565.7 154.2,567.7 · 259: 505.9,652.4 584.4,651.1 596.9,705.1 514.1,707.2 · 287: 387.1,958.1 489.8,955.1 499.4,1050.7 388.8,1052.3 · 319: 495.2,580.9 567.8,579.6 578.6,626.0 502.5,628.1 · 389: 551.4,955.6 654.1,953.2 676.0,1048.1 565.4,1049.8 · 415: 149.3,589.1 221.1,587.1 213.9,634.1 138.5,635.7 · 442: 518.4,736.4 603.7,734.7 618.5,798.8 527.9,799.9 · 449: 132.8,660.0 210.0,658.9 201.6,712.6 119.9,714.6 · 478: 486.0,520.1 553.5,516.9 562.7,558.0 491.9,560.0 · 484: 270.8,525.1 337.7,522.8 336.8,563.0 266.3,565.1 · 518: 113.1,743.9 197.2,741.3 187.1,805.3 97.8,807.8 · 523: 533.2,834.7 626.7,834.2 644.7,910.8 545.1,912.7 · 580: 61.6,961.5 162.9,960.3 148.4,1055.0 39.6,1055.4

C (after a reload)
tags     16 / 16 found, 16 / 16 used, err 0.98 / 0.99 px (0.44 / 0.44 mm on the paper)
err by r centre 1.02 px (5100 corners), middle 0.90 (4200), edge 1.39 (300); edge corners +1.20 px radially (+ = further out than the fit)
edges    tags +0.25 px bigger than printed vs the fit (10–90 %: +0.24 to +0.26 over 150 frames; − = smaller, edges placed towards the black), 6 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     311 / 311 mm above the paper, tilt 50 / 50° from straight down
motion   board centre 1 / 2 px/s in the image (≈ 0 / 0 px of blur at 10.0 ms)
exposure 10.0 ms, continuous, ISO 624, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): refused or not applied: back to automatic
focal    1152.3 px (provided); started from the one saved for camera 0, facing back (1152.3 px)
fit      1127 px best (1126–1127 over 12 tilted frames; long-side FOV 59.2°, ?fov=59.2), err 0.58 px with it, 0.98 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.5 / 0.5 px, 0.2 / 0.2 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1128 (150), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1128 (394), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1152.3 px (provided) · 1.4 s exposure refused 10.0 ms ISO 624
corners  -4.2 s, outer corners 0 px/s, tilt 50°, 720×1280 fx 1152.3 fy 1152.3 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 89.5,842.1 181.5,839.6 169.2,917.0 71.7,918.7 · 115: 223.2,958.1 325.2,957.1 322.6,1052.1 213.2,1052.7 · 170: 377.7,522.4 445.1,520.5 449.3,561.4 378.4,562.8 · 252: 163.8,527.3 230.7,525.3 224.7,566.0 154.3,567.8 · 259: 505.1,652.3 583.4,651.0 595.9,704.7 513.2,707.1 · 287: 386.4,957.2 488.9,954.6 498.5,1049.7 388.3,1051.4 · 319: 494.3,580.8 567.0,580.0 577.7,626.2 501.7,628.2 · 389: 550.4,954.8 652.9,952.7 674.8,1047.3 564.4,1048.9 · 415: 149.4,589.3 221.1,587.3 213.9,634.1 138.5,635.8 · 442: 517.5,736.1 602.7,734.5 617.4,798.2 527.1,799.8 · 449: 132.8,659.9 210.0,658.9 201.6,712.6 120.1,714.4 · 478: 485.2,520.1 552.8,517.3 561.9,558.2 491.2,560.0 · 484: 270.6,525.4 337.7,523.1 336.4,563.3 266.1,565.3 · 518: 113.2,743.7 197.2,741.1 187.1,804.7 98.0,807.6 · 523: 532.5,834.7 625.5,833.3 643.5,910.1 544.2,912.1 · 580: 61.8,961.0 162.8,959.7 148.3,1054.3 39.7,1054.6

D (after another reload)
tags     16 / 16 found, 16 / 16 used, err 0.97 / 0.98 px (0.44 / 0.44 mm on the paper)
err by r centre 1.01 px (5100 corners), middle 0.89 (4200), edge 1.33 (300); edge corners +1.13 px radially (+ = further out than the fit)
edges    tags +0.23 px bigger than printed vs the fit (10–90 %: +0.22 to +0.23 over 150 frames; − = smaller, edges placed towards the black), 6 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     311 / 311 mm above the paper, tilt 50 / 50° from straight down
motion   board centre 1 / 2 px/s in the image (≈ 0 / 0 px of blur at 4.0 ms)
focal    1152.3 px (provided); started from the one saved for camera 0, facing back (1152.3 px)
fit      1127 px best (1127–1127 over 12 tilted frames; long-side FOV 59.2°, ?fov=59.2), err 0.56 px with it, 0.98 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.5 / 0.5 px, 0.2 / 0.2 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1128 (150), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1128 (584), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
history  0.0 s camera camera 0, facing back · 0.0 s exposure pending · 0.0 s f 1152.3 px (provided) · 1.4 s exposure short 4.0 ms ISO 624
corners  -3.5 s, outer corners 1 px/s, tilt 50°, 720×1280 fx 1152.3 fy 1152.3 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 89.9,842.2 181.7,839.6 169.6,916.9 72.2,918.5 · 115: 223.6,958.0 325.5,956.9 322.8,1051.9 213.7,1052.6 · 170: 377.7,522.4 445.2,520.6 449.5,561.4 378.7,562.7 · 252: 163.9,527.4 230.8,525.4 224.9,566.1 154.6,567.8 · 259: 505.3,652.3 583.6,651.1 596.0,704.8 513.4,707.0 · 287: 386.7,957.2 489.1,954.5 498.7,1049.5 388.7,1051.3 · 319: 494.6,580.9 567.1,579.9 577.8,626.1 501.8,628.2 · 389: 550.7,954.8 653.1,952.6 674.9,1047.1 564.7,1048.8 · 415: 149.6,589.5 221.3,587.2 214.2,634.1 138.8,635.9 · 442: 517.7,736.2 602.9,734.4 617.5,798.1 527.3,799.7 · 449: 133.1,659.9 210.2,658.9 201.9,712.5 120.4,714.3 · 478: 485.4,520.1 552.9,517.4 562.0,558.2 491.3,560.1 · 484: 270.8,525.6 337.7,523.1 336.7,563.2 266.3,565.4 · 518: 113.6,743.7 197.5,741.2 187.3,804.8 98.3,807.4 · 523: 532.7,834.7 625.6,833.3 643.6,910.0 544.4,911.9 · 580: 62.2,961.0 163.0,959.7 148.6,1054.2 40.2,1054.5
```

### 2026-10-25, Android, Chrome 155: four orientations and the lens centre (Vercel)

The next test from the section above: `?exposure=4&edgeGamma=2.6`, the phone
propped at 45–51° tilt and 210–270 mm above the paper, turned clockwise in
its own plane a quarter turn at a time from the normal way up. Each
orientation was a new page load: each report's `history` starts at 0, and its
`centre` line has one side. The first report (normal way up) was copied before
the camera started (all `-`), so the top view below is report D of the 50° run
above. That run's camera kept its picture across reloads.

- **The paper receding towards each edge, one-frame f with the lens centre at
  the image centre:** top 1128 (50° run, D), left 1122 (turned 90°
  clockwise), bottom 1098 (upside down), right 1123 px (270° clockwise).
  Top and bottom differ by 2.7 %; left and right agree.
- **A joint fit of the four `corners` lines** (a pose per view, one f and one
  lens centre for all, Levenberg–Marquardt; the same result from f 1050 and
  1200 px):
  - lens centre at the image centre: f 1120 px, 1.00 px RMS;
  - lens centre free: (−1.3, +18.7) px from the image centre (+ = right,
    down), f 1120 px, 0.68 px RMS;
  - the board's upper half only (tag rows at z ≤ 24 mm): (−2.7, +20.1) px,
    f 1110 px, 0.50 → 0.40 px RMS; the lower half only: (−0.4, +18.6) px,
    f 1125 px.
- **With that lens centre the four views agree.** One-frame f for the upper
  half at (−2.7, +20.1): top 1109, right 1112, bottom 1109, left 1109 px. For
  all tags at (−1.3, +18.7): 1112, 1122, 1116 and 1121 px. Top and bottom
  together match left and right, so the pixels are square: aspect 1.0007 in the
  upper-half fit.
- **No lens distortion to speak of.** One radial term takes the all-tag fit
  from 0.68 to 0.65 px (5 px at the image corner) and does nothing for the
  upper half (0.1 px at the corner); a second term swings both ways. The
  large `err by r` edge values in the left and right views (2.6 and 3.1 px)
  are the board's bottom row (tags 115, 287, 389 and 580, z = 121 mm), which
  lies along the image edge in those views.
- **The board's lower half doesn't fit as well in any view.** `refit-corners`
  halves (board z, upper / lower): 0.35 / 0.94 px (left), 0.35 / 0.53 px
  (bottom), 0.41 / 0.67 px (right), 0.43–0.46 / 0.47–0.53 px (50° run). So the
  sheet near the page's bottom edge probably doesn't lie flat. It pulls the
  all-tag f up by about 1 % against the upper half.
- **What the lens centre does to the estimates.** With the lens centre assumed
  at the image centre, the one-frame f is off by about (19 / 1110) · cot(tilt):
  ±1.5 % at 50°, ±3.6 % at 25°, ±4.7 % at 20°. It reads low when the paper
  recedes towards the bottom of the image and high towards the top. At the
  estimator's 20° minimum that spans about 1060–1160 px, so a jump to one
  view's f can land anywhere in it. The pose fits worse too: 1.00 px against
  0.68 px in the joint fit.
- **`edges`:** +0.05 to +0.08 px.
- The saved f moved between loads (1129.2, 1120.1, 1117.7 px): the estimator
  measured new values while the phone was being turned.

Next: the demo's new `?centre=-2,19` (set on the saved calibration) against no
`?centre=`, two sessions each, alternating, with the sheet taped flat. In each,
hand-held, look at the paper from all four sides at 30–50° tilt, holding still
about 2 s on each, until the focal length is estimated, then copy a report. In
the first `?centre=` session, also hold the phone on each side and upside down
for a few seconds, so that its `centre` line has all four edges. Compare
`err`, `fit` and the estimates, and whether the `centre` line's sides agree.

```text
left (turned 90° clockwise)
tags     16 / 16 found, 16 / 16 used, err 1.15 / 1.16 px (0.44 / 0.45 mm on the paper)
err by r centre 0.88 px (2100 corners), middle 1.12 (7200), edge 2.59 (300); edge corners −1.45 px radially (+ = further out than the fit)
edges    tags +0.08 px bigger than printed vs the fit (10–90 %: +0.07 to +0.09 over 150 frames; − = smaller, edges placed towards the black), 38 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     213 / 213 mm above the paper, tilt 51 / 51° from straight down
focal    1129.2 px (provided); started from the one saved for camera 0, facing back (1129.2 px)
fit      1122 px best (1121–1122 over 12 tilted frames; long-side FOV 59.4°, ?fov=59.4), err 1.10 px with it, 1.15 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.8 px, 0.3 / 0.3 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1122 (150), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top - (0), bottom - (0), left 1122 (331), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -0.4 s, outer corners 0 px/s, tilt 51°, 720×1280 fx 1129.2 fy 1129.2 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 433.1,940.3 430.5,828.4 516.4,847.8 518.0,968.7 · 115: 563.0,782.0 561.5,651.3 674.9,656.4 675.9,799.4 · 170: 102.3,584.0 99.0,505.0 137.1,499.3 140.6,583.1 · 252: 112.5,831.6 110.0,755.3 148.1,763.8 151.2,844.7 · 259: 227.6,428.7 224.4,332.4 279.8,313.4 283.7,416.4 · 287: 562.3,572.1 559.3,437.8 673.8,421.8 674.9,569.2 · 319: 156.0,444.0 153.1,356.8 198.8,341.3 202.3,433.9 · 389: 559.6,356.7 554.6,220.0 668.6,181.8 672.6,332.5 · 415: 172.4,851.9 169.2,768.9 215.0,779.1 217.8,867.3 · 442: 314.5,409.7 310.5,302.9 379.5,279.3 383.3,394.6 · 449: 242.7,875.6 240.6,784.7 295.0,797.4 298.1,894.5 · 478: 97.6,456.8 93.1,377.0 131.9,363.9 135.3,448.6 · 484: 108.3,708.7 104.0,631.4 141.9,633.1 146.1,714.9 · 518: 328.6,904.7 324.8,804.4 392.6,819.9 395.4,927.4 · 523: 421.3,386.0 418.4,266.0 505.2,236.4 509.3,367.3 · 580: 566.5,985.0 564.8,858.5 676.3,883.0 675.8,1021.1

bottom (upside down)
tags     15 / 15 found, 15 / 15 used, err 0.82 / 0.82 px (0.35 / 0.35 mm on the paper)
err by r centre 0.65 px (3278 corners), middle 0.90 (5662), edge - (0)
edges    tags +0.06 px bigger than printed vs the fit (10–90 %: +0.06 to +0.07 over 149 frames; − = smaller, edges placed towards the black), 33 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     270 / 270 mm above the paper, tilt 45 / 45° from straight down
focal    1120.1 px (provided); started from the one saved for camera 0, facing back (1120.1 px)
fit      1100 px best (1100–1100 over 12 tilted frames; long-side FOV 60.4°, ?fov=60.4), err 0.54 px with it, 0.82 px with the f in use
calib    149 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.5 / 0.5 px, 0.2 / 0.2 mm on the paper), 149 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.5 px, f 1098 (149), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top - (0), bottom 1098 (402), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -0.4 s, outer corners 0 px/s, tilt 45°, 720×1280 fx 1120.1 fy 1120.1 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 635.5,581.2 534.4,576.9 546.9,496.1 654.7,501.3 · 115: 487.2,449.8 376.2,445.0 377.7,345.2 496.8,350.1 · 170: 325.9,891.4 254.8,887.4 250.1,846.5 324.5,850.6 · 252: 556.4,905.6 484.2,900.5 490.4,860.0 566.5,864.6 · 259: 188.9,747.8 107.4,743.3 93.2,687.7 179.4,691.8 · 287: 310.3,440.8 200.9,437.3 189.7,338.0 307.1,342.2 · 319: 201.1,821.7 125.7,817.2 114.0,769.5 193.1,773.7 · 415: 571.9,842.2 494.1,837.7 501.2,790.3 583.4,795.2 · 442: 174.4,661.0 85.3,656.9 68.6,590.8 163.1,595.0 · 449: 589.6,769.4 505.1,764.2 513.9,709.3 603.4,713.5 · 478: 211.6,884.1 141.5,881.3 131.2,839.7 204.7,843.8 · 484: 440.8,897.6 369.0,894.4 369.7,853.9 444.9,857.4 · 518: 610.6,683.3 518.7,679.3 528.8,613.3 626.7,617.3 · 523: 156.8,558.4 59.5,554.4 39.5,474.8 143.4,477.8 · 580: 665.2,456.4 553.5,452.1 568.2,352.6 688.7,358.4

right (turned 270° clockwise)
tags     16 / 16 found, 15 / 15 used, err 0.98 / 0.98 px (0.39 / 0.39 mm on the paper)
err by r centre 0.87 px (1950 corners), middle 0.91 (6900), edge 3.11 (150); edge corners −2.29 px radially (+ = further out than the fit)
edges    tags +0.05 px bigger than printed vs the fit (10–90 %: +0.04 to +0.07 over 150 frames; − = smaller, edges placed towards the black), 43 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     210 / 210 mm above the paper, tilt 49 / 49° from straight down
focal    1117.7 px (provided); started from the one saved for camera 0, facing back (1117.7 px)
fit      1118 px best (1117–1118 over 12 tilted frames; long-side FOV 59.6°, ?fov=59.6), err 0.98 px with it, 0.98 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.6 / 0.6 px, 0.2 / 0.2 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (1 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.6 px, f 1123 (150), 100–300 -, ≥ 300 -
centre   one-frame f by the image edge the paper recedes towards, since Start: top - (0), bottom - (0), left - (0), right 1123 (390); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -4.0 s, outer corners 0 px/s, tilt 49°, 720×1280 fx 1117.7 fy 1117.7 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 304.5,382.0 303.3,503.5 211.5,492.2 213.6,360.2 · 115: 160.0,567.7 158.5,704.3 39.1,711.0 39.7,561.2 · 170: 638.5,724.1 636.8,803.9 596.7,813.7 598.3,729.3 · 252: 645.0,465.2 642.5,546.3 602.2,541.3 604.5,455.4 · 259: 498.5,894.0 496.9,988.1 439.2,1012.6 440.4,911.9 · 287: 156.4,785.0 156.7,919.8 37.9,947.1 38.1,799.9 · 319: 573.6,871.4 571.2,957.1 523.5,976.9 525.2,886.2 · 389*: 154.3,999.2 156.2,1131.6 40.0,1179.6 38.1,1034.3 · 415: 582.3,449.9 580.1,538.5 532.0,532.6 534.3,438.0 · 442: 408.2,921.6 407.1,1026.3 336.4,1056.0 336.8,943.8 · 449: 508.1,431.8 505.0,529.2 447.5,521.8 449.3,417.4 · 478: 634.6,852.6 634.3,931.2 593.3,948.2 595.5,864.7 · 484: 641.0,595.2 640.0,675.8 600.4,678.1 601.2,593.0 · 518: 416.8,409.4 415.9,517.7 344.0,508.4 345.3,392.0 · 523: 296.9,956.5 295.9,1072.8 207.0,1110.4 206.1,983.8 · 580: 161.1,347.9 159.8,485.5 40.0,470.9 42.5,319.7
```

### 2026-10-25, Android, Chrome 155: hand-held with and without `?centre=` (Vercel)

Four hand-held sessions at 40–45° tilt and 420–437 mm above the paper, looking
from all four sides, alternating `?centre=-2,19` and no `?centre=`, with the
sheet taped down. Test 1's link lost its `,19` (`url …&centre=-2`), so it ran
with the image centre; the demo didn't say so then and does now. Test 1 also
held the phone on each side and upside down. Tests 3 and 4 ran in dimmer light
(ISO 1249 against 624).

- **The lens centre, hand-held:** Test 1's `centre` line, all four edges, with
  the image centre: top 1125, bottom 1093, left 1103, right 1106 px; lens
  centre (−1, +15) px, f 1105 px, the sides within ±0.1 % (±1.1 % with the
  image centre). The propped fit gave (−1 to −3, +17 to +20).
- **The estimates:** with the image centre, 1123.9 and 1128.4 px (Tests 2 and
  4, the paper receding towards the top) and 1113.6 px (Test 1, all four
  edges); with (−2, +19), 1094.3 px (Test 3, `fit` 1101). Each test's last
  frame gives a one-frame f of 1123–1125 px with the image centre for the top
  views (1104 in Test 1), and 1101–1104 px for all four with (−1.3, +18.7).
- **`err` doesn't change:** 0.81, 0.83 and 0.83 px in Tests 2–4 (1.00 in Test
  1), the same as the homography fit (0.80, 0.80 and 0.83 px). With the paper
  receding towards one edge, the focal estimate makes up for the lens centre
  (about 2 % high here), and the pose fits the tags as well as any homography
  can. So the lens centre shows in the focal length, and with it the scale
  (distances about 2 % long), not in how the content sits on the tags.
- **The corners set the limit:** the homography fit is 0.75–0.83 px hand-held,
  against 0.48–0.55 px propped. The board's left half alone fits to
  0.44–0.55 px and its right half (board +x) to 0.71–0.80 px, in all four tests
  and from different sides, so that part of the sheet probably isn't flat now
  (in the propped runs it was the lower half). Taking out the tag expansion
  leaves 0.68–0.71 px.
- **`edges`:** +0.12 and +0.13 px at ISO 624, −0.21 and −0.24 px at ISO 1249,
  so the offset follows the light.
- The hand-held f with the lens centre, about 1102 px, is about 1 % under the
  propped fit at 210–310 mm (1110 px on the upper half, 1120 px with all
  tags). Focus breathing at the closer distance would go that way; not
  tested.

```text
Test 1 (link cut to ?centre=-2: the image centre)
mode     bg frame, pose raw, worker module, url ?exposure=4&edgeGamma=2.6&centre=-2
tags     16 / 16 found, 16 / 16 used, err 1.00 / 1.04 px (0.61 / 0.63 mm on the paper)
edges    tags +0.12 px bigger than printed vs the fit (10–90 %: +0.07 to +0.17 over 150 frames; − = smaller, edges placed towards the black), 41 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     435 / 437 mm above the paper, tilt 45 / 45° from straight down
focal    1113.6 px (estimated ±0.41 %); started from the one saved for camera 0, facing back (1106.4 px); measured one saved for camera 0, facing back; first estimate 4.4 s after the first frame it could use
fit      1110 px best (1104–1116 over 12 tilted frames; long-side FOV 59.9°, ?fov=59.9), err 0.99 px with it, 0.99 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.8 px, 0.4 / 0.4 mm on the paper), 150 of them under 1 px or 1 mm, from 1 directions ≥ 10° apart (16 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1106 (121), 100–300 0.8 px, f 1102 (24), ≥ 300 0.8 px, f 1101 (5)
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1125 (659), bottom 1093 (187), left 1103 (150), right 1106 (165); lens centre x −1, y +15 px from the image centre (+ = right, down): f 1105 px, the sides' f ±0.1 % (±1.1 % with the image centre)
corners  -0.9 s, outer corners 5 px/s, tilt 45°, 720×1280 fx 1113.6 fy 1113.6 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 411.9,559.8 373.2,558.0 372.0,500.7 410.5,504.3 · 115: 347.6,468.9 304.2,463.6 302.4,402.3 346.7,409.9 · 170: 284.4,923.8 235.8,937.6 235.0,874.3 283.1,863.3 · 252: 416.0,887.1 376.9,897.4 376.6,841.6 415.4,833.1 · 259: 201.0,750.7 147.1,757.7 146.0,688.4 199.3,684.5 · 287: 276.0,460.6 226.3,454.9 224.4,388.9 274.8,397.5 · 319: 202.7,848.6 150.0,860.1 147.9,791.7 202.0,783.0 · 389: 193.8,451.3 140.0,444.2 138.0,373.7 193.1,383.6 · 415: 415.0,806.0 376.5,813.7 375.3,757.6 414.4,752.0 · 442: 198.4,651.8 145.1,653.9 143.1,584.3 197.0,585.1 · 449: 414.2,724.9 374.5,729.5 374.4,672.4 413.1,670.0 · 478: 205.3,945.8 152.3,962.4 150.3,894.0 204.3,880.9 · 484: 353.5,904.2 311.5,916.2 310.3,857.1 352.9,847.4 · 518: 413.1,642.4 374.5,644.1 373.5,586.7 411.9,587.4 · 523: 197.0,551.6 142.2,549.5 140.5,479.4 195.2,484.9 · 580: 409.9,476.5 371.6,471.8 370.3,413.9 409.0,420.6

Test 2 (no ?centre=)
tags     16 / 16 found, 16 / 16 used, err 0.81 / 0.82 px (0.52 / 0.53 mm on the paper)
edges    tags +0.13 px bigger than printed vs the fit (10–90 %: +0.07 to +0.18 over 150 frames; − = smaller, edges placed towards the black), 42 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     425 / 431 mm above the paper, tilt 43 / 44° from straight down
focal    1123.9 px (estimated ±0.28 %); started from the one saved for camera 0, facing back (1113.6 px); measured one saved for camera 0, facing back; first estimate 3.1 s after the first frame it could use
fit      1124 px best (1118–1126 over 12 tilted frames; long-side FOV 59.3°, ?fov=59.3), err 0.81 px with it, 0.81 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.8 px, 0.4 / 0.4 mm on the paper), 150 of them under 1 px or 1 mm, from 4 directions ≥ 10° apart (16 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1125 (104), 100–300 0.7 px, f 1123 (44), ≥ 300 0.8 px, f 1121 (2)
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1126 (546), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -0.0 s, outer corners 6 px/s, tilt 43°, 720×1280 fx 1123.9 fy 1123.9 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 235.8,536.6 235.7,576.5 176.3,579.5 178.7,539.8 · 115: 144.3,605.1 140.6,650.1 77.3,653.9 83.3,608.7 · 170: 613.7,653.5 628.9,702.1 564.5,705.6 551.9,656.8 · 252: 573.1,520.3 584.7,560.2 527.1,562.7 517.4,523.1 · 259: 439.2,745.0 448.0,798.7 377.2,802.9 371.4,748.8 · 287: 138.6,679.3 134.2,730.2 66.8,734.3 73.5,682.4 · 319: 539.3,738.9 552.2,792.1 482.5,796.4 472.4,742.5 · 389: 132.1,762.7 127.2,817.8 54.1,822.8 62.6,766.4 · 415: 489.9,524.3 498.7,563.7 440.9,566.9 433.9,526.7 · 442: 337.6,751.0 341.8,804.9 270.8,809.5 269.8,754.8 · 449: 405.9,528.0 411.8,568.5 353.5,571.0 349.6,530.9 · 478: 638.0,732.9 656.1,785.5 586.8,790.0 572.2,736.4 · 484: 592.1,584.1 605.4,626.5 545.0,629.5 533.7,586.5 · 518: 321.3,532.1 324.0,572.1 264.8,574.8 264.3,535.1 · 523: 235.6,756.3 234.5,811.8 163.2,815.9 166.8,760.4 · 580: 149.8,541.1 146.6,580.8 86.7,584.1 92.0,543.9

Test 3 (?centre=-2,19)
tags     16 / 16 found, 16 / 16 used, err 0.83 / 0.87 px (0.56 / 0.57 mm on the paper)
edges    tags −0.21 px bigger than printed vs the fit (10–90 %: −0.38 to −0.13 over 150 frames; − = smaller, edges placed towards the black), 78 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     420 / 425 mm above the paper, tilt 40 / 41° from straight down
exposure 4.0 ms, none, ISO 1249, 30 fps, focus continuous, focus distance 0, zoom 1, resize none; settable: modes continuous/manual, time 0.0–150.0 ms, ISO 12–3200; ?exposure=4 (camera.maxExposureMs): set
focal    1094.3 px (estimated ±0.33 %); started from the one saved for camera 0, facing back (1123.9 px, camera names listed after a permission prompt); lens centre x −2, y +19 px from the image centre (?centre=); measured one saved for camera 0, facing back; first estimate 3.2 s after the first frame it could use
fit      1101 px best (1082–1109 over 12 tilted frames; long-side FOV 60.3°, ?fov=60.3), err 0.82 px with it, 0.84 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.9 px, 0.5 / 0.5 mm on the paper), 150 of them under 1 px or 1 mm, from 5 directions ≥ 10° apart (15 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1102 (101), 100–300 0.8 px, f 1104 (21), ≥ 300 0.8 px, f 1096 (28)
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1102 (551), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -0.1 s, outer corners 5 px/s, tilt 41°, 720×1280 fx 1094.3 fy 1094.3 cx 357.5 cy 658.5; id: TL TR BR BL px (* not used) · 67: 247.9,484.4 251.3,521.7 194.9,526.7 193.8,490.1 · 115: 166.0,553.1 167.1,594.4 106.4,601.3 107.6,558.9 · 170: 618.3,576.2 635.6,619.9 575.3,625.9 560.1,581.9 · 252: 570.5,454.2 584.2,490.7 530.0,495.5 518.0,459.2 · 259: 459.4,668.2 471.7,716.3 405.7,723.9 396.1,675.3 · 287: 167.2,622.0 168.3,668.8 104.0,675.8 105.2,627.9 · 319: 553.6,658.0 569.6,705.4 504.6,712.7 491.0,664.6 · 389: 168.9,699.2 169.4,749.7 100.5,757.3 102.8,706.3 · 415: 491.0,461.7 502.4,497.6 447.9,503.3 438.2,466.6 · 442: 363.7,678.9 371.9,727.4 305.3,734.9 299.3,685.4 · 449: 411.2,469.1 419.8,506.4 364.4,510.8 357.6,474.1 · 478: 646.2,647.9 666.5,694.2 602.1,701.8 584.6,654.2 · 484: 593.1,512.8 608.3,551.1 551.5,556.8 538.0,517.7 · 518: 329.9,476.8 336.0,513.3 280.2,518.6 275.9,481.8 · 523: 266.5,688.5 271.3,738.6 203.9,745.8 201.8,695.5 · 580: 165.3,492.7 166.0,529.8 108.8,535.5 110.1,497.8

Test 4 (no ?centre=)
tags     16 / 16 found, 16 / 16 used, err 0.83 / 0.89 px (0.54 / 0.55 mm on the paper)
edges    tags −0.24 px bigger than printed vs the fit (10–90 %: −0.35 to −0.13 over 150 frames; − = smaller, edges placed towards the black), 78 % of tags smaller; edgeGamma 2.6 (?edgeGamma=)
view     423 / 428 mm above the paper, tilt 42 / 42° from straight down
focal    1128.4 px (estimated ±0.27 %); started from the one saved for camera 0, facing back (1094.3 px); measured one saved for camera 0, facing back; first estimate 2.9 s after the first frame it could use
fit      1125 px best (1113–1131 over 12 tilted frames; long-side FOV 59.3°, ?fov=59.3), err 0.82 px with it, 0.82 px with the f in use
calib    150 frames with ≥ 6 tags at ≥ 20° tilt (homography fit 0.8 / 0.9 px, 0.5 / 0.5 mm on the paper), 150 of them under 1 px or 1 mm, from 5 directions ≥ 10° apart (17 since Start; it needs 3); fit and one-frame f by board speed: < 100 px/s 0.8 px, f 1124 (93), 100–300 0.8 px, f 1126 (39), ≥ 300 0.8 px, f 1122 (18)
centre   one-frame f by the image edge the paper recedes towards, since Start: top 1127 (493), bottom - (0), left - (0), right - (0); lens centre not fitted (needs the paper receding towards opposite edges: top and bottom, or left and right)
corners  -1.3 s, outer corners 7 px/s, tilt 42°, 720×1280 fx 1128.4 fy 1128.4 cx 359.5 cy 639.5; id: TL TR BR BL px (* not used) · 67: 216.1,491.9 219.9,528.7 162.7,536.0 161.0,498.5 · 115: 133.7,563.0 134.8,604.5 73.8,613.2 74.8,570.6 · 170: 591.7,573.1 609.9,616.4 549.1,624.4 533.0,580.6 · 252: 540.9,452.3 555.5,488.2 501.2,494.7 488.1,458.5 · 259: 432.6,670.4 445.7,718.7 378.8,728.0 368.3,679.4 · 287: 135.4,632.4 137.0,679.5 71.7,688.8 73.0,640.4 · 319: 527.8,657.3 544.7,704.5 479.1,713.7 464.7,665.6 · 389: 138.3,710.3 138.6,761.4 69.1,771.3 71.1,719.3 · 415: 461.3,461.8 473.1,497.7 418.1,505.0 407.9,468.0 · 442: 335.4,683.8 344.6,732.5 277.1,742.2 270.7,692.2 · 449: 380.5,471.4 389.9,508.6 334.0,514.9 326.6,478.2 · 478: 620.9,643.9 642.3,690.4 577.5,699.6 559.1,652.3 · 484: 564.8,510.0 580.9,547.9 523.8,555.4 509.4,516.7 · 518: 298.4,481.5 305.3,518.3 248.8,525.2 244.0,488.2 · 523: 237.2,696.3 242.6,747.0 173.9,756.4 171.9,705.4 · 580: 132.2,502.5 133.4,539.2 75.4,547.0 76.4,509.1
```
