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

| Check               | What to look at                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VideoFrame format   | HUD `frame`: `format` (NV12 / I420 / RGBA / null), coded size, `rotation`                                                                                                                            |
| Orientation         | in portrait, is the VideoFrame transposed vs `videoWidth × videoHeight`? If so, does rotating by `screen.orientation.angle` give an upright image (HUD thumbnail)?                                   |
| Lag: synced vs live | move the phone side to side: compare `?bg=frame` (default) and `?bg=live`. Note the HUD `delay` and `stages` lines, whether the video lags behind reality, and whether the cube slides off the paper |
| VideoFrame → WebGL  | background shows the camera with `?bg=frame` (VideoFrame upload) and with `?bg=video` (video-element upload)                                                                                         |
| Hidden video        | with the tracker-created 1 × 1 px video, frames keep arriving (fps ≥ 25)                                                                                                                             |
| Worker              | HUD `worker: module` (not `inline`), and no requests other than the page's own origin in Web Inspector / DevTools                                                                                    |
| Lens labels         | every `videoinput` label (HUD list), and which one was pinned                                                                                                                                        |
| Rotated frames      | Android, portrait: with `?bg=frame`, is the background upright and aligned with the overlay (does the WebGL upload honour `VideoFrame.rotation`)? Compare `?bg=video`                                |
| Render cost         | HUD `render ms` (`MatarThree.update()` + `renderer.render`) per frame; it should stay well under the frame interval                                                                                  |

## Results

| Date | Device | OS / browser | Camera label | Found < 1 s? | fps | worker ms | err px | jitter mm | f (px, source) | Overlay offset mm | Notes |
| ---- | ------ | ------------ | ------------ | ------------ | --- | --------- | ------ | --------- | -------------- | ----------------- | ----- |
